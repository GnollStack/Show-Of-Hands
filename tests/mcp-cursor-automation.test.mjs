import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { runCursorAutomation } from '../scripts/mcp-cursor-automation.js';
import { createDiagnostics } from '../scripts/diagnostics.js';

const saved = Object.fromEntries(['game', 'canvas', 'document', 'foundry'].map(key => [key, globalThis[key]]));
afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
    }
});

function environment({ stored = '"receive"', failMode, restoreFailure = false, broken = false } = {}) {
    const key = 'show-of-hands.cursor-sharing-mode';
    const values = new Map(stored === null ? [] : [[key, stored]]);
    const storage = {
        getItem: name => values.get(name) ?? null,
        setItem: (name, value) => values.set(name, value),
        removeItem: name => values.delete(name)
    };
    let enabled = true;
    let css = 'custom';
    let failed = false;
    const writes = [];
    const packets = [];
    const mode = () => JSON.parse(storage.getItem(key) ?? '"share"');
    globalThis.document = {
        documentElement: { style: { getPropertyValue: () => css } },
        getElementById: () => enabled ? {} : null
    };
    globalThis.foundry = {};
    globalThis.canvas = { ready: true, scene: { id: 'scene' }, mousePosition: { x: 123, y: 456 } };
    globalThis.game = {
        users: [{ id: 'gm', active: true }, { id: 'player', active: true }],
        settings: {
            storage: new Map([['client', storage]]),
            get: (_module, name) => name === 'cursor-sharing-mode' ? mode() : 'off',
            async set(_module, name, value) {
                assert.equal(name, 'cursor-sharing-mode');
                writes.push(value);
                storage.setItem(key, JSON.stringify(value));
                if (value === failMode && !failed) {
                    failed = true;
                    throw new Error('mode failed');
                }
                if (failed && restoreFailure) throw new Error('restore failed');
                if (value !== 'share') game.socket.emit('module.show-of-hands', { type: 'cursorHidden', userId: 'gm' });
            }
        },
        configureCursors() { css = enabled && !broken ? 'custom' : 'native'; },
        socket: {
            emit(...args) {
                assert.equal(this, game.socket);
                packets.push(args);
                return 'forwarded';
            }
        },
        user: {
            id: 'gm',
            broadcastActivity(activity, options) {
                assert.deepEqual(options, { volatile: false });
                if (mode() !== 'private' || broken) return game.socket.emit('userActivity', this.id, activity);
            }
        }
    };
    const emit = game.socket.emit;
    const dependencies = {
        async applyStyles(value = true) {
            enabled = value;
            css = enabled ? 'custom' : 'native';
        },
        readSharing: () => ({
            active: true, broadcastEnabled: mode() === 'share',
            socketListenerActive: true, nativeUserActivityListenerActive: true,
            registeredMouseHandler: true, broadcastInFlight: false, broadcastQueued: false
        }),
        async collectClients() {
            return { clients: [{
                user: { id: 'player', isGM: false }, scene: { id: 'scene' },
                settings: { cursorSharingMode: 'share' },
                moduleState: { cursorOverlay: { cursorCount: mode() === 'share' ? 1 : 0 } }
            }] };
        }
    };
    return { dependencies, emit, mode, packets, writes, storage, key, get css() { return css; } };
}

test('cursor automation exercises real broadcasts and restores stored or absent preferences', async () => {
    for (const stored of ['"receive"', '"private"', null]) {
        const env = environment({ stored });
        const result = await runCursorAutomation(env.dependencies);
        assert.equal(result.success, true);
        assert.equal(result.failed, 0);
        assert.equal(result.clients.length, 4);
        assert.equal(result.skipped, 1); // no detached document
        assert.equal(env.storage.getItem(env.key), stored);
        assert.equal(game.socket.emit, env.emit);
        assert.equal(env.css, 'custom');
        assert.deepEqual(env.writes.slice(0, 4), ['share', 'receive', 'private', 'share']);
        const activities = env.packets.filter(packet => packet[0] === 'userActivity');
        assert.equal(activities.length, 9);
        assert.deepEqual(activities[0], ['userActivity', 'gm', { cursor: { x: 123, y: 456 } }]);
    }
});

test('cursor automation detects native cursor reset and privacy regressions without losing preferences', async () => {
    const env = environment({ broken: true });
    const result = await runCursorAutomation(env.dependencies);
    assert.equal(result.success, false);
    assert.ok(result.checks.some(check => check.name === 'private: native cursor privacy' && check.status === 'fail'));
    assert.ok(result.checks.some(check => check.name.includes('native configuration') && check.status === 'fail'));
    assert.equal(env.mode(), 'receive');
    assert.equal(game.socket.emit, env.emit);
});

test('cursor automation restores after a partial setting write or scene transition', async () => {
    const env = environment({ failMode: 'private' });
    await assert.rejects(runCursorAutomation(env.dependencies), /mode failed/);
    assert.equal(env.mode(), 'receive');
    assert.equal(game.socket.emit, env.emit);
    assert.equal(env.css, 'custom');

    env.dependencies.collectClients = async () => {
        canvas.scene.id = 'other-scene';
        return { clients: [] };
    };
    await assert.rejects(runCursorAutomation(env.dependencies), /Canvas or user changed/);
    assert.equal(env.mode(), 'receive');
    assert.equal(game.socket.emit, env.emit);
});

test('cursor automation exposes both failure causes and always removes the socket observer', async () => {
    const env = environment({ failMode: 'private', restoreFailure: true });
    await assert.rejects(runCursorAutomation(env.dependencies), error => {
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors.map(item => item.message), ['mode failed', 'restore failed']);
        assert.match(error.message, /restoration failed/);
        return true;
    });
    assert.equal(game.socket.emit, env.emit);
    assert.equal(env.css, 'custom');
});

test('cursor automation rejects concurrent runs before a second mutation and reports missing peers', async () => {
    const env = environment();
    let resume;
    let reached;
    const ready = new Promise(resolve => { reached = resolve; });
    env.dependencies.collectClients = async () => {
        reached();
        await new Promise(resolve => { resume = resolve; });
        return { clients: [] };
    };
    const first = runCursorAutomation(env.dependencies);
    await ready;
    const writes = env.writes.length;
    await assert.rejects(runCursorAutomation(env.dependencies), /already running/);
    assert.equal(env.writes.length, writes);
    env.dependencies.collectClients = async () => ({ clients: [] });
    // The running function captured the collector, so release each phase.
    const interval = setInterval(() => resume?.(), 1);
    try {
        const result = await first;
        assert.equal(result.skipped, 5);
        assert.equal(env.mode(), 'receive');
    } finally { clearInterval(interval); }
});

test('the cursor automation entry point retains every diagnostics gate and rejects unknown suites', async () => {
    for (const deniedGate of ['gm', 'debug', 'world', 'confirmation', 'unknown']) {
        const env = environment();
        game.user.isGM = deniedGate !== 'gm';
        const originalGet = game.settings.get;
        game.settings.get = (moduleId, key) => {
            if (key === 'debug-mode') return deniedGate === 'debug' ? 'off' : 'cursor';
            if (key === 'enableMcpDiagnostics') return deniedGate !== 'world';
            return originalGet(moduleId, key);
        };
        const { actions } = createDiagnostics();
        const result = await actions.runAutomation({
            suite: deniedGate === 'unknown' ? 'unknown' : 'cursor',
            confirmMutation: deniedGate !== 'confirmation'
        });
        assert.equal(result.success, false);
        assert.equal(result.mutationAvailable, deniedGate === 'unknown');
        assert.deepEqual(env.writes, []);
        assert.deepEqual(env.packets, []);
        assert.equal(env.css, 'custom');
        assert.equal(game.socket.emit, env.emit);
    }
});
