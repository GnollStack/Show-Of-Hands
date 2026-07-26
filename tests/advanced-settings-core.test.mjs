import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseAdvancedSettingsForm } from '../scripts/advanced-settings-core.js';

test('parseAdvancedSettingsForm preserves typed checkbox values', () => {
    const values = parseAdvancedSettingsForm({
        sharedCursorOpacity: 0.65,
        disableCursorFade: false,
        idleIdentityFade: true,
        marqueeTokenFilter: "hostile",
        marqueeLevelFilter: "viewed",
        "hiddenUsers.visibleUser": false,
        "hiddenUsers.hiddenUser": true
    }, ["visibleUser", "hiddenUser"]);

    assert.deepEqual(values, {
        sharedCursorOpacity: 0.65,
        disableCursorFade: false,
        idleIdentityFade: true,
        marqueeTokenFilter: "hostile",
        marqueeLevelFilter: "viewed",
        hiddenUsers: { hiddenUser: true }
    });
});

test('parseAdvancedSettingsForm never treats string false as checked', () => {
    const values = parseAdvancedSettingsForm({
        disableCursorFade: "false",
        idleIdentityFade: "false",
        "hiddenUsers.anotherUser": "false"
    }, ["anotherUser"]);

    assert.equal(values.disableCursorFade, false);
    assert.equal(values.idleIdentityFade, false);
    assert.deepEqual(values.hiddenUsers, {});
    assert.equal(values.sharedCursorOpacity, 1);
    assert.equal(values.marqueeTokenFilter, "all");
    assert.equal(values.marqueeLevelFilter, "all");
});

test('parseAdvancedSettingsForm ignores hidden-user keys outside the current user list', () => {
    const values = parseAdvancedSettingsForm({
        "hiddenUsers.currentPeer": true,
        "hiddenUsers.staleOrInjectedUser": true
    }, ["currentPeer"]);

    assert.deepEqual(values.hiddenUsers, { currentPeer: true });
});

test('parseAdvancedSettingsForm clamps opacity and rejects injected choices', () => {
    const tooLow = parseAdvancedSettingsForm({
        sharedCursorOpacity: -3,
        marqueeTokenFilter: "<script>",
        marqueeLevelFilter: "other-scene"
    });
    const tooHigh = parseAdvancedSettingsForm({ sharedCursorOpacity: 42 });
    const notFinite = parseAdvancedSettingsForm({ sharedCursorOpacity: "Infinity" });

    assert.equal(tooLow.sharedCursorOpacity, 0.1);
    assert.equal(tooHigh.sharedCursorOpacity, 1);
    assert.equal(notFinite.sharedCursorOpacity, 1);
    assert.equal(tooLow.marqueeTokenFilter, "all");
    assert.equal(tooLow.marqueeLevelFilter, "all");
});
