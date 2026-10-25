import assert from 'node:assert/strict';
import { test } from 'node:test';

class FakeContainer {
    constructor() {
        this.children = [];
        this.parent = null;
        this.destroyed = false;
        this.visible = true;
        this.alpha = 1;
        this.scale = {
            x: 1,
            y: 1,
            set: (x, y = x) => {
                this.scale.x = x;
                this.scale.y = y;
            }
        };
        this.position = {
            x: 0,
            y: 0,
            set: (x, y) => {
                this.position.x = x;
                this.position.y = y;
            }
        };
    }

    addChild(...children) {
        for (const child of children) {
            child.parent = this;
            this.children.push(child);
        }
        return children.at(-1);
    }

    addChildAt(child, index) {
        child.parent = this;
        this.children.splice(index, 0, child);
        return child;
    }

    removeChild(child) {
        this.children = this.children.filter(candidate => candidate !== child);
        child.parent = null;
    }

    on() {}
    off() {}

    destroy({ children = false } = {}) {
        if (children) {
            for (const child of this.children) child.destroy?.({ children: true });
        }
        this.children = [];
        this.destroyed = true;
    }
}

class FakeGraphics extends FakeContainer {
    clear() {
        this.fillColor = null;
        return this;
    }
    beginFill(color) {
        this.fillColor = color;
        return this;
    }
    lineStyle() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    closePath() { return this; }
    endFill() { return this; }
    drawCircle() { return this; }
}

class FakeText extends FakeContainer {
    constructor(text, style = {}) {
        super();
        this.text = text;
        this.style = { ...style };
        this.anchor = { set() {} };
    }
}

function makeNativeCursor(user, x, y) {
    const cursor = new FakeContainer();
    cursor.target = { x, y };
    const dot = new FakeGraphics();
    const name = new FakeText(user.name);
    cursor.addChild(dot, name);
    return { cursor, dot, name };
}

function makeValidPngDataUrl(width = 1, height = 1) {
    const bytes = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(bytes, 0);
    Buffer.from('IHDR').copy(bytes, 12);
    bytes.writeUInt32BE(width, 16);
    bytes.writeUInt32BE(height, 20);
    return `data:image/png;base64,${bytes.toString('base64')}`;
}

async function withSharingEnvironment(name, run) {
    const keys = ['canvas', 'game', 'foundry', 'Hooks', 'PIXI', 'CONFIG', 'Image', 'setTimeout', 'clearTimeout', 'libWrapper'];
    const previous = Object.fromEntries(keys.map(key => [key, globalThis[key]]));
    const priorNow = Date.now;
    const socketListeners = new Map();
    const hookListeners = new Map();
    const tickers = new Set();
    const mouseHandlers = new Set();
    const emissions = [];
    const timers = new Map();
    const images = [];
    const cursorParent = new FakeContainer();
    let now = 1000;
    let nextTimerId = 0;
    const makeUser = id => ({
        id, name: id, color: 0x102030, active: true,
        viewedScene: 'scene-1', viewedLevel: 'ground', cursorAllowed: true,
        hasPermission(permission) { return permission !== 'SHOW_CURSOR' || this.cursorAllowed; },
        getFlag: () => ({ useCustomCursor: false })
    });
    const local = makeUser('local');
    const remote = makeUser('remote');
    Date.now = () => now;
    globalThis.setTimeout = function(callback, delay) {
        if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
        const id = ++nextTimerId;
        timers.set(id, { callback, due: now + delay });
        return id;
    };
    globalThis.clearTimeout = function(id) {
        if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
        return timers.delete(id);
    };
    globalThis.PIXI = { Container: FakeContainer, Graphics: FakeGraphics, Text: FakeText };
    globalThis.CONFIG = { Canvas: { maxZoom: 3 } };
    globalThis.Image = class {
        set src(value) { this.source = value; images.push(this); }
        removeAttribute() { this.source = null; }
    };
    globalThis.foundry = { utils: { mergeObject: (base, value) => Object.assign(structuredClone(base), value) } };
    const socket = {
        emit: (...args) => emissions.push(args),
        on(event, handler) {
            const handlers = socketListeners.get(event) ?? new Set();
            handlers.add(handler);
            socketListeners.set(event, handlers);
        },
        off(event, handler) { socketListeners.get(event)?.delete(handler); }
    };
    socket.volatile = socket;
    globalThis.game = {
        user: local, users: new Map([[local.id, local], [remote.id, remote]]), socket,
        settings: { get: (_scope, key) => key === 'hidden-shared-cursor-users' ? {} : 'off' }
    };
    globalThis.Hooks = {
        on(event, handler) { hookListeners.set(event, handler); return handler; },
        off(event, handler) { if (hookListeners.get(event) === handler) hookListeners.delete(event); }
    };
    globalThis.canvas = {
        ready: true, scene: { id: 'scene-1' }, level: { id: 'ground' }, controls: { cursors: cursorParent },
        registerMouseMoveHandler(handler) { mouseHandlers.add(handler); },
        app: {
            stage: { worldTransform: { apply: (point, output) => Object.assign(output, point) } },
            ticker: { add: callback => tickers.add(callback), remove: callback => tickers.delete(callback) }
        }
    };
    let sharing;
    let overlay;
    try {
        const moduleUrl = new URL('../scripts/cursor-sharing.js', import.meta.url);
        moduleUrl.searchParams.set('sharing-runtime', name);
        sharing = await import(moduleUrl);
        overlay = await import('../scripts/cursor-overlay.js');
        const receive = (data, senderId = remote.id) => {
            for (const handler of socketListeners.get('module.show-of-hands') ?? []) handler({ userId: remote.id, ...data }, senderId);
        };
        const activity = data => {
            for (const handler of socketListeners.get('userActivity') ?? []) handler(remote.id, data);
        };
        const advance = milliseconds => {
            const target = now + milliseconds;
            while (true) {
                const next = [...timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
                if (!next) break;
                const [id, timer] = next;
                timers.delete(id);
                now = timer.due;
                timer.callback();
            }
            now = target;
        };
        const move = (x = 10, y = 20) => receive({ type: 'cursorMove', sceneId: 'scene-1', levelId: 'ground', x, y });
        const cursorImage = imageDataUrl => receive({ type: 'cursorImage', imageDataUrl, hotspotX: 0, hotspotY: 0 });
        await run({ sharing, overlay, local, remote, receive, activity, advance, move, cursorImage, images, timers,
            emissions, socketListeners, hookListeners, mouseHandlers, cursorParent, tick: () => { for (const tick of tickers) tick(); } });
    } finally {
        sharing?.stopCursorSharing();
        overlay?.destroyCursorOverlay();
        Date.now = priorNow;
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
    }
}

for (const mode of ['native', 'keep', 'fit']) {
    for (const privacyMode of ['share', 'receive', 'private']) {
        test(`GM pull ${mode} routes once with ${privacyMode} cursor mode`, async () => {
            await withSharingEnvironment(`pull-${mode}-${privacyMode}`, async env => {
                const { sharing, local, remote, emissions, receive, advance } = env;
                local.isGM = true;
                local.isSelf = true;
                game.settings.get = (_scope, key) => key === 'gm-pull-view-mode' ? mode
                    : (key === 'hidden-shared-cursor-users' ? {} : 'off');
                canvas.stage = { scale: { x: 1.25 } };
                canvas.app.renderer = { screen: { width: 1920, height: 1080 } };
                canvas.dimensions = { scale: { min: 0.01, max: 12 } };
                const native = [];
                const received = [];
                canvas.controls.handlePing = (...args) => { received.push(args); return Promise.resolve(true); };
                class User {
                    broadcastActivity(activity, options) { native.push({ activity, options }); return 'forwarded'; }
                }
                foundry.documents = { User };
                globalThis.libWrapper = undefined;
                const privacy = await import(`../scripts/privacy-broadcast.js?matrix=${mode}-${privacyMode}`);
                const callbacks = {
                    isPrivateMode: () => privacyMode === 'private',
                    emitHiddenPing: sharing.broadcastHiddenPing,
                    emitGmPullView: sharing.broadcastGmPullView
                };
                privacy.installCursorPrivacyBroadcastWrapper(callbacks);
                privacy.installCursorPrivacyBroadcastWrapper(callbacks);
                sharing.startCursorSharing(privacyMode === 'share');
                emissions.length = 0;
                const position = Object.freeze({ x: 2000, y: 1500 });
                const ping = Object.freeze({ scene: 'scene-1', style: 'pulse', pull: true, zoom: 1.25 });
                const activity = Object.freeze({ cursor: position, ping, targets: ['kept'] });
                User.prototype.broadcastActivity.call(local, activity, { volatile: false });
                assert.equal(received.length, 0, 'broadcast wrapper leaves local ping rendering to Foundry');
                assert.equal(native.length, 1, 'unrelated targets forward exactly once');
                assert.deepEqual(native[0].activity.targets, ['kept']);
                assert.equal('cursor' in native[0].activity, privacyMode !== 'private');
                assert.equal('ping' in native[0].activity, mode === 'native' && privacyMode !== 'private');
                assert.equal(activity.ping, ping, 'original remains available to the local Canvas.ping call');
                const packet = emissions.find(e => ['gmPullView', 'hiddenPing'].includes(e[1].type))?.[1];
                const hasModulePing = mode !== 'native' || privacyMode === 'private';
                assert.equal(emissions.length, hasModulePing ? 1 : 0);
                if (!hasModulePing) return;
                assert.equal(packet.type, mode === 'native' ? 'hiddenPing' : 'gmPullView');
                if (mode === 'fit') assert.deepEqual(packet.view, { width: 1536, height: 864 });
                // Exercise receiver handling for two differently shaped player
                // canvases. Live browser transport is a separate acceptance check.
                game.user = remote;
                for (const [width, height, current, fit] of [[1280, 1024, 2, 5 / 6], [2560, 1080, 0.5, 1.25]]) {
                    canvas.app.renderer.screen = { width, height };
                    canvas.stage.scale.x = current;
                    advance(501);
                    const before = received.length;
                    receive(packet, local.id);
                    assert.equal(received.length, before + 1);
                    const [sender, point, options] = received.at(-1);
                    assert.equal(sender, local);
                    assert.deepEqual(point, position);
                    assert.equal(options.pull, true);
                    assert.ok(Math.abs(options.zoom - (mode === 'fit' ? fit : mode === 'keep' ? current : 1.25)) < 1e-9);
                }
            });
        });
    }
}

test('GM pull receiver enforces authority, view, validation, and shared ping rate limit', async () => {
    await withSharingEnvironment('pull-authority', async env => {
        const { sharing, receive, remote, advance } = env;
        const calls = [];
        canvas.stage = { scale: { x: 0.75 } };
        canvas.app.renderer = { screen: { width: 1280, height: 1024 } };
        canvas.dimensions = { scale: { min: 0.01, max: 10 } };
        canvas.controls.handlePing = (...args) => calls.push(args);
        sharing.startCursorSharing(false);
        const packet = { type: 'gmPullView', mode: 'keep', sceneId: 'scene-1', levelId: 'ground',
            position: { x: 100, y: 200 }, ping: { pull: true, zoom: 1, style: 'injected', duration: 99999 } };
        receive(packet); // Player cannot pull.
        remote.isGM = true;
        receive({ ...packet, userId: 'local' }); // Authenticated ID mismatch.
        receive({ ...packet, sceneId: 'other' });
        receive({ ...packet, levelId: 'other' });
        remote.viewedScene = 'other'; receive(packet); remote.viewedScene = 'scene-1';
        remote.viewedLevel = 'other'; receive(packet); remote.viewedLevel = 'ground';
        remote.hasPermission = () => false; receive(packet); remote.hasPermission = () => true;
        receive({ ...packet, mode: 'fit', view: { width: NaN, height: 2 } });
        assert.equal(calls.length, 0);
        receive(packet);
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0][2], { scene: 'scene-1', style: 'pulse', pull: true, zoom: 0.75 });
        receive(packet);
        receive({ ...packet, type: 'hiddenPing' });
        assert.equal(calls.length, 1, 'both module ping types share the limiter');
        advance(501);
        receive({ ...packet, type: 'hiddenPing', ping: { pull: true, zoom: 6 } });
        assert.equal(calls.at(-1)[2].zoom, 6);
        advance(501);
        receive({ ...packet, type: 'hiddenPing', ping: { pull: true, zoom: 0.05 } });
        assert.equal(calls.at(-1)[2].zoom, 0.05);
        sharing.stopCursorSharing();
        receive(packet);
        assert.equal(calls.length, 3, 'teardown removes the receiver');
        sharing.startCursorSharing(false);
        canvas.scene.id = 'new-scene';
        receive(packet);
        assert.equal(calls.length, 3, 'old scene packets cannot pull after restart');
    });
});

test('GM pull sender falls back when capture, permission, connection, or lifecycle is unavailable', async () => {
    await withSharingEnvironment('pull-fallback', async env => {
        const { sharing, local } = env;
        game.settings.get = (_scope, key) => key === 'gm-pull-view-mode' ? 'fit' : 'off';
        local.isGM = true;
        const ping = { scene: 'scene-1', pull: true, zoom: 1 };
        const point = { x: 10, y: 20 };
        assert.equal(sharing.broadcastGmPullView(point, ping), false);
        sharing.startCursorSharing(false);
        assert.equal(sharing.broadcastGmPullView(point, ping), false, 'no viewport');
        canvas.stage = { scale: { x: 1 } };
        canvas.app.renderer = { screen: { width: 1920, height: 1080 } };
        local.hasPermission = () => false;
        assert.equal(sharing.broadcastGmPullView(point, ping), false);
        local.hasPermission = () => true;
        game.socket.connected = false;
        assert.equal(sharing.broadcastGmPullView(point, ping), false);
        game.socket.connected = true;
        assert.equal(sharing.broadcastGmPullView(point, { ...ping, scene: 'other' }), false);
        assert.equal(sharing.broadcastGmPullView(point, ping), true);
    });
});

test('switching idle fade paths resets child opacity and restores active cursor opacity', async () => {
    await withSharingEnvironment('fade-transition', async env => {
        const { sharing, overlay, move, advance, tick, cursorParent } = env;
        for (const [key, value] of Object.entries({ showNames: true, foundryCursorDisplay: 'none',
            cursorOpacity: 0.8, disableCursorFade: false, idleIdentityFade: true })) overlay.updateOverlaySetting(key, value);
        sharing.startCursorSharing(false);
        move(); tick(); advance(5500); tick();
        const entry = cursorParent.children[0].children[0];
        const arrow = entry.children[0].children[0];
        const name = entry.children[1];
        assert.equal(entry.alpha * arrow.alpha, 0.4);
        overlay.updateOverlaySetting('idleIdentityFade', false); tick();
        assert.equal(entry.alpha * arrow.alpha, 0.4);
        assert.equal(entry.alpha * name.alpha, 0.4);
        overlay.updateOverlaySetting('idleIdentityFade', true); tick();
        assert.equal(entry.alpha * arrow.alpha, 0.4);
        advance(30); move(); tick();
        assert.equal(entry.alpha * arrow.alpha, 0.8);
        for (const [key, value] of Object.entries({ showNames: false, foundryCursorDisplay: 'both',
            cursorOpacity: 1, idleIdentityFade: false })) overlay.updateOverlaySetting(key, value);
    });
});

test('sharing bridge preserves native movement authority and targets image responses to the authenticated requester', async () => {
    await withSharingEnvironment('native-and-requests', async env => {
        const { sharing, activity, move, cursorImage, cursorParent, receive, emissions, local, advance } = env;
        sharing.startCursorSharing(false);
        activity({ cursor: { x: 100, y: 200 } });
        assert.equal(env.overlay.getCursorOverlayDebugState().cursorCount, 0, 'native-only peer has no module arrow');
        cursorImage(null);
        move(1, 2);
        const entry = cursorParent.children[0].children[0];
        assert.deepEqual(entry.position, { x: 100, y: 200, set: entry.position.set });
        sharing.setCursorBroadcastEnabled(true);
        emissions.length = 0;
        receive({ type: 'requestCursorImage', userId: 'someone-else' });
        assert.equal(emissions.length, 0, 'spoofed requester is ignored');
        receive({ type: 'requestCursorImage' });
        assert.equal(emissions.length, 1);
        assert.equal(emissions[0][1].type, 'cursorImage');
        assert.deepEqual(emissions[0][2], { recipients: ['remote'] });
        receive({ type: 'requestCursorImage' });
        assert.equal(emissions.length, 1, 'repeated requests are rate-limited');
        local.cursorAllowed = false;
        advance(1000);
        receive({ type: 'requestCursorImage' });
        assert.equal(emissions.at(-1)[1].type, 'cursorHidden');
        assert.deepEqual(emissions.at(-1)[2], { recipients: ['remote'] });
    });
});

test('sharing bridge cancels queued images on clear, hide, and disconnect without resurrecting overlays', async () => {
    await withSharingEnvironment('image-cancellation', async env => {
        const { sharing, move, cursorImage, images, timers, advance, receive, hookListeners, remote, overlay } = env;
        sharing.startCursorSharing(false);
        move();
        const image = makeValidPngDataUrl(16, 16);
        cursorImage(image);
        cursorImage(image);
        assert.equal(images.length, 1);
        cursorImage(null);
        assert.equal(timers.size, 0, 'clear cancels both coalescing and decode');
        cursorImage(image);
        assert.equal(images.length, 1, 'clear retains the non-null rate history');
        advance(250);
        assert.equal(images.length, 2);
        cursorImage(image);
        receive({ type: 'cursorHidden' });
        advance(250);
        assert.equal(overlay.getCursorOverlayDebugState().cursorCount, 0);
        assert.equal(timers.size, 0);
        move();
        cursorImage(image);
        cursorImage(image);
        hookListeners.get('userConnected')(remote, false);
        advance(250);
        assert.equal(overlay.getCursorOverlayDebugState().cursorCount, 0);
        assert.equal(timers.size, 0);
        assert.ok(images.every(img => img.onload === null), 'all abandoned decodes lose their callbacks');
    });
});

test('sharing lifecycle clears old scenes, enforces permissions, and reuses its mouse handler', async () => {
    await withSharingEnvironment('lifecycle', async env => {
        const { sharing, overlay, move, remote, activity, tick, cursorImage, timers, socketListeners, mouseHandlers, emissions } = env;
        sharing.startCursorSharing(false);
        sharing.startCursorSharing(false);
        assert.equal(mouseHandlers.size, 1);
        assert.equal(socketListeners.get('module.show-of-hands').size, 1);
        move();
        remote.cursorAllowed = false;
        tick();
        assert.equal(overlay.getCursorOverlayDebugState().cursorCount, 0);
        remote.cursorAllowed = true;
        env.advance(30);
        move();
        remote.viewedLevel = 'upstairs';
        activity({ levelId: 'upstairs' });
        assert.equal(overlay.getCursorOverlayDebugState().cursorCount, 0);
        env.advance(30);
        move();
        assert.equal(overlay.getCursorOverlayDebugState().cursorCount, 0, 'a stale ground-floor packet cannot cross levels');
        remote.viewedLevel = 'ground';
        move();
        cursorImage(makeValidPngDataUrl(16, 16));
        cursorImage(makeValidPngDataUrl(16, 16));
        sharing.stopCursorSharing();
        overlay.destroyCursorOverlay();
        assert.equal(timers.size, 0);
        assert.equal(socketListeners.get('module.show-of-hands').size, 0);
        assert.equal(socketListeners.get('userActivity').size, 0);
        canvas.scene = { id: 'scene-2' };
        sharing.startCursorSharing(false);
        assert.equal(mouseHandlers.size, 1);
        move();
        assert.equal(overlay.getCursorOverlayDebugState().cursorCount, 0, 'old scene traffic cannot recreate entries');
        emissions.length = 0;
        for (const moveHandler of mouseHandlers) moveHandler({ x: 100, y: 200 });
        assert.equal(emissions.length, 0, 'receive-only mode does not emit local movement');
    });
});

test('pending native movement wins when delayed module movement creates an overlay', async () => {
    const previous = {
        canvas: globalThis.canvas,
        game: globalThis.game,
        PIXI: globalThis.PIXI
    };
    const cursorParent = new FakeContainer();
    const tickerCallbacks = new Set();
    globalThis.PIXI = {
        Container: FakeContainer,
        Graphics: FakeGraphics,
        Text: FakeText
    };
    globalThis.game = {
        user: { id: 'local' },
        users: new Map([
            ['remote', { id: 'remote', name: 'Remote', color: 0xFF0000 }]
        ]),
        settings: { get: () => 'off' }
    };
    globalThis.canvas = {
        ready: true,
        controls: { cursors: cursorParent },
        app: {
            stage: {
                worldTransform: {
                    apply(point, output) {
                        output.x = point.x;
                        output.y = point.y;
                    }
                }
            },
            ticker: {
                add: callback => tickerCallbacks.add(callback),
                remove: callback => tickerCallbacks.delete(callback)
            }
        }
    };

    try {
        const moduleUrl = new URL('../scripts/cursor-overlay.js', import.meta.url);
        moduleUrl.searchParams.set('native-order-test', String(Date.now()));
        const { destroyCursorOverlay, updateRemoteCursor } = await import(moduleUrl);

        updateRemoteCursor('remote', 100, 200, { source: 'native' });
        const overlay = cursorParent.children[0];
        assert.equal(overlay.children.length, 0, 'native movement alone must not create a fallback arrow');

        updateRemoteCursor('remote', 10, 20, { source: 'module' });
        assert.equal(overlay.children.length, 1);
        const remoteCursor = overlay.children[0];
        assert.deepEqual(
            { x: remoteCursor.position.x, y: remoteCursor.position.y },
            { x: 100, y: 200 },
            'the parked native position must seed the entry before the stale module packet is considered'
        );

        updateRemoteCursor('remote', 30, 40, { source: 'module' });
        assert.deepEqual(
            { x: remoteCursor.position.x, y: remoteCursor.position.y },
            { x: 100, y: 200 },
            'native authority must continue rejecting later module fallback movement'
        );

        destroyCursorOverlay();
        assert.equal(tickerCallbacks.size, 0);
    } finally {
        globalThis.canvas = previous.canvas;
        globalThis.game = previous.game;
        globalThis.PIXI = previous.PIXI;
    }
});

test('module names suppress only matching overlay peers and preserve native-only peer labels', async () => {
    const previous = {
        canvas: globalThis.canvas,
        CONFIG: globalThis.CONFIG,
        game: globalThis.game,
        PIXI: globalThis.PIXI
    };
    const cursorParent = new FakeContainer();
    const tickerCallbacks = new Set();
    const sharingUser = {
        id: 'sharing', name: 'Same Name', color: 0xFF0000,
        viewedScene: 'scene-1', viewedLevel: 'ground', hasPermission: () => true
    };
    const nativeOnlyUser = {
        id: 'native-only', name: 'Same Name', color: 0x00FF00,
        viewedScene: 'scene-1', viewedLevel: 'ground', hasPermission: () => true
    };
    // Use the same position and display name for both peers. Foundry V14's
    // direct user-to-cursor lookup must keep the association unambiguous.
    const sharingNative = makeNativeCursor(sharingUser, 10, 20);
    const nativeOnly = makeNativeCursor(nativeOnlyUser, 10, 20);
    cursorParent.addChild(sharingNative.cursor, nativeOnly.cursor);

    globalThis.PIXI = { Container: FakeContainer, Graphics: FakeGraphics, Text: FakeText };
    globalThis.CONFIG = { Canvas: { maxZoom: 3 } };
    globalThis.game = {
        user: { id: 'local' },
        users: new Map([
            [sharingUser.id, sharingUser],
            [nativeOnlyUser.id, nativeOnlyUser]
        ]),
        settings: { get: () => 'off' }
    };
    globalThis.canvas = {
        ready: true,
        scene: { id: 'scene-1' },
        level: { id: 'ground' },
        controls: {
            cursors: cursorParent,
            getCursorForUser(userId) {
                if (userId === sharingUser.id) return sharingNative.cursor;
                if (userId === nativeOnlyUser.id) return nativeOnly.cursor;
                return null;
            }
        },
        app: {
            stage: { worldTransform: { apply: (point, output) => Object.assign(output, point) } },
            ticker: {
                add: callback => tickerCallbacks.add(callback),
                remove: callback => tickerCallbacks.delete(callback)
            }
        }
    };

    try {
        const moduleUrl = new URL('../scripts/cursor-overlay.js', import.meta.url);
        moduleUrl.searchParams.set('native-name-test', String(Date.now()));
        const {
            destroyCursorOverlay,
            observeNativeCursorActivity,
            removeRemoteCursor,
            updateOverlaySetting,
            updateRemoteCursor
        } = await import(moduleUrl);

        observeNativeCursorActivity(sharingUser.id, sharingNative.cursor.target);
        observeNativeCursorActivity(nativeOnlyUser.id, nativeOnly.cursor.target);
        updateRemoteCursor(sharingUser.id, 10, 20, { source: 'module' });
        updateOverlaySetting('showNames', true);
        for (const callback of tickerCallbacks) callback();

        assert.equal(sharingNative.name.visible, false, 'an overlay peer should not get a duplicate native name');
        assert.equal(nativeOnly.name.visible, true, 'a Receive Only/native-only peer must retain its native label');

        removeRemoteCursor(sharingUser.id);
        for (const callback of tickerCallbacks) callback();
        assert.equal(sharingNative.name.visible, true, 'locally hiding/removing an overlay must restore its native label');

        destroyCursorOverlay();
        assert.equal(sharingNative.name.visible, true);
        assert.equal(nativeOnly.name.visible, true);
    } finally {
        globalThis.canvas = previous.canvas;
        globalThis.CONFIG = previous.CONFIG;
        globalThis.game = previous.game;
        globalThis.PIXI = previous.PIXI;
    }
});

test('remote User color and name changes refresh existing overlay identity art', async () => {
    const previous = {
        canvas: globalThis.canvas,
        game: globalThis.game,
        PIXI: globalThis.PIXI
    };
    const cursorParent = new FakeContainer();
    const remote = { id: 'remote', name: 'Before', color: 0x112233 };
    globalThis.PIXI = { Container: FakeContainer, Graphics: FakeGraphics, Text: FakeText };
    globalThis.game = {
        user: { id: 'local' },
        users: new Map([[remote.id, remote]]),
        settings: { get: () => 'off' }
    };
    globalThis.canvas = {
        controls: { cursors: cursorParent },
        app: {
            stage: { worldTransform: { apply: (point, output) => Object.assign(output, point) } },
            ticker: { add() {}, remove() {} }
        }
    };

    try {
        const moduleUrl = new URL('../scripts/cursor-overlay.js', import.meta.url);
        moduleUrl.searchParams.set('identity-refresh-test', String(Date.now()));
        const { destroyCursorOverlay, updateRemoteCursor, updateRemoteCursorUser } = await import(moduleUrl);
        updateRemoteCursor(remote.id, 10, 20);

        const overlay = cursorParent.children.find(child => child.name === 'ttb-cursor-sharing');
        const entryContainer = overlay.children[0];
        const [artContainer, name, idleDot, idleName] = entryContainer.children;
        const arrow = artContainer.children[0];
        assert.equal(arrow.fillColor, 0x112233);
        assert.equal(name.style.fill, 0x112233);

        remote.name = 'After';
        remote.color = 0xAABBCC;
        updateRemoteCursorUser(remote.id);

        assert.equal(arrow.fillColor, 0xAABBCC);
        assert.equal(idleDot.fillColor, 0xAABBCC);
        assert.equal(name.style.fill, 0xAABBCC);
        assert.equal(idleName.style.fill, 0xAABBCC);
        assert.equal(name.text, 'After');
        assert.equal(idleName.text, 'After');
        destroyCursorOverlay();
    } finally {
        globalThis.canvas = previous.canvas;
        globalThis.game = previous.game;
        globalThis.PIXI = previous.PIXI;
    }
});

test('a rename refreshes pending image metadata before the first overlay movement', async () => {
    const previous = {
        canvas: globalThis.canvas,
        game: globalThis.game,
        PIXI: globalThis.PIXI
    };
    const cursorParent = new FakeContainer();
    const remote = { id: 'remote', name: 'Before', color: 0x112233 };
    globalThis.PIXI = { Container: FakeContainer, Graphics: FakeGraphics, Text: FakeText };
    globalThis.game = {
        user: { id: 'local' },
        users: new Map([[remote.id, remote]]),
        settings: { get: () => 'off' }
    };
    globalThis.canvas = {
        controls: { cursors: cursorParent },
        app: {
            stage: { worldTransform: { apply: (point, output) => Object.assign(output, point) } },
            ticker: { add() {}, remove() {} }
        }
    };

    try {
        const moduleUrl = new URL('../scripts/cursor-overlay.js', import.meta.url);
        moduleUrl.searchParams.set('pending-identity-refresh-test', String(Date.now()));
        const {
            destroyCursorOverlay,
            updateRemoteCursor,
            updateRemoteCursorImage,
            updateRemoteCursorUser
        } = await import(moduleUrl);

        updateRemoteCursorImage(remote.id, null, 0, 0, 'Before');
        remote.name = 'After';
        updateRemoteCursorUser(remote.id);
        updateRemoteCursor(remote.id, 10, 20, { source: 'module' });

        const overlay = cursorParent.children.find(child => child.name === 'ttb-cursor-sharing');
        const [, name, , idleName] = overlay.children[0].children;
        assert.equal(name.text, 'After');
        assert.equal(idleName.text, 'After');
        destroyCursorOverlay();
    } finally {
        globalThis.canvas = previous.canvas;
        globalThis.game = previous.game;
        globalThis.PIXI = previous.PIXI;
    }
});

test('stalled inbound image decode times out, falls back, and cancels stale loads', async () => {
    const previous = {
        canvas: globalThis.canvas,
        clearTimeout: globalThis.clearTimeout,
        game: globalThis.game,
        Image: globalThis.Image,
        PIXI: globalThis.PIXI,
        setTimeout: globalThis.setTimeout,
        warn: console.warn
    };
    const cursorParent = new FakeContainer();
    const remote = { id: 'remote', name: 'Remote', color: 0x123456 };
    const images = [];
    const timers = new Map();
    let nextTimerId = 1;
    globalThis.PIXI = { Container: FakeContainer, Graphics: FakeGraphics, Text: FakeText };
    globalThis.game = {
        user: { id: 'local' },
        users: new Map([[remote.id, remote]]),
        settings: { get: () => 'off' }
    };
    globalThis.canvas = {
        controls: { cursors: cursorParent },
        app: {
            stage: { worldTransform: { apply: (point, output) => Object.assign(output, point) } },
            ticker: { add() {}, remove() {} }
        }
    };
    globalThis.Image = class {
        constructor() {
            this.removedAttribute = null;
            images.push(this);
        }
        set src(value) { this._src = value; }
        removeAttribute(name) { this.removedAttribute = name; }
    };
    globalThis.setTimeout = (callback, delay) => {
        const id = nextTimerId++;
        timers.set(id, { callback, delay });
        return id;
    };
    globalThis.clearTimeout = id => timers.delete(id);
    console.warn = () => {};

    try {
        const moduleUrl = new URL('../scripts/cursor-overlay.js', import.meta.url);
        moduleUrl.searchParams.set('decode-timeout-test', String(Date.now()));
        const {
            CURSOR_IMAGE_DECODE_TIMEOUT_MS,
            destroyCursorOverlay,
            updateRemoteCursor,
            updateRemoteCursorImage
        } = await import(moduleUrl);
        updateRemoteCursor(remote.id, 10, 20);
        const imageData = makeValidPngDataUrl(16, 16);

        updateRemoteCursorImage(remote.id, imageData, 0, 0, remote.name);
        const firstImage = images[0];
        assert.equal(timers.size, 1);
        assert.equal([...timers.values()][0].delay, CURSOR_IMAGE_DECODE_TIMEOUT_MS);

        updateRemoteCursorImage(remote.id, imageData, 0, 0, remote.name);
        assert.equal(firstImage.onload, null, 'a superseded decode must lose its callbacks');
        assert.equal(firstImage.onerror, null);
        assert.equal(firstImage.removedAttribute, 'src');
        assert.equal(timers.size, 1, 'a superseded decode timer must be cleared');

        const [timerId, timer] = [...timers.entries()][0];
        timers.delete(timerId);
        timer.callback();
        const secondImage = images[1];
        assert.equal(secondImage.onload, null);
        assert.equal(secondImage.onerror, null);
        assert.equal(secondImage.removedAttribute, 'src');
        assert.equal(timers.size, 0);

        const overlay = cursorParent.children.find(child => child.name === 'ttb-cursor-sharing');
        const arrow = overlay.children[0].children[0].children[0];
        assert.equal(arrow.visible, true, 'timeout must leave a safe fallback arrow visible');

        updateRemoteCursorImage(remote.id, imageData, 0, 0, remote.name);
        const thirdImage = images[2];
        assert.equal(timers.size, 1);
        destroyCursorOverlay();
        assert.equal(timers.size, 0, 'teardown must clear an in-flight decode timer');
        assert.equal(thirdImage.removedAttribute, 'src');
        assert.equal(thirdImage.onload, null);
        assert.equal(thirdImage.onerror, null);
    } finally {
        globalThis.canvas = previous.canvas;
        globalThis.clearTimeout = previous.clearTimeout;
        globalThis.game = previous.game;
        globalThis.Image = previous.Image;
        globalThis.PIXI = previous.PIXI;
        globalThis.setTimeout = previous.setTimeout;
        console.warn = previous.warn;
    }
});

test('cursor-sharing updateUser hook propagates remote identity changes to the live overlay', async () => {
    const previous = {
        canvas: globalThis.canvas,
        game: globalThis.game,
        Hooks: globalThis.Hooks,
        PIXI: globalThis.PIXI
    };
    const cursorParent = new FakeContainer();
    const remote = {
        id: 'remote', name: 'Remote', color: 0x102030,
        viewedScene: 'scene-1', viewedLevel: 'ground', hasPermission: () => true
    };
    const socketListeners = new Map();
    const hookListeners = new Map();
    globalThis.PIXI = { Container: FakeContainer, Graphics: FakeGraphics, Text: FakeText };
    globalThis.game = {
        user: { id: 'local' },
        users: new Map([[remote.id, remote]]),
        settings: {
            get(namespace, key) {
                if (key === 'debug-mode') return 'off';
                if (key === 'hidden-shared-cursor-users') return {};
                return null;
            }
        },
        socket: {
            emit() {},
            on(event, callback) { socketListeners.set(event, callback); },
            off(event) { socketListeners.delete(event); }
        }
    };
    globalThis.Hooks = {
        on(event, callback) {
            hookListeners.set(event, callback);
            return event;
        },
        off(event) { hookListeners.delete(event); }
    };
    globalThis.canvas = {
        ready: true,
        scene: { id: 'scene-1' },
        level: { id: 'ground' },
        controls: { cursors: cursorParent },
        registerMouseMoveHandler() {},
        app: {
            stage: { worldTransform: { apply: (point, output) => Object.assign(output, point) } },
            ticker: { add() {}, remove() {} }
        }
    };

    try {
        const sharingUrl = new URL('../scripts/cursor-sharing.js', import.meta.url);
        sharingUrl.searchParams.set('identity-hook-test', String(Date.now()));
        const { startCursorSharing, stopCursorSharing } = await import(sharingUrl);
        const overlay = await import('../scripts/cursor-overlay.js');
        startCursorSharing(false);

        socketListeners.get('module.show-of-hands')({
            type: 'cursorMove',
            userId: remote.id,
            sceneId: 'scene-1',
            levelId: 'ground',
            x: 10,
            y: 20
        }, remote.id);
        const overlayContainer = cursorParent.children.find(child => child.name === 'ttb-cursor-sharing');
        const entryContainer = overlayContainer.children[0];
        const [artContainer, name] = entryContainer.children;
        const arrow = artContainer.children[0];
        assert.equal(arrow.fillColor, 0x102030);

        remote.name = 'Renamed';
        remote.color = 0xABCDEF;
        hookListeners.get('updateUser')(remote, { name: 'Renamed', color: 0xABCDEF });
        assert.equal(arrow.fillColor, 0xABCDEF);
        assert.equal(name.style.fill, 0xABCDEF);
        assert.equal(name.text, 'Renamed');

        stopCursorSharing();
        overlay.destroyCursorOverlay();
    } finally {
        globalThis.canvas = previous.canvas;
        globalThis.game = previous.game;
        globalThis.Hooks = previous.Hooks;
        globalThis.PIXI = previous.PIXI;
    }
});
