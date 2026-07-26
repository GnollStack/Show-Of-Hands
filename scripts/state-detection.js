import { CURSOR_CLICKABLE_SELECTOR, CURSOR_DRAGGABLE_SELECTOR, debugLog } from './constants.js';
import { getUserCursorConfig } from './settings.js';

let _stateListenersActive = false;
let _panningHandler = null;
let _panningUpHandler = null;
let _stage = null;
let _board = null;
let _pressedPointerId = null;
let _pressedDocument = null;
const _boundDocuments = new Map();

function _getBoard() {
    if (!_board?.isConnected) _board = document.getElementById("board");
    return _board;
}

function _isBoardTarget(target) {
    const board = _getBoard();
    return !!board && (target === board || board.contains?.(target));
}

function _getClosest(target, selector) {
    try {
        return target?.closest?.(selector) ?? null;
    } catch {
        return null;
    }
}

function _getPressedUiTarget(target) {
    const clickable = _getClosest(target, CURSOR_CLICKABLE_SELECTOR);
    if (!clickable) return null;
    if (clickable.matches?.(":disabled, [readonly]")) return null;

    // When the closest drag source is the same node, or sits inside a broader
    // clickable row, Foundry's grab -> grabbing state owns the interaction. A
    // real button nested inside a draggable row still gets Pressed/Held.
    const draggable = _getClosest(target, CURSOR_DRAGGABLE_SELECTOR);
    if (draggable && (draggable === clickable || clickable.contains?.(draggable))) return null;
    return clickable;
}

function _getEventDocument(event) {
    return event?.target?.ownerDocument ?? null;
}

function _getDocumentWindow(doc) {
    if (!doc) return null;
    if (doc === globalThis.document) return globalThis;
    return doc.defaultView ?? null;
}

function _getKnownDocuments() {
    const documents = new Set();
    if (globalThis.document) documents.add(globalThis.document);

    try {
        const windows = globalThis.foundry?.applications?.detached?.windows;
        for (const descriptor of windows?.values?.() ?? []) {
            const win = descriptor?.window ?? descriptor;
            if (!win?.closed && win?.document) documents.add(win.document);
        }
    } catch {
        // A pop-out may close while the detached-window registry is iterated.
    }
    return [...documents];
}

function _restoreFoundryDownCursors(doc) {
    let restored = 0;
    try {
        for (const element of doc?.querySelectorAll?.("[data-cursor]") ?? []) {
            element.style.cursor = element.dataset.cursor ?? "";
            Reflect.deleteProperty(element.dataset, "cursor");
            restored += 1;
        }
    } catch {
        // Ignore a detached document that closed during pointer cleanup.
    }
    return restored;
}

function _clearPressedState(event, { restoreFoundry = false, restoreAll = false } = {}) {
    if (
        event?.pointerId !== undefined
        && _pressedPointerId !== null
        && event.pointerId !== _pressedPointerId
    ) return;

    const documents = new Set([..._boundDocuments.keys(), _pressedDocument, globalThis.document].filter(Boolean));
    const board = _getBoard();
    const wasActive = _pressedPointerId !== null
        || [...documents].some(doc => doc.body?.classList.contains("ttb-cursor-click"))
        || board?.classList.contains("ttb-cursor-click");
    const pressedDocument = _pressedDocument;
    _pressedPointerId = null;
    _pressedDocument = null;
    for (const doc of documents) doc.body?.classList.remove("ttb-cursor-click");
    board?.classList.remove("ttb-cursor-click");

    let restored = 0;
    if (restoreFoundry) {
        const restoreDocuments = restoreAll
            ? documents
            : new Set([pressedDocument, _getEventDocument(event)].filter(Boolean));
        for (const doc of restoreDocuments) restored += _restoreFoundryDownCursors(doc);
    }

    if (wasActive || restored > 0) {
        debugLog("states", "pressed: RELEASE/CANCEL -> removing ttb-cursor-click class");
        _logCursorState();
    }
}

function _onHeldPointerDown(event) {
    if (event.button !== 0 || event.isPrimary === false) return;

    // Any new primary press proves that an older tracked press can no longer
    // be active, even if its release was lost while focus changed.
    _clearPressedState(null, { restoreFoundry: true });

    // Foundry V14 already maps canvas default/pointer/grab interactions to
    // default-down/pointer-down/grabbing. A board-wide class would mask that
    // state machine, especially the separately configurable dragging cursor.
    if (_isBoardTarget(event.target)) {
        debugLog("states", "pressed: PRIMARY DOWN (canvas) -> using Foundry down cursor mapping");
        return;
    }

    if (!_getPressedUiTarget(event.target)) return;

    _pressedPointerId = event.pointerId ?? "mouse";
    _pressedDocument = _getEventDocument(event) ?? globalThis.document;
    _pressedDocument?.body?.classList.add("ttb-cursor-click");
    debugLog("states", "pressed: PRIMARY DOWN (UI) -> adding ttb-cursor-click class");
    _logCursorState();
}

function _onHeldPointerUp(event) {
    // Foundry normally performs this restoration itself, but doing it here as
    // well covers pop-outs and keeps cleanup correct if listener order changes.
    _clearPressedState(event, { restoreFoundry: true });
}

function _onHeldPointerCancel(event) {
    // Foundry V14 restores [data-cursor] on pointerup only. Pointer cancellation
    // has no later pointerup, so explicitly unwind its inline down cursor.
    _clearPressedState(event, { restoreFoundry: true });
}

function _clearPanningState() {
    const board = _getBoard();
    if (!board?.classList.contains("ttb-cursor-panning")) return;
    board.classList.remove("ttb-cursor-panning");
    debugLog("states", "panning: RELEASE/CANCEL -> removing ttb-cursor-panning class");
    _logCursorState();
}

function _onWindowBlur() {
    _clearPressedState(null, { restoreFoundry: true, restoreAll: true });
    _clearPanningState();
}

function _bindHeldDocument(doc) {
    if (!doc || _boundDocuments.has(doc)) return;
    const win = _getDocumentWindow(doc);
    doc.addEventListener?.("pointerdown", _onHeldPointerDown, true);
    doc.addEventListener?.("pointerup", _onHeldPointerUp, true);
    doc.addEventListener?.("pointercancel", _onHeldPointerCancel, true);
    win?.addEventListener?.("blur", _onWindowBlur);
    _boundDocuments.set(doc, win);
}

function _unbindHeldDocument(doc, { restore = false } = {}) {
    if (!doc || !_boundDocuments.has(doc)) return;
    const win = _boundDocuments.get(doc);
    doc.removeEventListener?.("pointerdown", _onHeldPointerDown, true);
    doc.removeEventListener?.("pointerup", _onHeldPointerUp, true);
    doc.removeEventListener?.("pointercancel", _onHeldPointerCancel, true);
    win?.removeEventListener?.("blur", _onWindowBlur);
    if (restore) _restoreFoundryDownCursors(doc);
    doc.body?.classList.remove("ttb-cursor-click");
    _boundDocuments.delete(doc);
}

function _onOpenDetachedWindow(_id, win) {
    _bindHeldDocument(win?.document);
}

function _onCloseDetachedWindow(_id, win) {
    _unbindHeldDocument(win?.document, { restore: true });
    if (_pressedDocument === win?.document) {
        _pressedDocument = null;
        _pressedPointerId = null;
    }
}

function _logCursorState() {
    const board = _getBoard();
    const boardClasses = board?.classList;

    // Priority order matches CSS rule order: panning > targeting > pressed > hover > default.
    let activeState = "default";
    if (boardClasses?.contains("ttb-cursor-panning")) activeState = "panning";
    else if (boardClasses?.contains("ttb-cursor-targeting")) activeState = "targeting";
    else if (boardClasses?.contains("ttb-cursor-click") || _pressedDocument?.body?.classList.contains("ttb-cursor-click")) activeState = "click";
    else if (boardClasses?.contains("ttb-cursor-hover")) activeState = "hover";

    try {
        const states = getUserCursorConfig(game.user).cursorStates;
        const stateConfig = states[activeState];
        const cursor = stateConfig?.enabled !== false ? (stateConfig?.image || "none") : `${activeState} disabled -> default: ${states.default?.image || "none"}`;
        debugLog("states", `[CURSOR STATE] active="${activeState}" | cursor="${cursor}"`);
    } catch {
        debugLog("states", `[CURSOR STATE] active="${activeState}" | (settings not ready)`);
    }
}

function _onHoverToken(_token, isHovering) {
    debugLog("states", `hoverToken fired: isHovering=${isHovering}, token="${_token?.name || "unknown"}"`);
    _getBoard()?.classList.toggle("ttb-cursor-hover", isHovering);
    _logCursorState();
}

function _onRenderSceneControls() {
    const activeTool = game.activeTool ?? ui.controls?.tool?.name ?? ui.controls?.activeTool ?? ui.controls?.tool;
    const isTargeting = activeTool === "target";
    debugLog("states", `renderSceneControls fired: activeTool="${activeTool}", isTargeting=${isTargeting}`);
    _getBoard()?.classList.toggle("ttb-cursor-targeting", isTargeting);
    _logCursorState();
}

export function setupCursorStateListeners() {
    if (_stateListenersActive) return;
    _stateListenersActive = true;
    debugLog("states", "setupCursorStateListeners: registering state detection hooks");

    Hooks.on("hoverToken", _onHoverToken);
    Hooks.on("renderSceneControls", _onRenderSceneControls);
    Hooks.on("openDetachedWindow", _onOpenDetachedWindow);
    Hooks.on("closeDetachedWindow", _onCloseDetachedWindow);
    _onRenderSceneControls();

    // Capture release/cancel in both the workspace and V14 detached windows so
    // the held state survives leaving its control without becoming stuck.
    for (const doc of _getKnownDocuments()) _bindHeldDocument(doc);

    const stage = canvas?.app?.stage;
    if (stage) {
        _stage = stage;
        _panningHandler = (event) => {
            if (event.originalEvent.button === 2) {
                debugLog("states", "panning: RIGHT-CLICK DOWN -> adding ttb-cursor-panning class");
                _getBoard()?.classList.add("ttb-cursor-panning");
                _logCursorState();
            }
        };
        _panningUpHandler = _clearPanningState;

        stage.on("pointerdown", _panningHandler);
        stage.on("pointerup", _panningUpHandler);
        stage.on("pointerupoutside", _panningUpHandler);
        stage.on("pointercancel", _panningUpHandler);
        debugLog("states", "setupCursorStateListeners: panning listeners attached to canvas stage");
    } else {
        debugLog("states", "setupCursorStateListeners: WARNING -> canvas stage not available, panning listeners NOT attached");
    }
}

export function cleanupCursorStateListeners() {
    if (!_stateListenersActive) return;
    _stateListenersActive = false;

    Hooks.off("hoverToken", _onHoverToken);
    Hooks.off("renderSceneControls", _onRenderSceneControls);
    Hooks.off("openDetachedWindow", _onOpenDetachedWindow);
    Hooks.off("closeDetachedWindow", _onCloseDetachedWindow);

    _clearPressedState(null, { restoreFoundry: true, restoreAll: true });
    for (const doc of [..._boundDocuments.keys()]) _unbindHeldDocument(doc);

    // Canvas may already point at the next scene by teardown time. Detach from
    // the exact stage that received these listeners.
    const stage = _stage;
    if (stage && _panningHandler) {
        stage.off("pointerdown", _panningHandler);
        stage.off("pointerup", _panningUpHandler);
        stage.off("pointerupoutside", _panningUpHandler);
        stage.off("pointercancel", _panningUpHandler);
    }
    _stage = null;
    _panningHandler = null;
    _panningUpHandler = null;

    _clearPanningState();
    const board = _getBoard();
    if (board) {
        board.classList.remove("ttb-cursor-hover", "ttb-cursor-targeting", "ttb-cursor-panning", "ttb-cursor-click");
    }
    globalThis.document?.body?.classList.remove("ttb-cursor-click");
    _board = null;
}
