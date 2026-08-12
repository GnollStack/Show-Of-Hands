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
