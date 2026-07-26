import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { MODULE_ID } from '../scripts/constants.js';
import { performSingleTarget } from '../scripts/targeting.js';

const previousGame = globalThis.game;
const previousCanvas = globalThis.canvas;

afterEach(() => {
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
    if (previousCanvas === undefined) delete globalThis.canvas;
    else globalThis.canvas = previousCanvas;
});

function installEnvironment() {
    const calls = [];
    globalThis.game = {
        settings: {
            get(moduleId, key) {
                assert.equal(moduleId, MODULE_ID);
                if (key === 'clear-targets-on-empty-click') return true;
                if (key === 'debug-mode') return 'off';
                if (key === 'middle-mouse-actions') return 'both';
                throw new Error(`Unexpected setting: ${key}`);
            }
        },
        user: {
            targets: new Set([{ id: 'a' }, { id: 'b' }])
        },
        keybindings: { actions: new Map() }
    };
    globalThis.canvas = {
        tokens: {
            hover: null,
            setTargets(ids, options) {
                calls.push({ ids, options });
            }
        }
    };
    return calls;
}

test('empty middle-click clears all targets with one collection update', () => {
    const calls = installEnvironment();

    performSingleTarget(false);

    assert.deepEqual(calls, [{ ids: [], options: { mode: 'replace' } }]);
});

test('shift plus empty middle-click preserves the current targets', () => {
    const calls = installEnvironment();

    performSingleTarget(true);

    assert.deepEqual(calls, []);
});
