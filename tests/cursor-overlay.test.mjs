import assert from 'node:assert/strict';
import { test } from 'node:test';

class FakeContainer {
    constructor() {
        this.children = [];
        this.parent = null;
        this.destroyed = false;
        this.visible = true;
        this.alpha = 1;
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
    beginFill() { return this; }
    lineStyle() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    closePath() { return this; }
    endFill() { return this; }
    drawCircle() { return this; }
}

class FakeText extends FakeContainer {
    constructor(text) {
        super();
        this.text = text;
        this.anchor = { set() {} };
    }
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
