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
        PIXI: globalThis.PIXI
    };

    const stageEvents = new ListenerRegistry();
    const windowEvents = new ListenerRegistry();
    const documentEvents = new ListenerRegistry();
    const rafCallbacks = new Map();
    const targetCalls = [];
    let nextRafId = 1;
    let cleanupMarqueeListener;
    let toggleMarqueeListener;

    const tokens = [
        { id: 'a', visible: true, destroyed: false, bounds: { left: 1, top: 1, right: 5, bottom: 5 } },
        { id: 'b', visible: true, destroyed: false, bounds: { left: 20, top: 20, right: 25, bottom: 25 } },
        { id: 'c', visible: true, destroyed: false, bounds: { left: 45, top: 45, right: 50, bottom: 50 } }
    ];
    const tokenById = new Map(tokens.map(token => [token.id, token]));

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
                if (key === 'marquee-token-filter') return 'all';
                if (key === 'marquee-level-filter') return 'all';
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
        stageEvents.emit('pointermove', pointerEvent(11, 28, 28, -1));
        assert.equal(rafCallbacks.size, 1, 'multiple moves share one queued animation frame');
        assert.equal(targetCalls.length, 0);

        flushAnimationFrame(16);
        assert.equal(targetCalls.length, 0, 'the first frame remains inside the 33ms throttle');
        assert.equal(rafCallbacks.size, 1);
        flushAnimationFrame(40);
        assert.deepEqual(targetCalls, [{ ids: ['a', 'b'], options: { mode: 'replace' } }]);

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
