import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createDiagnostics } from '../scripts/diagnostics.js';

const saved = Object.fromEntries(['game', 'canvas'].map(key => [key, globalThis[key]]));
afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
    }
});

function setup({ scene = { id: 'scene', name: 'Scene', active: true } } = {}) {
    const writes = [];
    globalThis.game = {
        version: '14.369',
        world: { id: 'world' },
        system: { id: 'dnd5e' },
        user: { id: 'player', name: 'Player', isGM: false, active: true, role: 1, can: () => true },
        users: [],
        scenes: { active: scene, viewed: scene },
        settings: {
            settings: new Map(),
            get: (_module, key) => (key === 'enableMcpDiagnostics' ? false : null),
            set: async (...entry) => writes.push(entry)
        },
        socket: { on() {}, emit: (...entry) => writes.push(entry) },
        modules: new Map()
    };
    globalThis.canvas = { scene, ready: Boolean(scene) };
    return writes;
}

test('clientEvidence answers on a player client with the diagnostics gate closed and writes nothing', () => {
    const writes = setup();
    const diagnostics = createDiagnostics({ getDebugState: () => ({ cursorSharingMode: 'share', cursorPrivateMode: false }) });
    assert.equal(diagnostics.actions.clientEvidence, undefined);
    const evidence = diagnostics.clientEvidence({}, { requesterId: 'gm', requesterName: 'GM' });
    assert.equal(evidence.success, true, evidence.reason);
    assert.equal(evidence.user.id, 'player');
    assert.equal(evidence.user.isGM, false);
    assert.equal(evidence.scene.id, 'scene');
    assert.equal(evidence.moduleState.cursorSharingMode, 'share');
    assert.ok(JSON.stringify(evidence).length <= 16000);
    assert.deepEqual(writes, []);
});

test('clientEvidence stays under 16 kB with a very large debug state', () => {
    setup();
    const large = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`key${index}`, 'x'.repeat(900)]));
    const diagnostics = createDiagnostics({ getDebugState: () => ({ cursorSharingMode: 'share', cursorPrivateMode: true, ...large }) });
    const evidence = diagnostics.clientEvidence();
    assert.equal(evidence.success, true, evidence.reason);
    assert.equal(evidence.moduleState.truncated, true);
    assert.equal(evidence.moduleState.cursorPrivateMode, true);
    assert.ok(JSON.stringify(evidence).length <= 16000);
});

test('clientEvidence returns a reason instead of throwing when debug state fails', () => {
    setup();
    const diagnostics = createDiagnostics({ getDebugState: () => { throw new Error('setting not registered'); } });
    const evidence = diagnostics.clientEvidence();
    assert.equal(evidence.success, false);
    assert.match(evidence.reason, /setting not registered/);
});
