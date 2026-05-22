import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
    DIAGNOSTIC_ACTION_METADATA,
    DIAGNOSTIC_ACTION_NAMES,
    buildSmokeReport,
    collectCursorAssetCandidates,
    compareCursorStates,
    jsonSafeClone,
    makeSmokeCheck,
    validateCursorConfig,
    validateSettingsSnapshot
} from '../scripts/diagnostics-core.js';

async function readFixture(name) {
    const text = await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
    return JSON.parse(text);
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

test('diagnostic actions are allowlisted and document-free by default', () => {
    assert.deepEqual([...DIAGNOSTIC_ACTION_NAMES].sort(), [
        'getStatus',
        'openWindow',
        'runSmokeTests',
        'validateCursorAssets',
        'validateCursorConfig'
    ]);

    for (const metadata of Object.values(DIAGNOSTIC_ACTION_METADATA)) {
        assert.equal(metadata.createsDocuments, false);
    }
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
        'settings-version': 4
    };

    const result = validateSettingsSnapshot(snapshot);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.includes('middle-mouse-actions')));
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
