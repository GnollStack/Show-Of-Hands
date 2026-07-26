import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { runAutomation } from '../scripts/mcp-diagnostics-automation.js';

const savedGlobals = Object.fromEntries(
    ['game', 'canvas', 'CONST'].map(key => [key, globalThis[key]])
);

afterEach(() => {
    for (const [key, value] of Object.entries(savedGlobals)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
    }
});

function makeScene(id, { deleteError = null } = {}) {
    const documents = [];
    const tokens = {
        get size() { return documents.length; },
        get contents() { return [...documents]; },
        get(tokenId) { return documents.find(document => document.id === tokenId); }
    };

    return {
        id,
        grid: { size: 100 },
        tokens,
        async createEmbeddedDocuments(type, data) {
            assert.equal(type, 'Token');
            const created = data.map((source, index) => ({
                ...source,
                id: `${id}-${index}`,
                getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
            }));
            documents.push(...created);
            return created;
        },
        async deleteEmbeddedDocuments(type, ids) {
            assert.equal(type, 'Token');
            if (deleteError) throw deleteError;
            for (const tokenId of ids) {
                const index = documents.findIndex(document => document.id === tokenId);
                if (index >= 0) documents.splice(index, 1);
            }
        }
    };
}

test('automation cleans its captured scene when an exercise fails after scene activation changes', async () => {
    const primaryError = new Error('exercise failed');
    const fixtureScene = makeScene('fixture-scene');
    const otherScene = makeScene('other-scene');
    let filter = 'all';

    globalThis.CONST = {
        TOKEN_DISPOSITIONS: { HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 }
    };
    globalThis.canvas = {
        scene: fixtureScene,
        dimensions: { sceneX: 0, sceneY: 0 },
        grid: { size: 100 }
    };
    globalThis.game = {
        world: { id: 'test-world' },
        actors: [],
        scenes: [fixtureScene, otherScene],
        items: [],
        journal: [],
        settings: {
            get(_moduleId, key) {
                if (key === 'marquee-token-filter') return filter;
                if (key === 'debug-mode') return 'off';
                throw new Error(`Unexpected setting: ${key}`);
            },
            async set(_moduleId, key, value) {
                assert.equal(key, 'marquee-token-filter');
                filter = value;
                if (value === 'hostile') {
                    globalThis.canvas.scene = otherScene;
                    throw primaryError;
                }
            }
        }
    };

    await assert.rejects(
        runAutomation({ cleanupBefore: false, cleanupAfter: true, runId: 'cleanup-test' }),
        error => {
            assert.equal(error, primaryError);
            assert.equal(error instanceof AggregateError, false);
            assert.match(error.message, /exercise failed/);
            return true;
        }
    );

    assert.equal(fixtureScene.tokens.size, 0);
    assert.equal(otherScene.tokens.size, 0);
});

test('automation preserves a cleanup-only failure when the exercise succeeds', async () => {
    const cleanupError = new Error('cleanup failed');
    const fixtureScene = makeScene('fixture-scene', { deleteError: cleanupError });
    let filter = 'all';

    globalThis.CONST = {
        TOKEN_DISPOSITIONS: { HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 }
    };
    globalThis.canvas = {
        scene: fixtureScene,
        dimensions: { sceneX: 0, sceneY: 0 },
        grid: { size: 100 }
    };
    globalThis.game = {
        world: { id: 'test-world' },
        actors: [],
        scenes: [fixtureScene],
        items: [],
        journal: [],
        settings: {
            get(_moduleId, key) {
                if (key === 'marquee-token-filter') return filter;
                if (key === 'debug-mode') return 'off';
                throw new Error(`Unexpected setting: ${key}`);
            },
            async set(_moduleId, key, value) {
                assert.equal(key, 'marquee-token-filter');
                filter = value;
            }
        }
    };

    await assert.rejects(
        runAutomation({ cleanupBefore: false, cleanupAfter: true, runId: 'cleanup-only-test' }),
        error => {
            assert.equal(error, cleanupError);
            assert.equal(error instanceof AggregateError, false);
            return true;
        }
    );

    assert.equal(fixtureScene.tokens.size, 3);
    assert.equal(filter, 'all');
});

test('automation surfaces both the primary and cleanup failures when both occur', async () => {
    const primaryError = new Error('exercise failed');
    const cleanupError = new Error('cleanup failed');
    const fixtureScene = makeScene('fixture-scene', { deleteError: cleanupError });
    const otherScene = makeScene('other-scene');
    let filter = 'all';

    globalThis.CONST = {
        TOKEN_DISPOSITIONS: { HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 }
    };
    globalThis.canvas = {
        scene: fixtureScene,
        dimensions: { sceneX: 0, sceneY: 0 },
        grid: { size: 100 }
    };
    globalThis.game = {
        world: { id: 'test-world' },
        actors: [],
        scenes: [fixtureScene, otherScene],
        items: [],
        journal: [],
        settings: {
            get(_moduleId, key) {
                if (key === 'marquee-token-filter') return filter;
                if (key === 'debug-mode') return 'off';
                throw new Error(`Unexpected setting: ${key}`);
            },
            async set(_moduleId, key, value) {
                assert.equal(key, 'marquee-token-filter');
                filter = value;
                if (value === 'hostile') {
                    globalThis.canvas.scene = otherScene;
                    throw primaryError;
                }
            }
        }
    };

    const originalConsoleError = console.error;
    const loggedErrors = [];
    console.error = (...args) => loggedErrors.push(args);
    try {
        await assert.rejects(
            runAutomation({ cleanupBefore: false, cleanupAfter: true, runId: 'double-failure-test' }),
            error => {
                assert.ok(error instanceof AggregateError);
                assert.match(error.message, /automation failed \(exercise failed\)/i);
                assert.match(error.message, /cleanup also failed \(cleanup failed\)/i);
                assert.match(error.message, /fixtures may remain/i);
                assert.equal(error.errors.length, 2);
                assert.equal(error.errors[0], primaryError);
                assert.equal(error.errors[1], cleanupError);
                return true;
            }
        );
    } finally {
        console.error = originalConsoleError;
    }

    assert.equal(loggedErrors.length, 1);
    assert.match(loggedErrors[0][0], /cleanup also failed/i);
    assert.equal(loggedErrors[0][1], cleanupError);

    assert.equal(fixtureScene.tokens.size, 3);
    assert.equal(otherScene.tokens.size, 0);
    assert.equal(filter, 'all');
});

test('automation preserves both exercise and setting-restore failures and still cleans fixtures', async () => {
    const primaryError = new Error('exercise write failed');
    const restoreError = new Error('setting restore failed');
    const fixtureScene = makeScene('fixture-scene');
    let filter = 'all';
    let exerciseFailed = false;

    globalThis.CONST = {
        TOKEN_DISPOSITIONS: { HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 }
    };
    globalThis.canvas = {
        scene: fixtureScene,
        dimensions: { sceneX: 0, sceneY: 0 },
        grid: { size: 100 }
    };
    globalThis.game = {
        world: { id: 'test-world' },
        actors: [],
        scenes: [fixtureScene],
        items: [],
        journal: [],
        settings: {
            get(_moduleId, key) {
                if (key === 'marquee-token-filter') return filter;
                if (key === 'debug-mode') return 'off';
                throw new Error(`Unexpected setting: ${key}`);
            },
            async set(_moduleId, key, value) {
                assert.equal(key, 'marquee-token-filter');
                if (value === 'hostile') {
                    exerciseFailed = true;
                    throw primaryError;
                }
                if (exerciseFailed && value === 'all') throw restoreError;
                filter = value;
            }
        }
    };

    await assert.rejects(
        runAutomation({ cleanupBefore: false, cleanupAfter: true, runId: 'restore-failure-test' }),
        error => {
            assert.ok(error instanceof AggregateError);
            assert.match(error.message, /exercise failed \(exercise write failed\)/i);
            assert.match(error.message, /restoring the original setting also failed \(setting restore failed\)/i);
            assert.deepEqual(error.errors, [primaryError, restoreError]);
            return true;
        }
    );

    assert.equal(fixtureScene.tokens.size, 0, 'fixture cleanup still runs after both setting errors');
});
