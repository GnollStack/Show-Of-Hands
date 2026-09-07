/**
 * @file marquee-select.js
 * @description Middle-mouse click targeting and live marquee targeting for
 * Show of Hands.
 */

import {
    MODULE_ID, debugLog,
    MARQUEE_DRAG_THRESHOLD, MARQUEE_FILL_COLOR, MARQUEE_FILL_ALPHA,
    MARQUEE_LINE_COLOR, MARQUEE_LINE_ALPHA, MARQUEE_LINE_WIDTH
} from './constants.js';
import { performSingleTarget } from './targeting.js';
import { getMarqueeLevelFilter, getMarqueeTokenFilter, isMiddleMouseMarqueeEnabled, tokenMatchesMarqueeFilter } from './settings.js';
import { getCurrentLevelId, tokenMatchesMarqueeLevelFilter } from './scene-levels.js';
import { normalizeRect, rectIntersectsBounds, computeMarqueeTargetUpdate } from './marquee-core.js';

let _startX = 0;
let _startY = 0;
let _startScreenX = 0;
let _startScreenY = 0;
let _isDragging = false;
let _movedBeyondThreshold = false;
let _graphics = null;
// Targets from the start of the drag. Shift drags keep these; replace drags
// remove anything outside the box.
let _baselineTargets = new Set();
let _onPointerDown = null;
let _listenerStage = null;
let _onPointerMove = null;
let _onPointerUp = null;
let _onPointerCancel = null;
let _gestureStage = null;
let _pendingReconcile = null;
let _reconcileFrame = null;
let _lastReconcileAt = 0;
let _gesturePointerId = null;
let _gestureButton = null;

const MARQUEE_RECONCILE_INTERVAL_MS = 33;
const MIDDLE_MOUSE_BUTTON = 1;
const FALLBACK_MOUSE_POINTER_ID = 'mouse';

function _getEventPointerId(event) {
    return event?.pointerId ?? event?.originalEvent?.pointerId ?? FALLBACK_MOUSE_POINTER_ID;
}

function _getEventButton(event) {
    return event?.originalEvent?.button ?? event?.button ?? null;
}

function _isGesturePointer(event, { requireButton = false } = {}) {
    if (_gesturePointerId === null) return false;
    if (_getEventPointerId(event) !== _gesturePointerId) return false;
    return !requireButton || _getEventButton(event) === _gestureButton;
}

/**
 * Toggle the marquee select listener on the canvas stage.
 * This handler owns all middle-mouse button interactions:
 * - Click without drag: single-token targeting
 * - Drag: marquee box select
 * @param {boolean} isEnabled
 */
export function toggleMarqueeListener(isEnabled) {
    const stage = canvas?.app?.stage;

    // Swap the stage listener whenever settings change.
    if (_listenerStage && _onPointerDown) {
        _listenerStage.off('pointerdown', _onPointerDown);
    }
    _listenerStage = null;
    _cancelActiveGesture();

    if (isEnabled && stage) {
        _onPointerDown = _handlePointerDown.bind(null);
        stage.on('pointerdown', _onPointerDown);
        _listenerStage = stage;
        debugLog("marquee", "Middle-mouse targeting/marquee listener enabled.");
    } else {
        _onPointerDown = null;
        debugLog("marquee", isEnabled
            ? "Middle-mouse targeting/marquee listener unavailable: canvas stage is missing."
            : "Middle-mouse targeting/marquee listener disabled.");
    }
}

/**
 * Clean up marquee listeners and graphics on canvas tear-down.
 */
export function cleanupMarqueeListener() {
    if (_listenerStage && _onPointerDown) {
        _listenerStage.off('pointerdown', _onPointerDown);
    }
    _listenerStage = null;
    _onPointerDown = null;
    // Canvas teardown owns target-state disposal. Remove our listeners and
    // graphics without emitting a rollback through a disappearing token layer.
    _cleanupDragState();
}

function _handlePointerDown(event) {
    const button = _getEventButton(event);
    if (button !== MIDDLE_MOUSE_BUTTON) return;

    const stage = canvas?.app?.stage;
    if (!stage) return;

    // If focus loss swallowed pointerup, clear the old gesture before starting
    // another one.
    _cancelActiveGesture();

    _gesturePointerId = _getEventPointerId(event);
    _gestureButton = button;

    // Store both world-space and screen-space starts: the rectangle is drawn in
    // world coordinates, while the drag threshold should not vary by zoom.
    const worldPos = stage.toLocal(event.global);
    _startX = worldPos.x;
    _startY = worldPos.y;
    _startScreenX = event.global.x;
    _startScreenY = event.global.y;

    debugLog("marquee", "Pointer down at world:", _startX, _startY, "screen:", _startScreenX, _startScreenY);

    // Move/up listeners belong to this middle-button gesture only.
    _onPointerMove = _handlePointerMove.bind(null);
    _onPointerUp = _handlePointerUp.bind(null);
    _onPointerCancel = _handlePointerCancel.bind(null);
    _gestureStage = stage;
    stage.on('pointermove', _onPointerMove);
    stage.on('pointerup', _onPointerUp);
    stage.on('pointerupoutside', _onPointerUp);
    stage.on('pointercancel', _onPointerCancel);
    globalThis.addEventListener?.('blur', _handleWindowBlur);
    globalThis.document?.addEventListener?.('visibilitychange', _handleVisibilityChange);
}

function _handlePointerMove(event) {
    if (!_isGesturePointer(event)) return;

    const worldPos = _gestureStage.toLocal(event.global);
    const dx = event.global.x - _startScreenX;
    const dy = event.global.y - _startScreenY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (!_isDragging) {
        if (distance < MARQUEE_DRAG_THRESHOLD) return;
        _movedBeyondThreshold = true;

        // A drag can begin while only empty-click clearing is enabled; in that
        // mode crossing the threshold suppresses single-click targeting.
        if (!isMiddleMouseMarqueeEnabled()) return;

        _isDragging = true;
        // Take the starting target set once, so add vs. replace stays stable
        // while the box changes.
        _baselineTargets = new Set(game.user.targets);
        debugLog("marquee", "Drag started, screen threshold exceeded");

        // Draw in canvas.controls so the marquee sits above tokens but below UI.
        _graphics = new PIXI.Graphics();
        canvas.controls.addChild(_graphics);
    }

    // Redraw the live selection rectangle in world coordinates.
    _drawRect(_startX, _startY, worldPos.x, worldPos.y);

    // Update targets during the drag so players can see the selection before
    // release.
    const rect = normalizeRect(_startX, _startY, worldPos.x, worldPos.y);
    _scheduleTargetReconcile(rect, event.originalEvent?.shiftKey ?? false);
}

function _handlePointerUp(event) {
    if (!_isGesturePointer(event, { requireButton: true })) return;

    const isShift = event.originalEvent?.shiftKey ?? false;

    // Commit the exact release position instead of allowing an older queued
    // preview update to run after the gesture has ended.
    _cancelScheduledReconcile();

    if (_isDragging) {
        // Repeat the calculation on pointerup in case the cursor moved after the
        // last pointermove.
        const worldPos = _gestureStage.toLocal(event.global);
        const rect = normalizeRect(_startX, _startY, worldPos.x, worldPos.y);
        const tokens = _getTokensInRect(rect);

        debugLog("marquee", `Marquee select complete. Found ${tokens.length} tokens in rect`, rect);

        _reconcileTargets(tokens, isShift);
    } else if (!_movedBeyondThreshold) {
        // No drag: single-click path. performSingleTarget checks the relevant
        // settings for token and empty-canvas clicks.
        performSingleTarget(isShift);
    }

    // Drop this gesture's listeners and preview graphic.
    _cleanupDragState();
}

function _handlePointerCancel(event) {
    if (!_isGesturePointer(event)) return;
    _cancelActiveGesture();
}

function _handleWindowBlur() {
    _cancelActiveGesture();
}

function _handleVisibilityChange() {
    if (globalThis.document?.hidden) _cancelActiveGesture();
}

function _scheduleTargetReconcile(rect, additive) {
    _pendingReconcile = { rect, additive };
    if (_reconcileFrame !== null) return;

    const reconcileOnFrame = timestamp => {
        _reconcileFrame = null;
        if (!_pendingReconcile || !_isDragging) return;

        if ((timestamp - _lastReconcileAt) < MARQUEE_RECONCILE_INTERVAL_MS) {
            _reconcileFrame = globalThis.requestAnimationFrame(reconcileOnFrame);
            return;
        }

        const pending = _pendingReconcile;
        _pendingReconcile = null;
        _lastReconcileAt = timestamp;
        _reconcileTargets(_getTokensInRect(pending.rect), pending.additive);
    };

    _reconcileFrame = globalThis.requestAnimationFrame(reconcileOnFrame);
}

function _cancelScheduledReconcile() {
    if (_reconcileFrame !== null) {
        globalThis.cancelAnimationFrame?.(_reconcileFrame);
        _reconcileFrame = null;
    }
    _pendingReconcile = null;
}

function _drawRect(x1, y1, x2, y2) {
    if (!_graphics) return;

    const minX = Math.min(x1, x2);
    const minY = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);

    _graphics.clear();
    _graphics.beginFill(MARQUEE_FILL_COLOR, MARQUEE_FILL_ALPHA);
    _graphics.lineStyle(MARQUEE_LINE_WIDTH, MARQUEE_LINE_COLOR, MARQUEE_LINE_ALPHA);
    _graphics.drawRect(minX, minY, width, height);
    _graphics.endFill();
}

/**
 * Find tokens whose bounds intersect the selection rectangle.
 * GMs can target hidden tokens; players only get visible ones.
 */
function _getTokensInRect(rect) {
    const isGM = game.user.isGM;
    const tokenFilter = getMarqueeTokenFilter();
    const levelOptions = { filter: getMarqueeLevelFilter(), levelId: getCurrentLevelId() };

    return canvas.tokens.placeables.filter(token => {
        // Keep this order: visibility, level, disposition, then rectangle hit.
        if (!isGM && !token.visible) return false;
        if (!tokenMatchesMarqueeLevelFilter(token, levelOptions)) return false;
        if (!tokenMatchesMarqueeFilter(token, tokenFilter)) return false;
        return rectIntersectsBounds(rect, token.bounds);
    });
}

/**
 * Match the local user's targets to the current marquee box.
 *
 * The desired set is the tokens in the box, plus the targets from drag start
 * when Shift is held. Toggling only the differences keeps the live preview
 * steady and avoids duplicate setTarget calls.
 *
 * @param {Token[]} tokens - Tokens currently inside the selection rectangle
 * @param {boolean} additive - If true, keep the pre-drag targets in addition to the box
 */
function _reconcileTargets(tokens, additive) {
    const liveTokenIds = new Set(
        (canvas.tokens?.placeables ?? [])
            .filter(token => token?.id && !token.destroyed)
            .map(token => token.id)
    );
    const { desired, toAdd, toRemove } = computeMarqueeTargetUpdate({
        current: [...game.user.targets].map(token => token.id),
        inBox: tokens.map(token => token.id).filter(id => liveTokenIds.has(id)),
        baseline: [..._baselineTargets].map(token => token.id).filter(id => liveTokenIds.has(id)),
        additive
    });

    if (toAdd.length || toRemove.length) {
        // Token#setTarget delegates to this same collection method and emits
        // the complete target set. Applying each diff separately produces one
        // network broadcast per token; replace the set atomically instead.
        if (_replaceTargetsIfChanged([...desired])) {
            debugLog("marquee", `Reconciled marquee targets: ${desired.size} targeted (additive: ${additive}, +${toAdd.length}/-${toRemove.length})`);
        }
    }
}

function _replaceTargetsIfChanged(desiredIds) {
    const desired = new Set(desiredIds);
    const current = new Set([...game.user.targets].map(token => token?.id).filter(Boolean));
    if (desired.size === current.size && [...desired].every(id => current.has(id))) return false;
    canvas.tokens.setTargets([...desired], { mode: "replace" });
    return true;
}

function _cancelActiveGesture() {
    if (_isDragging) {
        const baselineIds = [..._baselineTargets]
            .filter(token => token?.id && !token.destroyed)
            .map(token => token.id);
        if (canvas?.tokens?.setTargets) _replaceTargetsIfChanged(baselineIds);
    }
    _cleanupDragState();
}

function _cleanupDragState() {
    const stage = _gestureStage;

    _cancelScheduledReconcile();

    if (stage) {
        if (_onPointerMove) stage.off('pointermove', _onPointerMove);
        if (_onPointerUp) {
            stage.off('pointerup', _onPointerUp);
            stage.off('pointerupoutside', _onPointerUp);
        }
        if (_onPointerCancel) stage.off('pointercancel', _onPointerCancel);
    }

    globalThis.removeEventListener?.('blur', _handleWindowBlur);
    globalThis.document?.removeEventListener?.('visibilitychange', _handleVisibilityChange);

    if (_graphics) {
        if (_graphics.parent) _graphics.parent.removeChild(_graphics);
        _graphics.destroy();
        _graphics = null;
    }

    _onPointerMove = null;
    _onPointerUp = null;
    _onPointerCancel = null;
    _gestureStage = null;
    _gesturePointerId = null;
    _gestureButton = null;
    _isDragging = false;
    _movedBeyondThreshold = false;
    _baselineTargets = new Set();
    _lastReconcileAt = 0;
}
