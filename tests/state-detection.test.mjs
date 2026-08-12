import assert from 'node:assert/strict';
import { test } from 'node:test';

class FakeClassList {
    #values = new Set();

    add(...names) {
        for (const name of names) this.#values.add(name);
    }

    remove(...names) {
        for (const name of names) this.#values.delete(name);
    }

    contains(name) {
        return this.#values.has(name);
    }

    toggle(name, force) {
        if (force === true) this.#values.add(name);
        else if (force === false) this.#values.delete(name);
        else if (this.#values.has(name)) this.#values.delete(name);
        else this.#values.add(name);
    }
}

function listenerRegistry() {
    const listeners = new Map();
    return {
        listeners,
        add(type, handler) {
            listeners.set(type, handler);
        },
        remove(type, handler) {
            if (listeners.get(type) === handler) listeners.delete(type);
        }
    };
}

test('held cursor state tracks primary presses and clears on release, cancel, blur, and cleanup', async () => {
    const previous = {
        document: globalThis.document,
        addEventListener: globalThis.addEventListener,
        removeEventListener: globalThis.removeEventListener,
        Hooks: globalThis.Hooks,
        canvas: globalThis.canvas,
        game: globalThis.game,
        ui: globalThis.ui
    };

    const documentEvents = listenerRegistry();
    const windowEvents = listenerRegistry();
    const stageEvents = listenerRegistry();
    const hookEvents = listenerRegistry();
    const depressedElements = [];
    const body = { classList: new FakeClassList() };
    const board = {
        classList: new FakeClassList(),
        contains: target => target?.insideBoard === true,
        isConnected: true
    };

    globalThis.document = {
        body,
        getElementById: id => id === "board" ? board : null,
        querySelectorAll: selector => selector === '[data-cursor]'
            ? depressedElements.filter(element => Object.prototype.hasOwnProperty.call(element.dataset, 'cursor'))
            : [],
        addEventListener: (type, handler) => documentEvents.add(type, handler),
        removeEventListener: (type, handler) => documentEvents.remove(type, handler)
    };
    globalThis.addEventListener = (type, handler) => windowEvents.add(type, handler);
    globalThis.removeEventListener = (type, handler) => windowEvents.remove(type, handler);
    globalThis.Hooks = {
        on: (type, handler) => hookEvents.add(type, handler),
        off: (type, handler) => hookEvents.remove(type, handler)
    };
    globalThis.canvas = {
        mouseInteractionManager: { options: { dragResistance: 10 } },
        app: {
            stage: {
                on: (type, handler) => stageEvents.add(type, handler),
                off: (type, handler) => stageEvents.remove(type, handler)
            }
        }
    };
    globalThis.game = {
        activeTool: "select",
        settings: { get: () => "off" },
        user: {}
    };
    globalThis.ui = { controls: {} };

    try {
        const { cleanupCursorStateListeners, setupCursorStateListeners } = await import('../scripts/state-detection.js');
        setupCursorStateListeners();

        assert.equal(hookEvents.listeners.has("activateSceneControls"), true);
        globalThis.game.activeTool = "target";
        hookEvents.listeners.get("activateSceneControls")();
        assert.equal(
            board.classList.contains("ttb-cursor-targeting"),
            true,
            "same-control V14 tool activation must enable the targeting cursor"
        );
        globalThis.game.activeTool = "select";
        hookEvents.listeners.get("activateSceneControls")();
        assert.equal(
            board.classList.contains("ttb-cursor-targeting"),
            false,
            "same-control V14 tool activation must clear the targeting cursor"
        );

        const clickableTarget = {
            ownerDocument: globalThis.document,
            closest: selector => selector.includes("[draggable='true']") ? null : clickableTarget
        };
        documentEvents.listeners.get("pointerdown")({
            button: 0,
            isPrimary: true,
            pointerId: 11,
            target: clickableTarget
        });
        assert.equal(body.classList.contains("ttb-cursor-click"), true);
        assert.equal(board.classList.contains("ttb-cursor-click"), false);

        documentEvents.listeners.get("pointerup")({ pointerId: 12 });
        assert.equal(body.classList.contains("ttb-cursor-click"), true, "another pointer must not clear the held state");

        const plainTarget = { closest: () => null };
        documentEvents.listeners.get("pointerdown")({
            button: 0,
            isPrimary: true,
            pointerId: 13,
            target: plainTarget
        });
        assert.equal(body.classList.contains("ttb-cursor-click"), false, "a new primary press recovers a lost release");

        documentEvents.listeners.get("pointerdown")({
            button: 0,
            isPrimary: true,
            pointerId: 11,
            target: clickableTarget
        });
        const depressed = { style: { cursor: 'var(--cursor-pointer-down)' }, dataset: { cursor: 'pointer' } };
        depressedElements.push(depressed);

        documentEvents.listeners.get("pointercancel")({ pointerId: 11 });
        assert.equal(body.classList.contains("ttb-cursor-click"), false);
        assert.equal(depressed.style.cursor, 'pointer');
        assert.equal(Object.prototype.hasOwnProperty.call(depressed.dataset, 'cursor'), false);

        documentEvents.listeners.get("pointerdown")({
            button: 0,
            isPrimary: true,
            pointerId: 21,
            target: board
        });
        assert.equal(body.classList.contains("ttb-cursor-click"), false, "canvas presses use Foundry's native down mapping");
        assert.equal(board.classList.contains("ttb-cursor-click"), false);

        const draggableTarget = { closest: () => draggableTarget };
        documentEvents.listeners.get("pointerdown")({
            button: 0,
            isPrimary: true,
            pointerId: 22,
            target: draggableTarget
        });
        assert.equal(body.classList.contains("ttb-cursor-click"), false, "drag sources retain grab/grabbing priority");

        for (const inactiveState of [':disabled', '[disabled]', '[readonly]', "[aria-disabled='true']"]) {
            const inactiveTarget = {
                ownerDocument: globalThis.document,
                matches: selector => selector.includes(inactiveState),
                closest: selector => selector.includes("[draggable='true']") ? null : inactiveTarget
            };
            documentEvents.listeners.get("pointerdown")({
                button: 0,
                isPrimary: true,
                pointerId: inactiveState,
                target: inactiveTarget
            });
            assert.equal(
                body.classList.contains("ttb-cursor-click"),
                false,
                `${inactiveState} controls must retain Foundry's inactive cursor state`
            );
        }

        const panningEvent = (pointerId, x, y, button = 2, buttons) => ({
            pointerId,
            button,
            ...(buttons === undefined ? {} : { buttons }),
            global: { x, y },
            originalEvent: { pointerId, button, ...(buttons === undefined ? {} : { buttons }) }
        });
        stageEvents.listeners.get("pointerdown")(panningEvent(40, 10, 10));
        assert.equal(
            board.classList.contains("ttb-cursor-panning"),
            false,
            "right-button down alone is not yet a panning drag"
        );
        stageEvents.listeners.get("pointermove")(panningEvent(41, 30, 10, -1));
        stageEvents.listeners.get("pointermove")(panningEvent(40, 19, 10, -1));
        assert.equal(
            board.classList.contains("ttb-cursor-panning"),
            false,
            "another pointer and movement below Foundry drag resistance must not start panning"
        );
        stageEvents.listeners.get("pointermove")(panningEvent(40, 20, 10, -1));
        assert.equal(
            board.classList.contains("ttb-cursor-panning"),
            true,
            "crossing Foundry drag resistance starts the panning cursor"
        );
        stageEvents.listeners.get("pointerup")(panningEvent(41, 20, 10));
        assert.equal(
            board.classList.contains("ttb-cursor-panning"),
            true,
            "another pointer cannot end the panning cursor"
        );
        stageEvents.listeners.get("pointerup")(panningEvent(40, 20, 10));
        assert.equal(board.classList.contains("ttb-cursor-panning"), false);

        stageEvents.listeners.get("pointerdown")(panningEvent(42, 0, 0));
        stageEvents.listeners.get("pointerup")(panningEvent(42, 0, 0));
        assert.equal(
            board.classList.contains("ttb-cursor-panning"),
            false,
            "a plain right-click never enters panning"
        );

        stageEvents.listeners.get("pointerdown")(panningEvent(44, 0, 0, 2, 2));
        stageEvents.listeners.get("pointermove")(panningEvent(44, 20, 0, -1, 0));
        assert.equal(
            board.classList.contains("ttb-cursor-panning"),
            false,
            "a move proving the secondary button is released disarms a lost-release gesture"
        );
        stageEvents.listeners.get("pointermove")(panningEvent(44, 30, 0, -1, 0));
        assert.equal(board.classList.contains("ttb-cursor-panning"), false);

        stageEvents.listeners.get("pointerdown")(panningEvent(43, 0, 0));
        stageEvents.listeners.get("pointermove")(panningEvent(43, 10, 0, -1));
        assert.equal(board.classList.contains("ttb-cursor-panning"), true);
        windowEvents.listeners.get("blur")();
        assert.equal(body.classList.contains("ttb-cursor-click"), false);
        assert.equal(board.classList.contains("ttb-cursor-click"), false);
        assert.equal(board.classList.contains("ttb-cursor-panning"), false, "blur clears an active panning drag");
        stageEvents.listeners.get("pointermove")(panningEvent(43, 20, 0, -1));
        assert.equal(board.classList.contains("ttb-cursor-panning"), false, "blur also drops panning pointer ownership");

        // V14 pop-out documents receive the same held lifecycle and restore
        // Foundry's inline depressed cursor on cancellation.
        const detachedEvents = listenerRegistry();
        const detachedWindowEvents = listenerRegistry();
        const detachedDepressed = [];
        const detachedDocument = {
            body: { classList: new FakeClassList() },
            defaultView: {
                addEventListener: (type, handler) => detachedWindowEvents.add(type, handler),
                removeEventListener: (type, handler) => detachedWindowEvents.remove(type, handler)
            },
            addEventListener: (type, handler) => detachedEvents.add(type, handler),
            removeEventListener: (type, handler) => detachedEvents.remove(type, handler),
            querySelectorAll: selector => selector === '[data-cursor]'
                ? detachedDepressed.filter(element => Object.prototype.hasOwnProperty.call(element.dataset, 'cursor'))
                : []
        };
        const detachedWindow = { document: detachedDocument, closed: false };
        hookEvents.listeners.get('openDetachedWindow')('detached-test', detachedWindow);
        assert.equal(detachedEvents.listeners.has('pointerdown'), true);
        assert.equal(detachedWindowEvents.listeners.has('blur'), true);

        const detachedClickable = {
            ownerDocument: detachedDocument,
            closest: selector => selector.includes("[draggable='true']") ? null : detachedClickable
        };
        detachedEvents.listeners.get('pointerdown')({
            button: 0,
            isPrimary: true,
            pointerId: 30,
            target: detachedClickable
        });
        assert.equal(detachedDocument.body.classList.contains('ttb-cursor-click'), true);
        const detachedDown = { style: { cursor: 'var(--cursor-pointer-down)' }, dataset: { cursor: 'pointer' } };
        detachedDepressed.push(detachedDown);
        detachedEvents.listeners.get('pointercancel')({ pointerId: 30, target: detachedClickable });
        assert.equal(detachedDocument.body.classList.contains('ttb-cursor-click'), false);
        assert.equal(detachedDown.style.cursor, 'pointer');
        assert.equal(Object.prototype.hasOwnProperty.call(detachedDown.dataset, 'cursor'), false);

        hookEvents.listeners.get('closeDetachedWindow')('detached-test', detachedWindow);
        assert.equal(detachedEvents.listeners.has('pointerdown'), false);
        assert.equal(detachedWindowEvents.listeners.has('blur'), false);

        documentEvents.listeners.get("pointerdown")({
            button: 0,
            isPrimary: true,
            pointerId: 31,
            target: clickableTarget
        });
        const replacementStageEvents = listenerRegistry();
        globalThis.canvas.app.stage = {
            on: (type, handler) => replacementStageEvents.add(type, handler),
            off: (type, handler) => replacementStageEvents.remove(type, handler)
        };
        cleanupCursorStateListeners();

        assert.equal(body.classList.contains("ttb-cursor-click"), false);
        assert.equal(board.classList.contains("ttb-cursor-click"), false);
        assert.equal(documentEvents.listeners.has("pointerdown"), false);
        assert.equal(documentEvents.listeners.has("pointerup"), false);
        assert.equal(documentEvents.listeners.has("pointercancel"), false);
        assert.equal(windowEvents.listeners.has("blur"), false);
        assert.equal(stageEvents.listeners.has("pointerdown"), false, "cleanup must detach from the originally registered stage");
        assert.equal(stageEvents.listeners.has("pointermove"), false);
        assert.equal(stageEvents.listeners.has("pointercancel"), false);
        assert.equal(hookEvents.listeners.has("activateSceneControls"), false);
        assert.equal(replacementStageEvents.listeners.size, 0, "cleanup must not touch a replacement stage");
    } finally {
        globalThis.document = previous.document;
        globalThis.addEventListener = previous.addEventListener;
        globalThis.removeEventListener = previous.removeEventListener;
        globalThis.Hooks = previous.Hooks;
        globalThis.canvas = previous.canvas;
        globalThis.game = previous.game;
        globalThis.ui = previous.ui;
    }
});
