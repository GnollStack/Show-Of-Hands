import assert from 'node:assert/strict';
import { test } from 'node:test';

class ListenerRegistry {
    constructor() {
        this.listeners = new Map();
    }

    add(type, handler) {
        const handlers = this.listeners.get(type) ?? new Set();
        handlers.add(handler);
        this.listeners.set(type, handlers);
    }

    remove(type, handler) {
        const handlers = this.listeners.get(type);
        handlers?.delete(handler);
        if (!handlers?.size) this.listeners.delete(type);
    }

    emit(type, event) {
        for (const handler of [...(this.listeners.get(type) ?? [])]) handler(event);
    }

    has(type) {
        return (this.listeners.get(type)?.size ?? 0) > 0;
    }
}

class FakeGraphics {
    clear() {}
    beginFill() {}
    lineStyle() {}
    drawRect() {}
    endFill() {}

    destroy() {
        this.destroyed = true;
    }
}

function pointerEvent(pointerId, x, y, button = 1, shiftKey = false) {
    return {
        pointerId,
        global: { x, y },
        originalEvent: { pointerId, button, shiftKey }
    };
}

function restoreGlobal(key, value) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
}

test('marquee runtime owns its pointer, throttles previews, flushes release, and restores cancellations atomically', async () => {
    const previous = {
        addEventListener: globalThis.addEventListener,
        removeEventListener: globalThis.removeEventListener,
        cancelAnimationFrame: globalThis.cancelAnimationFrame,
        requestAnimationFrame: globalThis.requestAnimationFrame,
        document: globalThis.document,
        game: globalThis.game,
        canvas: globalThis.canvas,
        CONST: globalThis.CONST,
        PIXI: globalThis.PIXI
    };

    const stageEvents = new ListenerRegistry();
    const windowEvents = new ListenerRegistry();
    const documentEvents = new ListenerRegistry();
    const rafCallbacks = new Map();
    const targetCalls = [];
    let boundsReads = 0;
    const filterReads = new Map();
    const filters = { 'marquee-token-filter': 'all', 'marquee-level-filter': 'all' };
    let nextRafId = 1;
    let cleanupMarqueeListener;
    let toggleMarqueeListener;

    const tokens = [
        { id: 'a', visible: true, destroyed: false, bounds: { left: 1, top: 1, right: 5, bottom: 5 } },
        { id: 'b', visible: true, destroyed: false, bounds: { left: 20, top: 20, right: 25, bottom: 25 } },
        { id: 'c', visible: true, destroyed: false, bounds: { left: 45, top: 45, right: 50, bottom: 50 } }
    ];
    const tokenById = new Map(tokens.map(token => [token.id, token]));
    for (const token of tokens) {
        const bounds = token.bounds;
        Object.defineProperty(token, 'bounds', { get() { boundsReads++; return bounds; } });
    }

    const stage = {
        on: (type, handler) => stageEvents.add(type, handler),
        off: (type, handler) => stageEvents.remove(type, handler),
        toLocal: point => ({ x: point.x, y: point.y })
    };
    const controls = {
        addChild(graphics) {
            graphics.parent = controls;
        },
        removeChild(graphics) {
            if (graphics.parent === controls) graphics.parent = null;
        }
    };

    function setCurrentTargets(ids) {
        globalThis.game.user.targets = new Set(ids.map(id => tokenById.get(id)));
    }

    function flushAnimationFrame(timestamp) {
        const callbacks = [...rafCallbacks.values()];
        rafCallbacks.clear();
        for (const callback of callbacks) callback(timestamp);
    }

    globalThis.addEventListener = (type, handler) => windowEvents.add(type, handler);
    globalThis.removeEventListener = (type, handler) => windowEvents.remove(type, handler);
    globalThis.document = {
        hidden: false,
        addEventListener: (type, handler) => documentEvents.add(type, handler),
        removeEventListener: (type, handler) => documentEvents.remove(type, handler)
    };
    globalThis.requestAnimationFrame = callback => {
        const id = nextRafId++;
        rafCallbacks.set(id, callback);
        return id;
    };
    globalThis.cancelAnimationFrame = id => rafCallbacks.delete(id);
    globalThis.PIXI = { Graphics: FakeGraphics };
    globalThis.game = {
        settings: {
            get(moduleId, key) {
                assert.equal(moduleId, 'show-of-hands');
                if (key === 'debug-mode') return 'off';
                if (key === 'middle-mouse-actions') return 'both';
                if (key === 'marquee-token-filter' || key === 'marquee-level-filter') {
                    filterReads.set(key, (filterReads.get(key) ?? 0) + 1);
                    return filters[key];
                }
                if (key === 'clear-targets-on-empty-click') return true;
                throw new Error(`Unexpected setting: ${key}`);
            }
        },
        user: { isGM: false, targets: new Set([tokens[0]]) },
        keybindings: { actions: new Map() }
    };
    globalThis.canvas = {
        app: { stage },
        stage,
        controls,
        tokens: {
            hover: null,
            placeables: tokens,
            setTargets(ids, options) {
                targetCalls.push({ ids: [...ids], options: { ...options } });
                setCurrentTargets(ids);
            }
        }
    };

    try {
        const moduleUrl = new URL('../scripts/marquee-select.js', import.meta.url);
        moduleUrl.searchParams.set('runtime-test', String(Date.now()));
        ({ cleanupMarqueeListener, toggleMarqueeListener } = await import(moduleUrl));
        toggleMarqueeListener(true);
        assert.equal(stageEvents.has('pointerdown'), true);

        // A different pointer cannot move, release, or cancel this gesture.
        stageEvents.emit('pointerdown', pointerEvent(11, 0, 0, 1));
        stageEvents.emit('pointermove', pointerEvent(12, 60, 60, -1));
        assert.equal(rafCallbacks.size, 0);

        stageEvents.emit('pointermove', pointerEvent(11, 30, 30, -1));
        for (let index = 0; index < 100; index++) stageEvents.emit('pointermove', pointerEvent(11, 60, 60, -1));
        stageEvents.emit('pointermove', pointerEvent(11, 28, 28, -1));
        assert.equal(rafCallbacks.size, 1, 'multiple moves share one queued animation frame');
        assert.equal(targetCalls.length, 0);
        assert.equal(boundsReads, 0, 'raw move bursts must not hit-test tokens');
        assert.equal(filterReads.size, 0, 'raw move bursts must not read filters');

        flushAnimationFrame(16);
        assert.equal(targetCalls.length, 0, 'the first frame remains inside the 33ms throttle');
        assert.equal(rafCallbacks.size, 1);
        assert.equal(boundsReads, 0, 'throttled frames do not hit-test');
        flushAnimationFrame(40);
        assert.deepEqual(targetCalls, [{ ids: ['a', 'b'], options: { mode: 'replace' } }]);
        assert.equal(boundsReads, 3, 'only the most recent rectangle is evaluated once');
        assert.deepEqual([...filterReads.values()], [1, 1], 'read each filter once per pass');

        stageEvents.emit('pointermove', pointerEvent(11, 40, 40, -1));
        assert.equal(rafCallbacks.size, 1);
        stageEvents.emit('pointerup', pointerEvent(12, 60, 60, 1));
        stageEvents.emit('pointercancel', pointerEvent(12, 60, 60, 1));
        stageEvents.emit('pointerup', pointerEvent(11, 60, 60, 0));
        assert.equal(targetCalls.length, 1, 'unowned or non-middle endings cannot finish the gesture');
        assert.equal(stageEvents.has('pointermove'), true);

        // The owned middle release cancels the queued preview and flushes the
        // exact release rectangle with one collection-level update.
        stageEvents.emit('pointerup', pointerEvent(11, 60, 60, 1));
        assert.equal(rafCallbacks.size, 0);
        assert.deepEqual(targetCalls[1], { ids: ['a', 'b', 'c'], options: { mode: 'replace' } });
        assert.equal(targetCalls.length, 2);
        assert.equal(boundsReads, 6, 'release performs one immediate hit-test pass');
        assert.equal(stageEvents.has('pointermove'), false);
        assert.equal(stageEvents.has('pointerup'), false);
        assert.equal(stageEvents.has('pointercancel'), false);

        // Pointer cancellation restores the pre-drag baseline exactly once.
        setCurrentTargets(['a']);
        stageEvents.emit('pointerdown', pointerEvent(21, 10, 10, 1));
        stageEvents.emit('pointermove', pointerEvent(21, 30, 30, -1));
        flushAnimationFrame(100);
        assert.deepEqual(targetCalls[2], { ids: ['b'], options: { mode: 'replace' } });
        stageEvents.emit('pointercancel', pointerEvent(22, 30, 30, 1));
        assert.equal(targetCalls.length, 3);
        stageEvents.emit('pointercancel', pointerEvent(21, 30, 30, 1));
        assert.deepEqual(targetCalls[3], { ids: ['a'], options: { mode: 'replace' } });
        assert.equal(targetCalls.length, 4);

        // A fresh middle-button down is stale-gesture recovery: rollback the
        // old preview before taking ownership of the new pointer.
        setCurrentTargets(['a']);
        stageEvents.emit('pointerdown', pointerEvent(31, 10, 10, 1));
        stageEvents.emit('pointermove', pointerEvent(31, 30, 30, -1));
        flushAnimationFrame(150);
        assert.deepEqual(targetCalls[4], { ids: ['b'], options: { mode: 'replace' } });

        stageEvents.emit('pointerdown', pointerEvent(32, 0, 0, 1));
        assert.deepEqual(targetCalls[5], { ids: ['a'], options: { mode: 'replace' } });
        assert.equal(targetCalls.length, 6);
        stageEvents.emit('pointerup', pointerEvent(31, 60, 60, 1));
        assert.equal(stageEvents.has('pointermove'), true, 'the stale pointer cannot finish the new gesture');
        stageEvents.emit('pointercancel', pointerEvent(32, 0, 0, 1));
        assert.equal(targetCalls.length, 6, 'cancel before drag does not emit a redundant target update');

        // Visibility is evaluated at reconciliation time, not when a move was
        // queued. Shift keeps the baseline and uses the latest modifier state.
        setCurrentTargets(['c']);
        stageEvents.emit('pointerdown', pointerEvent(41, 0, 0));
        stageEvents.emit('pointermove', pointerEvent(41, 30, 30, -1, false));
        stageEvents.emit('pointermove', pointerEvent(41, 30, 30, -1, true));
        tokens[1].visible = false;
        flushAnimationFrame(200);
        assert.deepEqual([...game.user.targets].map(token => token.id).sort(), ['a', 'c']);
        stageEvents.emit('pointermove', pointerEvent(41, 60, 60, -1));
        const readsBeforeCancel = boundsReads;
        windowEvents.emit('blur', {});
        assert.deepEqual([...game.user.targets].map(token => token.id), ['c']);
        assert.equal(rafCallbacks.size, 0);
        assert.equal(boundsReads, readsBeforeCancel, 'cancellation drops queued work');
        tokens[1].visible = true;

        // Cached per-pass filters retain the visibility -> level -> disposition
        // ordering, and changes between frames are observed on the next pass.
        globalThis.CONST = { TOKEN_DISPOSITIONS: { HOSTILE: -1, FRIENDLY: 1 } };
        canvas.level = { id: 'ground' };
        tokens[0].document = { level: 'ground', disposition: -1 };
        tokens[1].document = { level: 'upstairs', disposition: -1 };
        tokens[2].document = { level: 'ground', disposition: 1 };
        tokens[0].visible = false;
        filters['marquee-level-filter'] = 'viewed';
        filters['marquee-token-filter'] = 'hostile';
        setCurrentTargets([]);
        stageEvents.emit('pointerdown', pointerEvent(51, 0, 0));
        stageEvents.emit('pointermove', pointerEvent(51, 60, 60, -1));
        flushAnimationFrame(300);
        assert.equal(game.user.targets.size, 0, 'players cannot select hidden, other-level, or non-hostile tokens');
        game.user.isGM = true;
        stageEvents.emit('pointermove', pointerEvent(51, 61, 61, -1));
        flushAnimationFrame(340);
        assert.deepEqual([...game.user.targets].map(token => token.id), ['a']);
        filters['marquee-level-filter'] = 'all';
        stageEvents.emit('pointermove', pointerEvent(51, 62, 62, -1));
        flushAnimationFrame(380);
        assert.deepEqual([...game.user.targets].map(token => token.id), ['a', 'b']);
        filters['marquee-level-filter'] = 'viewed';
        canvas.level = null;
        stageEvents.emit('pointermove', pointerEvent(51, 63, 63, -1));
        flushAnimationFrame(420);
        assert.deepEqual([...game.user.targets].map(token => token.id), ['a', 'b'], 'viewed filter is a no-op without level context');
        stageEvents.emit('pointercancel', pointerEvent(51, 63, 63));

        // Base listener cleanup is tied to the exact stage that received it,
        // even if Foundry has already replaced canvas.app.stage.
        const replacementStageEvents = new ListenerRegistry();
        globalThis.canvas.app.stage = {
            on: (type, handler) => replacementStageEvents.add(type, handler),
            off: (type, handler) => replacementStageEvents.remove(type, handler),
            toLocal: point => ({ ...point })
        };
        toggleMarqueeListener(false);
        assert.equal(stageEvents.has('pointerdown'), false);
        assert.equal(replacementStageEvents.has('pointerdown'), false);
        assert.equal(windowEvents.has('blur'), false);
        assert.equal(documentEvents.has('visibilitychange'), false);
        for (const call of targetCalls) assert.deepEqual(call.options, { mode: 'replace' });
    } finally {
        cleanupMarqueeListener?.();
        for (const [key, value] of Object.entries(previous)) restoreGlobal(key, value);
    }
});
