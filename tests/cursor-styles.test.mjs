import assert from 'node:assert/strict';
import { test } from 'node:test';

function mergeObjects(base, override) {
    if (!base || typeof base !== 'object' || Array.isArray(base)) return override ?? base;
    const result = structuredClone(base);
    for (const [key, value] of Object.entries(override ?? {})) {
        if (value && typeof value === 'object' && !Array.isArray(value)
            && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
            result[key] = mergeObjects(result[key], value);
        } else {
            result[key] = structuredClone(value);
        }
    }
    return result;
}

test('Pressed/Held maps both Foundry down variables without masking board dragging', async () => {
    const previous = {
        document: globalThis.document,
        foundry: globalThis.foundry,
        game: globalThis.game,
        Image: globalThis.Image
    };
    const rootValues = new Map();
    const detachedRootValues = new Map();
    const styles = [];
    const detachedStyles = [];

    const makeStyle = values => ({
        setProperty: (key, value) => values.set(key, value),
        removeProperty: key => values.delete(key)
    });
    const makeDocument = (values, appendedStyles) => ({
        documentElement: { style: makeStyle(values) },
        getElementById: () => null,
        createElement: () => ({ id: '', textContent: '' }),
        head: { appendChild: style => appendedStyles.push(style) }
    });
    const mainDocument = makeDocument(rootValues, styles);
    const detachedDocument = makeDocument(detachedRootValues, detachedStyles);

    globalThis.foundry = {
        applications: {
            detached: {
                windows: new Map([['detached', { window: { closed: false, document: detachedDocument } }]])
            }
        },
        utils: {
            mergeObject: (base, override) => mergeObjects(base, override)
        }
    };
    globalThis.game = {
        configureCursors() {},
        settings: { get: () => 'off' },
        user: {
            getFlag(scope) {
                if (scope !== 'show-of-hands') return undefined;
                return {
                    useCustomCursor: true,
                    cursorStates: {
                        click: { enabled: true, image: 'pressed.png', hotspotX: 0, hotspotY: 0 },
                        drag: { enabled: true, image: '' },
                        dragging: { enabled: true, image: '' }
                    }
                };
            }
        }
    };
    globalThis.Image = class {
        width = 16;
        height = 16;
        naturalWidth = 16;
        naturalHeight = 16;

        set src(value) {
            this._src = value;
            this.onload?.();
        }
    };
    globalThis.document = mainDocument;

    try {
        const moduleUrl = new URL('../scripts/cursor-styles.js', import.meta.url);
        moduleUrl.searchParams.set('pressed-test', String(Date.now()));
        const { applyCursorStyles } = await import(moduleUrl);
        await applyCursorStyles(true);

        assert.equal(rootValues.get('--cursor-default-down'), 'var(--cursor-pointer-down)');
        assert.ok(rootValues.has('--cursor-pointer-down'));
        assert.equal(detachedRootValues.get('--cursor-default-down'), 'var(--cursor-pointer-down)');
        assert.ok(detachedRootValues.has('--cursor-pointer-down'));
        assert.equal(styles.length, 1);
        assert.equal(detachedStyles.length, 1);
        assert.equal(detachedStyles[0].textContent, styles[0].textContent);
        const css = styles[0].textContent;
        assert.match(css, /#board \{ cursor: var\(--cursor-default\); \}/);
        assert.doesNotMatch(css, /#board \{[^}]*!important/);
        assert.doesNotMatch(css, /#board\.ttb-cursor-click/);
        assert.match(css, /body\.ttb-cursor-click[^}]*--cursor-pointer-down[^}]*!important/);
        assert.doesNotMatch(css, /body\.ttb-cursor-click[^}]*--cursor-grab-down/);
        const hoverRule = css.split("\n").find(rule => (
            rule.startsWith("body :is(") && rule.includes("var(--cursor-pointer)")
        ));
        assert.ok(hoverRule, "clickable UI hover rule is generated");
        assert.match(
            hoverRule,
            /:not\(:is\(:disabled, \[disabled\], \[readonly\], \[aria-disabled='true'\]\)\)/,
            "disabled and readonly controls are excluded from Hover"
        );
        assert.match(
            hoverRule,
            /:not\(:is\([^)]*\[draggable='true'\][^)]*\)\)/,
            "a same-node drag source is excluded so Grab owns the cursor"
        );
    } finally {
        globalThis.document = previous.document;
        globalThis.foundry = previous.foundry;
        globalThis.game = previous.game;
        globalThis.Image = previous.Image;
    }
});

test('an enabled Pressed/Held state with no image preserves Foundry native default-down', async () => {
    const previous = {
        document: globalThis.document,
        foundry: globalThis.foundry,
        game: globalThis.game
    };
    const rootValues = new Map();
    const styles = [];
    const rootStyle = {
        setProperty: (key, value) => rootValues.set(key, value),
        removeProperty: key => rootValues.delete(key)
    };
    globalThis.document = {
        documentElement: { style: rootStyle },
        getElementById: () => null,
        createElement: () => ({ id: '', textContent: '' }),
        head: { appendChild: style => styles.push(style) }
    };
    globalThis.foundry = {
        applications: { detached: { windows: new Map() } },
        utils: { mergeObject: (base, override) => mergeObjects(base, override) }
    };
    globalThis.game = {
        configureCursors() {
            rootValues.set('--cursor-default-down', 'default');
        },
        settings: { get: () => 'off' },
        user: {
            getFlag(scope) {
                if (scope !== 'show-of-hands') return undefined;
                return {
                    useCustomCursor: true,
                    cursorStates: {
                        click: { enabled: true, image: '' }
                    }
                };
            }
        }
    };

    try {
        const moduleUrl = new URL('../scripts/cursor-styles.js', import.meta.url);
        moduleUrl.searchParams.set('empty-pressed-test', String(Date.now()));
        const { applyCursorStyles } = await import(moduleUrl);
        await applyCursorStyles(true);

        assert.equal(rootValues.get('--cursor-default-down'), 'default');
        assert.equal(rootValues.get('--cursor-pointer-down'), 'pointer');
        assert.equal(styles.length, 1);
    } finally {
        globalThis.document = previous.document;
        globalThis.foundry = previous.foundry;
        globalThis.game = previous.game;
    }
});

test('oversized untransformed cursor art is rasterized to the browser cap with a scaled hotspot', async () => {
    const previous = {
        document: globalThis.document,
        game: globalThis.game,
        Image: globalThis.Image
    };
    const canvases = [];

    class FakeImage {
        width = 256;
        height = 128;
        naturalWidth = 256;
        naturalHeight = 128;

        set src(value) {
            this._src = value;
            this.onload?.();
        }
    }

    globalThis.Image = FakeImage;
    globalThis.game = { settings: { get: () => 'off' } };
    globalThis.document = {
        createElement(type) {
            assert.equal(type, 'canvas');
            const drawCalls = [];
            const canvas = {
                width: 0,
                height: 0,
                drawCalls,
                getContext: () => ({ drawImage: (...args) => drawCalls.push(args) }),
                toDataURL: () => 'data:image/png;base64,processed'
            };
            canvases.push(canvas);
            return canvas;
        }
    };

    try {
        const moduleUrl = new URL('../scripts/cursor-styles.js', import.meta.url);
        moduleUrl.searchParams.set('oversized-test', String(Date.now()));
        const { getRotatedCursor } = await import(moduleUrl);
        const processed = await getRotatedCursor('oversized.png', 128, 64, 0, 0, 0);

        assert.deepEqual(processed, {
            dataUrl: 'data:image/png;base64,processed',
            hotspotX: 64,
            hotspotY: 32
        });
        assert.equal(canvases.length, 1);
        assert.equal(canvases[0].width, 128);
        assert.equal(canvases[0].height, 64);
        assert.equal(canvases[0].drawCalls.length, 1);
        assert.deepEqual(canvases[0].drawCalls[0].slice(-2), [128, 64]);
    } finally {
        globalThis.document = previous.document;
        globalThis.game = previous.game;
        globalThis.Image = previous.Image;
    }
});

test('loadImage rejects and aborts a stalled image after its bounded timeout', async () => {
    const previousImage = globalThis.Image;
    let stalledImage = null;

    globalThis.Image = class {
        constructor() {
            stalledImage = this;
        }

        set src(value) {
            this._src = value;
        }

        removeAttribute(name) {
            this.removedAttribute = name;
        }
    };

    try {
        const moduleUrl = new URL('../scripts/cursor-styles.js', import.meta.url);
        moduleUrl.searchParams.set('timeout-test', String(Date.now()));
        const { loadImage } = await import(moduleUrl);

        await assert.rejects(
            loadImage('stalled.png', { timeoutMs: 0 }),
            error => error?.name === 'TimeoutError' && /stalled\.png/.test(error.message)
        );
        assert.equal(stalledImage.removedAttribute, 'src');
        assert.equal(stalledImage.onload, null);
        assert.equal(stalledImage.onerror, null);
    } finally {
        globalThis.Image = previousImage;
    }
});

test('cursor styles build concurrently and only the latest generation atomically replaces active CSS', async () => {
    const previous = {
        document: globalThis.document,
        foundry: globalThis.foundry,
        game: globalThis.game,
        Image: globalThis.Image
    };
    const rootValues = new Map();
    const pendingImages = new Map();
    const styleNodes = [];
    const commitEvents = [];
    let profile = null;

    const rootStyle = {
        setProperty: (key, value) => rootValues.set(key, value),
        removeProperty: key => rootValues.delete(key)
    };
    const makeStyleNode = (id = '', textContent = '') => {
        const node = {
            id,
            textContent,
            remove() {
                commitEvents.push(`remove:${this.textContent}`);
                const index = styleNodes.indexOf(this);
                if (index >= 0) styleNodes.splice(index, 1);
            }
        };
        return node;
    };
    const oldStyle = makeStyleNode('show-of-hands-cursor-style', 'old-active-css');
    styleNodes.push(oldStyle);

    globalThis.document = {
        documentElement: { style: rootStyle },
        getElementById: id => styleNodes.find(node => node.id === id) ?? null,
        createElement(type) {
            assert.equal(type, 'style');
            return makeStyleNode();
        },
        head: {
            appendChild(node) {
                commitEvents.push(`append:${node.textContent}`);
                styleNodes.push(node);
            }
        }
    };
    globalThis.foundry = {
        applications: { detached: { windows: new Map() } },
        utils: { mergeObject: (base, override) => mergeObjects(base, override) }
    };
    globalThis.game = {
        configureCursors() {},
        settings: { get: () => 'off' },
        user: {
            getFlag(scope) {
                return scope === 'show-of-hands' ? profile : undefined;
            }
        }
    };
    globalThis.Image = class {
        width = 16;
        height = 16;
        naturalWidth = 16;
        naturalHeight = 16;

        set src(value) {
            this._src = value;
            pendingImages.set(value, this);
        }
    };

    try {
        const moduleUrl = new URL('../scripts/cursor-styles.js', import.meta.url);
        moduleUrl.searchParams.set('atomic-test', String(Date.now()));
        const { applyCursorStyles } = await import(moduleUrl);

        profile = {
            useCustomCursor: true,
            cursorStates: {
                default: { image: 'first-default.png', hotspotX: 0, hotspotY: 0 },
                hover: { enabled: true, image: 'first-hover.png', hotspotX: 0, hotspotY: 0 }
            }
        };
        const firstApply = applyCursorStyles(true);

        // Both state loads begin without waiting for the other, and the active
        // stylesheet remains installed while asynchronous work is pending.
        assert.ok(pendingImages.has('first-default.png'));
        assert.ok(pendingImages.has('first-hover.png'));
        assert.equal(globalThis.document.getElementById('show-of-hands-cursor-style'), oldStyle);
        assert.equal(commitEvents.length, 0);

        const latestPath = "second's\\cursor\nline.png";
        profile = {
            useCustomCursor: true,
            cursorStates: {
                default: { image: latestPath, hotspotX: 0, hotspotY: 0 }
            }
        };
        const latestApply = applyCursorStyles(true);
        assert.equal(globalThis.document.getElementById('show-of-hands-cursor-style'), oldStyle);

        pendingImages.get(latestPath).onload();
        await latestApply;

        const activeStyle = globalThis.document.getElementById('show-of-hands-cursor-style');
        assert.notEqual(activeStyle, oldStyle);
        assert.equal(
            rootValues.get('--cursor-default'),
            "url('second\\'s\\\\cursor\\a line.png') 0 0, default"
        );
        assert.equal(commitEvents[0].startsWith('append:'), true);
        assert.equal(commitEvents[1], 'remove:old-active-css');

        pendingImages.get('first-default.png').onload();
        pendingImages.get('first-hover.png').onload();
        await firstApply;

        assert.equal(globalThis.document.getElementById('show-of-hands-cursor-style'), activeStyle);
        assert.equal(styleNodes.length, 1);
        assert.equal(commitEvents.length, 2);
    } finally {
        globalThis.document = previous.document;
        globalThis.foundry = previous.foundry;
        globalThis.game = previous.game;
        globalThis.Image = previous.Image;
    }
});
