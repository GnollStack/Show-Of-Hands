import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

const saved = Object.fromEntries(['game', 'foundry', 'libWrapper'].map(key => [key, globalThis[key]]));
afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
    }
});

test('libWrapper keeps privacy filtering installed across repeated dropped and mixed native activity', async () => {
    const sent = [];
    const hiddenPings = [];
    let privateMode = true;
    let registrations = 0;
    let removals = 0;
    class User {
        isSelf = true;
        broadcastActivity(activity, options) {
            sent.push({ user: this, activity, options });
            return 'native-result';
        }
    }
    globalThis.foundry = { documents: { User } };
    globalThis.game = { user: new User() };
    globalThis.libWrapper = {
        register(moduleId, target, wrapper, type) {
            registrations += 1;
            assert.equal(moduleId, 'show-of-hands');
            assert.equal(target, 'foundry.documents.User.prototype.broadcastActivity');
            const original = User.prototype.broadcastActivity;
            User.prototype.broadcastActivity = function(...args) {
                let continued = false;
                const result = wrapper.call(this, (...forwarded) => {
                    continued = true;
                    return original.call(this, ...forwarded);
                }, ...args);
                // libWrapper's documented WRAPPER contract: an omitted call
                // unregisters the wrapper. MIXED permits dropping activity.
                if (type === 'WRAPPER' && !continued) {
                    removals += 1;
                    User.prototype.broadcastActivity = original;
                }
                return result;
            };
        }
    };
    const privacy = await import('../scripts/privacy-broadcast.js?test=libwrapper');
    const callbacks = { isPrivateMode: () => privateMode, emitHiddenPing: (...args) => hiddenPings.push(args) };
    privacy.installCursorPrivacyBroadcastWrapper(callbacks);
    privacy.installCursorPrivacyBroadcastWrapper(callbacks);
    assert.equal(registrations, 1);

    for (let i = 0; i < 3; i += 1) {
        game.user.broadcastActivity({ cursor: { x: i, y: i } }, { volatile: true });
    }
    assert.equal(removals, 0);
    assert.equal(sent.length, 0);
    const cursor = { x: 20, y: 30 };
    const ping = { style: 'pulse' };
    assert.equal(game.user.broadcastActivity({ cursor, ping, targets: ['token'] }, { volatile: false }), 'native-result');
    assert.deepEqual(sent[0], { user: game.user, activity: { targets: ['token'] }, options: { volatile: false } });
    assert.deepEqual(hiddenPings, [[cursor, ping]]);
    privacy.broadcastNativeActivity({ cursor: null }, { volatile: false });
    assert.deepEqual(sent[1], { user: game.user, activity: { cursor: null }, options: { volatile: false } });

    privateMode = false;
    game.user.broadcastActivity({ cursor });
    assert.deepEqual(sent[2].activity, { cursor });
    privateMode = true;
    game.user.broadcastActivity({ cursor });
    assert.equal(sent.length, 3);
});

test('privacy direct fallback preserves repeated suppression when libWrapper rejects registration', async () => {
    const sent = [];
    class User {
        isSelf = true;
        broadcastActivity(activity) { sent.push(activity); }
    }
    globalThis.foundry = { documents: { User } };
    globalThis.game = { user: new User() };
    globalThis.libWrapper = { register() { throw new Error('registration rejected'); } };
    const privacy = await import('../scripts/privacy-broadcast.js?test=direct');
    const state = privacy.installCursorPrivacyBroadcastWrapper({ isPrivateMode: () => true });
    assert.equal(state.mode, 'direct');
    assert.equal(state.fallbackReason, 'registration rejected');
    for (let i = 0; i < 3; i += 1) game.user.broadcastActivity({ cursor: { x: i, y: i } });
    assert.deepEqual(sent, []);
    game.user.broadcastActivity({ targets: ['token'] });
    assert.deepEqual(sent, [{ targets: ['token'] }]);
});
