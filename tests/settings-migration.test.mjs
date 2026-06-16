import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_HOTSPOT, MODULE_ID } from '../scripts/constants.js';
import {
    SETTING_DEFINITIONS,
    getSettingDefault,
    migrateSettings
} from '../scripts/settings.js';

function clone(value) {
    if (value === undefined || value === null) return value;
    return typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
}

function mergePlainObject(base, override) {
    const result = clone(base);
    for (const [key, value] of Object.entries(override ?? {})) {
        if (
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            result[key] &&
            typeof result[key] === 'object' &&
            !Array.isArray(result[key])
        ) {
            result[key] = mergePlainObject(result[key], value);
        } else {
            result[key] = clone(value);
        }
    }
    return result;
}

function makeEnvironment(initialSettings = {}, { mergeThrows = false } = {}) {
    const defaults = new Map(SETTING_DEFINITIONS.map(definition => [
        definition.key,
        getSettingDefault(definition)
    ]));
    const store = new Map(Object.entries(initialSettings).map(([key, value]) => [
        `${MODULE_ID}.${key}`,
        clone(value)
    ]));
    const writes = [];

    globalThis.game = {
        settings: {
            storage: {
                get(scope) {
                    assert.equal(scope, 'client');
                    return {
                        getItem(settingId) {
                            return store.has(settingId) ? JSON.stringify(store.get(settingId)) : null;
                        }
                    };
                }
            },
            get(moduleId, key) {
                assert.equal(moduleId, MODULE_ID);
                const settingId = `${moduleId}.${key}`;
                if (store.has(settingId)) return clone(store.get(settingId));
                if (defaults.has(key)) return clone(defaults.get(key));
                throw new Error(`Unknown setting: ${key}`);
            },
            async set(moduleId, key, value) {
                assert.equal(moduleId, MODULE_ID);
                writes.push({ key, value: clone(value) });
                store.set(`${moduleId}.${key}`, clone(value));
                return value;
            }
        }
    };

    globalThis.foundry = {
        utils: {
            mergeObject(base, override) {
                if (mergeThrows) throw new Error('merge failed');
                return mergePlainObject(base, override);
            }
        }
    };

    return {
        get(key) {
            return store.get(`${MODULE_ID}.${key}`);
        },
        has(key) {
            return store.has(`${MODULE_ID}.${key}`);
        },
        writes
    };
}

async function withEnvironment(initialSettings, callback, options) {
    const priorGame = globalThis.game;
    const priorFoundry = globalThis.foundry;
    const priorWarn = console.warn;
    const env = makeEnvironment(initialSettings, options);

    try {
        console.warn = () => {};
        await callback(env);
    } finally {
        console.warn = priorWarn;
        if (priorGame === undefined) delete globalThis.game;
        else globalThis.game = priorGame;
        if (priorFoundry === undefined) delete globalThis.foundry;
        else globalThis.foundry = priorFoundry;
    }
}

test('fresh install without stored legacy keys does not write migration settings', async () => {
    await withEnvironment({}, async (env) => {
        await migrateSettings();

        assert.equal(env.has('settings-version'), false);
        assert.deepEqual(env.writes, []);
    });
});

test('legacy v1 settings migrate through the full v4 chain', async () => {
    await withEnvironment({
        'use-aom-cursor': false,
        'cursor-hotspot-x': 7,
        'cursor-hotspot-y': 8,
        'use-mousewheel-targeting': true,
        'use-marquee-select': false,
        'enable-cursor-sharing': false,
        'hide-my-cursor-from-others': true
    }, async (env) => {
        await migrateSettings();

        assert.equal(env.get('settings-version'), 4);
        assert.equal(env.get('use-custom-cursor'), false);
        assert.equal(env.get('cursor-states').default.hotspotX, 7);
        assert.equal(env.get('cursor-states').default.hotspotY, 8);
        assert.equal(env.get('middle-mouse-actions'), 'target');
        assert.equal(env.get('cursor-sharing-mode'), 'private');
    });
});

test('mid-chain migration failure persists completed earlier version and stops', async () => {
    await withEnvironment({
        'use-aom-cursor': false,
        'cursor-hotspot-x': 5,
        'cursor-hotspot-y': 6,
        'use-mousewheel-targeting': true,
        'use-marquee-select': true,
        'enable-cursor-sharing': true,
        'hide-my-cursor-from-others': false
    }, async (env) => {
        await migrateSettings();

        assert.equal(env.get('settings-version'), 2);
        assert.equal(env.get('use-custom-cursor'), false);
        assert.equal(env.get('cursor-states').default.hotspotX, 5);
        assert.equal(env.has('middle-mouse-actions'), false);
        assert.equal(env.has('cursor-sharing-mode'), false);
    }, { mergeThrows: true });
});

test('stored cursor-states without version is treated as v2 even when legacy keys remain', async () => {
    await withEnvironment({
        'cursor-states': {
            default: {
                image: 'custom.png',
                hotspotX: 11,
                hotspotY: 12,
                rotation: 0,
                width: 0,
                height: 0,
                enabled: true
            }
        },
        'use-aom-cursor': false,
        'use-mousewheel-targeting': false,
        'use-marquee-select': true
    }, async (env) => {
        await migrateSettings();

        assert.equal(env.get('settings-version'), 4);
        assert.equal(env.has('use-custom-cursor'), false);
        assert.equal(env.get('cursor-states').default.image, 'custom.png');
        assert.equal(env.get('cursor-states').default.hotspotX, 11);
        assert.equal(env.get('middle-mouse-actions'), 'marquee');
    });
});

test('legacy migration falls back to defaults for missing legacy keys', async () => {
    await withEnvironment({
        'cursor-hotspot-x': 9
    }, async (env) => {
        await migrateSettings();

        assert.equal(env.get('settings-version'), 4);
        assert.equal(env.get('use-custom-cursor'), true);
        assert.equal(env.get('cursor-states').default.hotspotX, 9);
        assert.equal(env.get('cursor-states').default.hotspotY, DEFAULT_HOTSPOT.y);
        assert.equal(env.get('middle-mouse-actions'), 'both');
        assert.equal(env.get('cursor-sharing-mode'), 'share');
    });
});
