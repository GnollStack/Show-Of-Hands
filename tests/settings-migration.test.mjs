import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterPrivateBroadcastActivity } from '../scripts/privacy-broadcast.js';

import { CURSOR_SOURCE_HOTSPOT_MAX, DEFAULT_HOTSPOT, MODULE_ID } from '../scripts/constants.js';
import {
    SETTING_DEFINITIONS,
    USER_CURSOR_CONFIG_FLAG,
    getCursorSharingMode,
    getSettingDefault,
    getUserCursorConfig,
    migrateLegacyUserCursorConfig,
    migrateSettings,
    migrateWorldSettings,
    normalizeUserCursorConfig
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

function makeEnvironment(initialSettings = {}, {
    legacySettings = {},
    mergeThrows = false,
    rejectWorldBeforeReady = false,
    failSetOnceFor = null,
    onSet = () => {}
} = {}) {
    const defaults = new Map(SETTING_DEFINITIONS.map(definition => [
        definition.key,
        getSettingDefault(definition)
    ]));
    const store = new Map();
    const seedSettings = (moduleId, settings) => {
        for (const [key, value] of Object.entries(settings)) {
            store.set(`${moduleId}.${key}`, clone(value));
        }
    };
    seedSettings(MODULE_ID, initialSettings);
    seedSettings('target-the-beastie', legacySettings);
    const writes = [];
    let didFailConfiguredSet = false;
    const scopes = new Map(SETTING_DEFINITIONS.map(definition => [definition.key, definition.scope ?? 'client']));

    globalThis.game = {
        ready: !rejectWorldBeforeReady,
        user: { isGM: true },
        settings: {
            storage: {
                get(scope) {
                    assert.ok(['client', 'world'].includes(scope));
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
                if (key === failSetOnceFor && !didFailConfiguredSet) {
                    didFailConfiguredSet = true;
                    throw new Error(`transient set failure: ${key}`);
                }
                if (rejectWorldBeforeReady && scopes.get(key) === 'world' && !globalThis.game.ready) {
                    throw new Error('world settings require ready');
                }
                writes.push({ key, value: clone(value) });
                store.set(`${moduleId}.${key}`, clone(value));
                onSet(key, value);
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
        getLegacy(key) {
            return store.get(`target-the-beastie.${key}`);
        },
        setReady(value) {
            globalThis.game.ready = value;
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

test('cursor profile normalization preserves large source hotspots beyond the output raster cap', async () => {
    await withEnvironment({}, async () => {
        const config = normalizeUserCursorConfig({
            cursorStates: {
                default: {
                    hotspotX: 511,
                    hotspotY: CURSOR_SOURCE_HOTSPOT_MAX + 100
                }
            }
        });

        assert.equal(config.cursorStates.default.hotspotX, 511);
        assert.equal(config.cursorStates.default.hotspotY, CURSOR_SOURCE_HOTSPOT_MAX);
    });
});

test('effective sharing mode preserves legacy privacy before migration completes', async () => {
    await withEnvironment({}, async () => {
        assert.equal(getCursorSharingMode(), 'private');
    }, {
        legacySettings: {
            'enable-cursor-sharing': true,
            'hide-my-cursor-from-others': true
        }
    });
});

test('effective sharing mode reads a legacy compact mode before migration', async () => {
    await withEnvironment({}, async () => {
        assert.equal(getCursorSharingMode(), 'receive');
    }, {
        legacySettings: {
            'cursor-sharing-mode': 'receive'
        }
    });
});

test('current compact sharing mode takes precedence over legacy values', async () => {
    await withEnvironment({
        'cursor-sharing-mode': 'share'
    }, async () => {
        assert.equal(getCursorSharingMode(), 'share');
    }, {
        legacySettings: {
            'cursor-sharing-mode': 'private'
        }
    });
});

test('current legacy privacy boolean takes precedence over a stale legacy compact mode', async () => {
    await withEnvironment({
        'hide-my-cursor-from-others': true
    }, async () => {
        assert.equal(getCursorSharingMode(), 'private');
    }, {
        legacySettings: {
            'cursor-sharing-mode': 'share'
        }
    });
});

test('namespace migration materializes current legacy privacy before copying a compact mode', async () => {
    await withEnvironment({
        'hide-my-cursor-from-others': true
    }, async (env) => {
        await migrateSettings();
        assert.equal(env.get('cursor-sharing-mode'), 'private');
        assert.equal(getCursorSharingMode(), 'private');
    }, {
        legacySettings: {
            'settings-version': 5,
            'cursor-sharing-mode': 'share'
        }
    });
});

test('early client migration defers legacy world settings until Foundry ready', async () => {
    await withEnvironment({}, async (env) => {
        await migrateSettings({ includeWorld: false });
        assert.equal(env.has('enableMcpDiagnostics'), false);

        env.setReady(true);
        await migrateWorldSettings();
        assert.equal(env.get('enableMcpDiagnostics'), true);
    }, {
        legacySettings: {
            'enableMcpDiagnostics': true
        },
        rejectWorldBeforeReady: true
    });
});

test('legacy user cursor flag survives inactive old package scope', async () => {
    await withEnvironment({}, async () => {
        const legacyProfile = {
            useCustomCursor: true,
            cursorStates: {
                default: {
                    image: 'modules/target-the-beastie/custom/default.png',
                    hotspotX: 3,
                    hotspotY: 4,
                    rotation: 0,
                    width: 0,
                    height: 0,
                    enabled: true
                }
            }
        };
        const writes = [];
        const user = {
            flags: {
                'target-the-beastie': {
                    [USER_CURSOR_CONFIG_FLAG]: legacyProfile
                }
            },
            getFlag(scope) {
                if (scope === 'target-the-beastie') throw new Error('Flag scope "target-the-beastie" is not valid or not currently active');
                return undefined;
            },
            async setFlag(scope, key, value) {
                writes.push({ scope, key, value: clone(value) });
                return value;
            }
        };

        const config = getUserCursorConfig(user);
        assert.equal(config.cursorStates.default.image, 'modules/target-the-beastie/custom/default.png');

        const result = await migrateLegacyUserCursorConfig(user);
        assert.equal(result.migrated, true);
        assert.equal(writes.length, 1);
        assert.equal(writes[0].scope, MODULE_ID);
        assert.equal(writes[0].key, USER_CURSOR_CONFIG_FLAG);
        assert.equal(writes[0].value.cursorStates.default.image, 'modules/target-the-beastie/custom/default.png');
    });
});

test('stored client cursor profile migrates when neither user flag exists', async () => {
    await withEnvironment({
        'cursor-states': {
            default: {
                image: 'custom/local-pointer.png',
                hotspotX: 6,
                hotspotY: 7,
                rotation: 15,
                width: 40,
                height: 20,
                enabled: true
            }
        },
        'use-custom-cursor': false,
        'cursor-name-position': 'custom',
        'cursor-name-offset': { x: 2.5, y: -1 }
    }, async () => {
        const writes = [];
        const user = {
            flags: {},
            getFlag() { return undefined; },
            async setFlag(scope, key, value) {
                writes.push({ scope, key, value: clone(value) });
                return value;
            }
        };

        const result = await migrateLegacyUserCursorConfig(user);
        assert.equal(result.migrated, true);
        assert.equal(result.source, 'client-settings');
        assert.equal(writes.length, 1);
        assert.equal(writes[0].scope, MODULE_ID);
        assert.equal(writes[0].key, USER_CURSOR_CONFIG_FLAG);
        assert.equal(writes[0].value.useCustomCursor, false);
        assert.equal(writes[0].value.cursorStates.default.image, 'custom/local-pointer.png');
        assert.equal(writes[0].value.cursorStates.default.hotspotX, 6);
        assert.equal(writes[0].value.namePosition, 'custom');
        assert.deepEqual(writes[0].value.nameOffset, { x: 2.5, y: -1 });
    });
});

test('legacy v1 settings migrate through the full v5 chain', async () => {
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

        assert.equal(env.get('settings-version'), 5);
        assert.equal(env.get('use-custom-cursor'), false);
        assert.equal(env.get('cursor-states').default.hotspotX, DEFAULT_HOTSPOT.x);
        assert.equal(env.get('cursor-states').default.hotspotY, DEFAULT_HOTSPOT.y);
        assert.equal(env.get('middle-mouse-actions'), 'target');
        assert.equal(env.get('cursor-sharing-mode'), 'private');
    });
});

test('legacy module namespace settings are copied before version migration', async () => {
    await withEnvironment({}, async (env) => {
        await migrateSettings();

        assert.equal(env.get('settings-version'), 5);
        assert.equal(env.get('middle-mouse-actions'), 'marquee');
        assert.equal(env.get('cursor-sharing-mode'), 'receive');
        assert.equal(env.get('cursor-states').default.image, '');
        assert.equal(env.get('cursor-states').default.hotspotX, DEFAULT_HOTSPOT.x);
        assert.equal(env.get('cursor-states').default.hotspotY, DEFAULT_HOTSPOT.y);
        assert.equal(env.get('cursor-states').hover.image, 'modules/target-the-beastie/custom/cursor.png');
        assert.equal(env.getLegacy('settings-version'), 4);
    }, {
        legacySettings: {
            'settings-version': 4,
            'middle-mouse-actions': 'marquee',
            'cursor-sharing-mode': 'receive',
            'cursor-states': {
                default: {
                    image: 'modules/target-the-beastie/assets/AOM_cursor_pointer.png',
                    hotspotX: 4,
                    hotspotY: 4,
                    rotation: 0,
                    width: 0,
                    height: 0,
                    enabled: true
                },
                hover: {
                    image: 'modules/target-the-beastie/custom/cursor.png',
                    hotspotX: 9,
                    hotspotY: 10,
                    rotation: 0,
                    width: 0,
                    height: 0,
                    enabled: true
                }
            }
        }
    });
});

test('a transient legacy namespace copy failure rejects and succeeds on retry', async () => {
    await withEnvironment({}, async (env) => {
        await assert.rejects(
            migrateSettings({ includeWorld: false }),
            /namespace settings could not be migrated/
        );
        assert.equal(env.has('middle-mouse-actions'), false);

        await migrateSettings({ includeWorld: false });
        assert.equal(env.get('middle-mouse-actions'), 'marquee');
    }, {
        legacySettings: {
            'middle-mouse-actions': 'marquee'
        },
        failSetOnceFor: 'middle-mouse-actions'
    });
});

test('v5 migration scrubs removed bundled cursor paths from current cursor states', async () => {
    await withEnvironment({
        'settings-version': 4,
        'cursor-states': {
            default: {
                image: 'modules/show-of-hands/assets/AOM_cursor_pointer.png',
                hotspotX: 4,
                hotspotY: 4,
                rotation: 0,
                width: 0,
                height: 0,
                enabled: true
            },
            hover: {
                image: 'modules/target-the-beastie/custom/hover.png',
                hotspotX: 9,
                hotspotY: 10,
                rotation: 0,
                width: 0,
                height: 0,
                enabled: true
            }
        }
    }, async (env) => {
        await migrateSettings();

        assert.equal(env.get('settings-version'), 5);
        assert.equal(env.get('cursor-states').default.image, '');
        assert.equal(env.get('cursor-states').default.hotspotX, DEFAULT_HOTSPOT.x);
        assert.equal(env.get('cursor-states').default.hotspotY, DEFAULT_HOTSPOT.y);
        assert.equal(env.get('cursor-states').hover.image, 'modules/target-the-beastie/custom/hover.png');
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
        await assert.rejects(migrateSettings(), /merge failed/);

        assert.equal(env.get('settings-version'), 2);
        assert.equal(env.get('use-custom-cursor'), false);
        assert.equal(env.get('cursor-states').default.hotspotX, DEFAULT_HOTSPOT.x);
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

        assert.equal(env.get('settings-version'), 5);
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

        assert.equal(env.get('settings-version'), 5);
        assert.equal(env.get('use-custom-cursor'), true);
        assert.equal(env.get('cursor-states').default.hotspotX, DEFAULT_HOTSPOT.x);
        assert.equal(env.get('cursor-states').default.hotspotY, DEFAULT_HOTSPOT.y);
        assert.equal(env.get('middle-mouse-actions'), 'both');
        assert.equal(env.get('cursor-sharing-mode'), 'share');
    });
});

test('older and missing markers preserve compact choices throughout migration in either namespace', async () => {
    for (const version of [undefined, 0, 1, 2, 3, 4]) {
        for (const mode of ['private', 'receive', 'share']) {
            for (const legacyNamespace of [false, true]) {
                const settings = {
                    ...(version === undefined ? {} : { 'settings-version': version }),
                    'cursor-sharing-mode': mode,
                    'middle-mouse-actions': 'off',
                    'use-mousewheel-targeting': true,
                    'use-marquee-select': true,
                    'enable-cursor-sharing': mode !== 'share',
                    'hide-my-cursor-from-others': mode === 'share'
                };
                const observedModes = [];
                await withEnvironment(legacyNamespace ? {} : settings, async env => {
                    assert.equal(getCursorSharingMode(), mode);
                    await migrateSettings({ includeWorld: false });
                    assert.equal(env.get('cursor-sharing-mode'), mode);
                    assert.equal(env.get('middle-mouse-actions'), 'off');
                    assert.ok(observedModes.every(value => value === mode), 'no temporary sharing change during writes');
                    const writeCount = env.writes.length;
                    await migrateSettings({ includeWorld: false });
                    assert.equal(env.writes.length, writeCount, 'a completed migration is idempotent');
                }, {
                    legacySettings: legacyNamespace ? settings : {},
                    onSet() {
                        const effective = getCursorSharingMode();
                        observedModes.push(effective);
                        if (mode === 'private') {
                            const filtered = filterPrivateBroadcastActivity({ cursor: { x: 12, y: 34 }, targets: ['a'] }, {
                                privateMode: effective === 'private'
                            });
                            assert.deepEqual(filtered.activityData, { targets: ['a'] });
                        }
                    }
                });
            }
        }
    }
});

test('current compact preferences win over conflicting legacy values and an imported old marker', async () => {
    await withEnvironment({ 'cursor-sharing-mode': 'private', 'middle-mouse-actions': 'off' }, async env => {
        await migrateSettings({ includeWorld: false });
        assert.equal(env.get('cursor-sharing-mode'), 'private');
        assert.equal(env.get('middle-mouse-actions'), 'off');
    }, { legacySettings: { 'settings-version': 1, 'cursor-sharing-mode': 'share', 'middle-mouse-actions': 'both' } });
});

test('missing or invalid compact choices derive from legacy booleans', async () => {
    for (const compact of [{}, { 'cursor-sharing-mode': 'invalid', 'middle-mouse-actions': 'invalid' }]) {
        await withEnvironment({
            'settings-version': 3, ...compact,
            'enable-cursor-sharing': false, 'hide-my-cursor-from-others': true,
            'use-mousewheel-targeting': false, 'use-marquee-select': true
        }, async env => {
            await migrateSettings({ includeWorld: false });
            assert.equal(env.get('cursor-sharing-mode'), 'private');
            assert.equal(env.get('middle-mouse-actions'), 'marquee');
        });
    }
});

test('a v1 marker preserves newer artwork and toggle while normalizing obsolete bundled art', async () => {
    for (const legacyNamespace of [false, true]) {
        const settings = {
            'settings-version': 1,
            'use-custom-cursor': false,
            'use-aom-cursor': true,
            'cursor-states': {
                default: { image: 'modules/target-the-beastie/custom/arrow.png', hotspotX: 400, rotation: -90, width: 900 },
                hover: { image: 'modules/show-of-hands/assets/AOM_cursor_pointer.png', hotspotX: 30, rotation: 45 }
            }
        };
        await withEnvironment(legacyNamespace ? {} : settings, async env => {
            await migrateSettings({ includeWorld: false });
            assert.equal(env.get('use-custom-cursor'), false);
            const states = env.get('cursor-states');
            assert.equal(states.default.image, settings['cursor-states'].default.image);
            assert.equal(states.default.hotspotX, 400);
            assert.equal(states.default.rotation, 270);
            assert.equal(states.default.width, 128);
            assert.equal(states.hover.image, '');
            assert.equal(states.hover.hotspotX, DEFAULT_HOTSPOT.x);
            assert.ok(states.click);
        }, { legacySettings: legacyNamespace ? settings : {} });
    }
});

test('marker write failure leaves saved preferences intact and retries safely', async () => {
    await withEnvironment({
        'settings-version': 1, 'cursor-sharing-mode': 'private', 'middle-mouse-actions': 'off',
        'use-custom-cursor': false, 'cursor-states': { default: { image: 'custom.png' } }
    }, async env => {
        await assert.rejects(migrateSettings({ includeWorld: false }), /transient set failure/);
        assert.equal(env.get('settings-version'), 1);
        assert.equal(env.get('cursor-sharing-mode'), 'private');
        assert.equal(env.get('cursor-states').default.image, 'custom.png');
        await migrateSettings({ includeWorld: false });
        assert.equal(env.get('settings-version'), 5);
        assert.equal(env.get('cursor-sharing-mode'), 'private');
        assert.equal(env.get('middle-mouse-actions'), 'off');
        assert.equal(env.get('cursor-states').default.image, 'custom.png');
        assert.equal(env.get('use-custom-cursor'), false);
    }, { failSetOnceFor: 'settings-version' });
});

test('failed early compact-mode copy cannot expose conflicting legacy booleans', async () => {
    await withEnvironment({}, async env => {
        await assert.rejects(migrateSettings({ includeWorld: false }), /namespace settings could not be migrated/);
        assert.equal(getCursorSharingMode(), 'private');
        assert.equal(env.has('enable-cursor-sharing'), false);
        assert.equal(env.has('hide-my-cursor-from-others'), false);
        await migrateSettings({ includeWorld: false });
        assert.equal(getCursorSharingMode(), 'private');
    }, {
        legacySettings: { 'settings-version': 3, 'cursor-sharing-mode': 'private',
            'enable-cursor-sharing': true, 'hide-my-cursor-from-others': false },
        failSetOnceFor: 'cursor-sharing-mode'
    });
});
