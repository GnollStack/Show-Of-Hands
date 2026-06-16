import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
    DIAGNOSTIC_ACTION_METADATA,
    DIAGNOSTIC_ACTION_NAMES,
    DIAGNOSTIC_SETTING_KEYS,
    MUTATING_DIAGNOSTIC_ACTION_NAMES,
    READ_ONLY_DIAGNOSTIC_ACTION_NAMES,
    buildSmokeReport,
    collectCursorAssetCandidates,
    compareCursorStates,
    jsonSafeClone,
    makeSmokeCheck,
    runCoreSelfChecks,
    validateCursorConfig,
    validateV14RuntimeSnapshot,
    validateSettingsSnapshot
} from '../scripts/diagnostics-core.js';
import { canBroadcastVisibleCursor, getShowCursorPermissionState } from '../scripts/foundry-permissions.js';
import { getCursorSharingDebugState } from '../scripts/cursor-sharing.js';
import { filterPrivateBroadcastActivity } from '../scripts/privacy-broadcast.js';
import { isTokenIncludedInLevel, tokenMatchesMarqueeLevelFilter } from '../scripts/scene-levels.js';
import { MARQUEE_LEVEL_FILTERS, SETTING_CHOICES, SETTING_KEYS, SETTING_RANGES, tokenMatchesMarqueeFilter } from '../scripts/settings.js';

async function readFixture(name) {
    const text = await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
    return JSON.parse(text);
}

async function readProjectFile(path) {
    return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('valid cursor profile fixture passes validation', async () => {
    const fixture = await readFixture('cursor-profile.valid.json');
    const result = validateCursorConfig(fixture);

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
    assert.equal(result.summary.stateCount, 9);
});

test('bad cursor profile fixture reports errors without mutation', async () => {
    const fixture = await readFixture('cursor-profile.invalid.json');
    const before = JSON.stringify(fixture);
    const result = validateCursorConfig(fixture);

    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 5);
    assert.equal(JSON.stringify(fixture), before);
});

test('diagnostic actions are allowlisted and mutation metadata is explicit', () => {
    assert.deepEqual([...DIAGNOSTIC_ACTION_NAMES].sort(), [
        'cleanupFixtures',
        'collectClientDiagnostics',
        'getStatus',
        'openWindow',
        'refreshClient',
        'runAutomation',
        'runSmokeTests',
        'validateAssets',
        'validateCursorAssets',
        'validateCursorConfig',
        'validateSettings',
        'validateV14Runtime'
    ]);

    for (const name of READ_ONLY_DIAGNOSTIC_ACTION_NAMES) {
        assert.equal(DIAGNOSTIC_ACTION_METADATA[name].createsDocuments, false);
    }

    for (const name of MUTATING_DIAGNOSTIC_ACTION_NAMES) {
        assert.equal(DIAGNOSTIC_ACTION_METADATA[name].createsDocuments, true);
    }
});

test('diagnostics snapshot exposes a single MCP setting', () => {
    assert.deepEqual(
        DIAGNOSTIC_SETTING_KEYS.filter(key => key.toLowerCase().includes('mcp')),
        ['enableMcpDiagnostics']
    );
});

test('diagnostic setting keys come from central metadata', () => {
    assert.deepEqual(DIAGNOSTIC_SETTING_KEYS, SETTING_KEYS);
    assert.deepEqual(SETTING_CHOICES['marquee-level-filter'], ['all', 'viewed']);
    assert.deepEqual(Object.keys(MARQUEE_LEVEL_FILTERS), ['all', 'viewed']);
    assert.equal(SETTING_RANGES['shared-cursor-size'].max, 128);
});

test('SHOW_CURSOR permission helper defaults to allowed when the API is unavailable', () => {
    assert.equal(canBroadcastVisibleCursor({ id: 'user-without-api' }), true);
    assert.deepEqual(getShowCursorPermissionState({ id: 'user-without-api' }), {
        permission: 'SHOW_CURSOR',
        available: false,
        allowed: true,
        error: null
    });
});

test('SHOW_CURSOR permission helper blocks when Foundry denies the permission', () => {
    const user = {
        hasPermission(permission) {
            assert.equal(permission, 'SHOW_CURSOR');
            return false;
        }
    };

    assert.equal(canBroadcastVisibleCursor(user), false);
    assert.deepEqual(getShowCursorPermissionState(user), {
        permission: 'SHOW_CURSOR',
        available: true,
        allowed: false,
        error: null
    });
});

test('cursor sharing debug state reports SHOW_CURSOR permission blocking', () => {
    const priorGame = globalThis.game;
    globalThis.game = {
        user: {
            hasPermission: () => false
        },
        settings: {
            get: () => ({})
        }
    };

    try {
        const state = getCursorSharingDebugState();
        assert.equal(state.showCursorPermission.available, true);
        assert.equal(state.showCursorPermission.allowed, false);
        assert.equal(state.permissionBlocked, true);
        assert.equal(state.visibleBroadcastAllowed, false);
    } finally {
        if (priorGame === undefined) delete globalThis.game;
        else globalThis.game = priorGame;
    }
});

test('private broadcast filtering drops cursor-only activity', () => {
    const result = filterPrivateBroadcastActivity({ cursor: { x: 1, y: 2 } }, { privateMode: true });

    assert.equal(result.action, 'drop');
    assert.equal(result.activityData, null);
    assert.equal(result.hiddenPing, null);
    assert.equal(result.removedCursor, true);
});

test('private broadcast filtering forwards non-cursor fields', () => {
    const result = filterPrivateBroadcastActivity({
        cursor: { x: 1, y: 2 },
        targets: ['a', 'b']
    }, { privateMode: true });

    assert.equal(result.action, 'forward');
    assert.deepEqual(result.activityData, { targets: ['a', 'b'] });
    assert.equal(result.hiddenPing, null);
});

test('private broadcast filtering reroutes cursor pings', () => {
    const result = filterPrivateBroadcastActivity({
        cursor: { x: 10, y: 20 },
        ping: { pull: true, zoom: 1.5 }
    }, { privateMode: true });

    assert.equal(result.action, 'drop');
    assert.deepEqual(result.hiddenPing, {
        position: { x: 10, y: 20 },
        ping: { pull: true, zoom: 1.5 }
    });
    assert.equal(result.removedPing, true);
});

test('private broadcast filtering reroutes ping and forwards unrelated activity', () => {
    const result = filterPrivateBroadcastActivity({
        cursor: { x: 10, y: 20 },
        ping: { pull: false },
        targets: ['target-id']
    }, { privateMode: true });

    assert.equal(result.action, 'forward');
    assert.deepEqual(result.activityData, { targets: ['target-id'] });
    assert.deepEqual(result.hiddenPing, {
        position: { x: 10, y: 20 },
        ping: { pull: false }
    });
});

test('non-private broadcast filtering forwards unchanged activity', () => {
    const activity = { cursor: { x: 1, y: 2 }, ping: { pull: true } };
    const result = filterPrivateBroadcastActivity(activity, { privateMode: false });

    assert.equal(result.action, 'forward');
    assert.equal(result.activityData, activity);
    assert.equal(result.hiddenPing, null);
});

test('cursor state comparison distinguishes legacy settings from the canonical profile', async () => {
    const fixture = await readFixture('cursor-profile.valid.json');
    const legacyStates = structuredClone(fixture.cursorStates);
    legacyStates.default.image = 'different-cursor.png';

    const comparison = compareCursorStates(legacyStates, fixture.cursorStates);
    assert.equal(comparison.equivalent, false);
    assert.deepEqual(comparison.differingStates, ['default']);
});

test('cursor asset candidates mark only canonical runtime assets as active', async () => {
    const fixture = await readFixture('cursor-profile.valid.json');
    const candidates = collectCursorAssetCandidates({
        currentProfile: fixture,
        legacyCursorStates: fixture.cursorStates,
        legacyUseCustomCursor: true
    });

    const active = candidates.filter(candidate => candidate.active);
    const legacy = candidates.filter(candidate => candidate.source === 'legacyClientSetting');

    assert.ok(active.some(candidate => candidate.source === 'currentUserProfile' && candidate.state === 'default'));
    assert.equal(legacy.every(candidate => candidate.active === false), true);
});

test('marquee level filter is a no-op without level context', () => {
    const token = { document: { level: 'upper' } };

    assert.equal(tokenMatchesMarqueeLevelFilter(token, {
        filter: 'viewed',
        canvasRef: {}
    }), true);
});

test('marquee level filter uses includedInLevel when available', () => {
    const token = {
        document: {
            includedInLevel: (levelId) => levelId === 'balcony'
        }
    };

    assert.equal(isTokenIncludedInLevel(token, 'balcony'), true);
    assert.equal(isTokenIncludedInLevel(token, 'cellar'), false);
    assert.equal(tokenMatchesMarqueeLevelFilter(token, {
        filter: 'viewed',
        canvasRef: { level: { id: 'balcony' } }
    }), true);
});

test('marquee level filter falls back to token document level', () => {
    const token = { document: { level: 'ground' } };

    assert.equal(tokenMatchesMarqueeLevelFilter(token, {
        filter: 'viewed',
        canvasRef: { level: { id: 'ground' } }
    }), true);
    assert.equal(tokenMatchesMarqueeLevelFilter(token, {
        filter: 'viewed',
        canvasRef: { level: { id: 'roof' } }
    }), false);
});

test('marquee disposition filter still applies after level eligibility', () => {
    const priorGame = globalThis.game;
    const priorConst = globalThis.CONST;
    globalThis.game = {
        settings: {
            get(namespace, key) {
                assert.equal(key, 'marquee-token-filter');
                return 'hostile';
            }
        }
    };
    globalThis.CONST = {
        TOKEN_DISPOSITIONS: {
            HOSTILE: -1,
            NEUTRAL: 0,
            FRIENDLY: 1
        }
    };

    try {
        const hostileToken = { document: { level: 'ground', disposition: -1 } };
        const friendlyToken = { document: { level: 'ground', disposition: 1 } };

        assert.equal(tokenMatchesMarqueeLevelFilter(hostileToken, {
            filter: 'viewed',
            canvasRef: { level: { id: 'ground' } }
        }), true);
        assert.equal(tokenMatchesMarqueeFilter(hostileToken), true);
        assert.equal(tokenMatchesMarqueeFilter(friendlyToken), false);
    } finally {
        if (priorGame === undefined) delete globalThis.game;
        else globalThis.game = priorGame;
        if (priorConst === undefined) delete globalThis.CONST;
        else globalThis.CONST = priorConst;
    }
});

test('jsonSafeClone handles circular values and non-json primitives', () => {
    const input = { created: new Date('2026-01-01T00:00:00.000Z') };
    input.self = input;
    input.fn = function example() {};
    input.big = 1n;

    const cloned = jsonSafeClone(input);
    assert.equal(cloned.self, '[Circular]');
    assert.equal(cloned.fn, '[Function example]');
    assert.equal(cloned.big, '1');
    assert.equal(cloned.created, '2026-01-01T00:00:00.000Z');
});

test('settings snapshot validation catches invalid choices', () => {
    const snapshot = {
        'use-aom-cursor': true,
        'cursor-hotspot-x': 4,
        'cursor-hotspot-y': 4,
        'use-mousewheel-targeting': true,
        'use-marquee-select': true,
        'middle-mouse-actions': 'bad-mode',
        'clear-targets-on-empty-click': true,
        'use-custom-cursor': true,
        'cursor-states': {},
        'marquee-token-filter': 'all',
        'marquee-level-filter': 'all',
        'shared-cursor-size': 16,
        'shared-cursor-opacity': 1,
        'show-cursor-names': false,
        'cursor-name-position': 'bottom-center',
        'cursor-name-offset': { x: 0, y: 1.2 },
        'foundry-cursor-display': 'both',
        'disable-cursor-fade': false,
        'idle-identity-fade': false,
        'enable-cursor-sharing': true,
        'hide-my-cursor-from-others': false,
        'cursor-sharing-mode': 'share',
        'hidden-shared-cursor-users': {},
        'debug-mode': 'off',
        enableMcpDiagnostics: false,
        'settings-version': 4
    };

    const result = validateSettingsSnapshot(snapshot);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.includes('middle-mouse-actions')));

    const invalidLevelFilter = validateSettingsSnapshot({
        ...snapshot,
        'middle-mouse-actions': 'both',
        'marquee-level-filter': 'bad-level-filter'
    });
    assert.equal(invalidLevelFilter.valid, false);
    assert.ok(invalidLevelFilter.errors.some(error => error.includes('marquee-level-filter')));
});

test('V14 runtime snapshot validation requires explicit contracts', () => {
    const validSnapshot = {
        foundryGeneration: 14,
        canvasReady: true,
        applicationV2: true,
        handlebarsApplicationMixin: true,
        dialogV2: true,
        filePickerImplementation: true,
        formDataExtended: true,
        configureCursors: true,
        registerMouseMoveHandler: true,
        canvasControlsCursors: true,
        sceneLevelInfo: {
            hasAvailableLevels: true,
            availableLevelCount: 2,
            availableLevelIds: ['ground', 'balcony'],
            hasFirstLevel: true,
            firstLevelId: 'ground'
        }
    };

    const valid = validateV14RuntimeSnapshot(validSnapshot);
    assert.equal(valid.valid, true);
    assert.deepEqual(valid.errors, []);
    assert.equal(valid.summary.checkedContracts, 8);

    const invalid = validateV14RuntimeSnapshot({
        ...validSnapshot,
        dialogV2: false,
        filePickerImplementation: false,
        formDataExtended: false,
        canvasControlsCursors: false
    });

    assert.equal(invalid.valid, false);
    assert.ok(invalid.errors.some(error => error.includes('DialogV2')));
    assert.ok(invalid.errors.some(error => error.includes('FilePicker')));
    assert.ok(invalid.errors.some(error => error.includes('FormDataExtended')));
    assert.ok(invalid.errors.some(error => error.includes('canvas.controls.cursors')));
});

test('ApplicationV2 command actions are wired in templates and settings apps', async () => {
    const cursorTemplate = await readProjectFile('templates/cursor-config.html');
    const advancedTemplate = await readProjectFile('templates/advanced-settings.html');
    const cursorApp = await readProjectFile('scripts/cursor-config-app.js');
    const advancedApp = await readProjectFile('scripts/advanced-settings-app.js');

    for (const action of [
        'browseCursorImage',
        'clearCursorImage',
        'copyProfile',
        'resetAll',
        'resetProfile',
        'selectCursorTab',
        'setNamePreset',
        'useAomDefault'
    ]) {
        assert.ok(cursorTemplate.includes(`data-action="${action}"`), `cursor template is missing ${action}`);
        assert.ok(cursorApp.includes(`${action}: CursorConfigApp.#`), `cursor app is missing ${action} handler wiring`);
    }

    for (const action of ['copyDiagnostics', 'refreshDiagnostics']) {
        assert.ok(advancedTemplate.includes(`data-action="${action}"`), `advanced template is missing ${action}`);
        assert.ok(advancedApp.includes(`${action}: AdvancedSettingsApp.#`), `advanced app is missing ${action} handler wiring`);
    }
});

test('smoke report uses pass/fail summary and never creates documents', () => {
    const report = buildSmokeReport([
        makeSmokeCheck('ok', true),
        makeSmokeCheck('bad', false)
    ]);

    assert.equal(report.passed, false);
    assert.equal(report.createsDocuments, false);
    assert.equal(report.summary.total, 2);
    assert.equal(report.summary.failed, 1);
});

test('runCoreSelfChecks all pass and produce a clean smoke report', () => {
    const checks = runCoreSelfChecks();
    assert.ok(checks.length > 0);
    for (const check of checks) {
        assert.equal(check.status, 'pass', `core self-check failed: ${check.name}`);
    }

    // The MCP runSmokeTests action embeds these; the report must stay clean and document-free.
    const report = buildSmokeReport(checks);
    assert.equal(report.passed, true);
    assert.equal(report.createsDocuments, false);
    assert.equal(report.summary.failed, 0);
});
