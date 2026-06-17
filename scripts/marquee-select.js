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
import { isMiddleMouseMarqueeEnabled, tokenMatchesMarqueeFilter } from './settings.js';
import { tokenMatchesMarqueeLevelFilter } from './scene-levels.js';
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
let _onPointerMove = null;
let _onPointerUp = null;

/**
 * Toggle the marquee select listener on the canvas stage.
 * This handler owns all middle-mouse button interactions:
 * - Click without drag: single-token targeting
 * - Drag: marquee box select
 * @param {boolean} isEnabled
 */
export function toggleMarqueeListener(isEnabled) {
    const stage = canvas?.app?.stage;
    if (!stage) return;

    // Swap the stage listener whenever settings change.
    if (_onPointerDown) {
        stage.off('pointerdown', _onPointerDown);
    }
    _cleanupDragState();

    if (isEnabled) {
        _onPointerDown = _handlePointerDown.bind(null);
        stage.on('pointerdown', _onPointerDown);
        debugLog("marquee", "Middle-mouse targeting/marquee listener enabled.");
    } else {
        _onPointerDown = null;
        debugLog("marquee", "Middle-mouse targeting/marquee listener disabled.");
    }
}

/**
 * Clean up marquee listeners and graphics on canvas tear-down.
 */
export function cleanupMarqueeListener() {
    const stage = canvas?.app?.stage;
    if (stage && _onPointerDown) {
        stage.off('pointerdown', _onPointerDown);
    }
    _onPointerDown = null;
    _cleanupDragState();
}

function _handlePointerDown(event) {
    if (event.originalEvent.button !== 1) return;

    const stage = canvas?.app?.stage;
    if (!stage) return;

    // If focus loss swallowed pointerup, clear the old gesture before starting
    // another one.
    _cleanupDragState();

    // Store both world-space and screen-space starts: the rectangle is drawn in
    // world coordinates, while the drag threshold should not vary by zoom.
    const worldPos = canvas.stage.toLocal(event.global);
    _startX = worldPos.x;
    _startY = worldPos.y;
    _startScreenX = event.global.x;
    _startScreenY = event.global.y;

    debugLog("marquee", "Pointer down at world:", _startX, _startY, "screen:", _startScreenX, _startScreenY);

    // Move/up listeners belong to this middle-button gesture only.
    _onPointerMove = _handlePointerMove.bind(null);
    _onPointerUp = _handlePointerUp.bind(null);
    stage.on('pointermove', _onPointerMove);
    stage.on('pointerup', _onPointerUp);
    stage.on('pointerupoutside', _onPointerUp);
}

function _handlePointerMove(event) {
    const worldPos = canvas.stage.toLocal(event.global);
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
    const tokens = _getTokensInRect(rect);
    _reconcileTargets(tokens, event.originalEvent?.shiftKey ?? false);
}

function _handlePointerUp(event) {
    const stage = canvas?.app?.stage;
    const isShift = event.originalEvent.shiftKey;

    if (_isDragging) {
        // Repeat the calculation on pointerup in case the cursor moved after the
        // last pointermove.
        const worldPos = canvas.stage.toLocal(event.global);
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

    return canvas.tokens.placeables.filter(token => {
        // Keep this order: visibility, level, disposition, then rectangle hit.
        if (!isGM && !token.visible) return false;
        if (!tokenMatchesMarqueeLevelFilter(token)) return false;
        if (!tokenMatchesMarqueeFilter(token)) return false;
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
    // Keep a lookup of every token we might touch. Snapshot current ids before
    // setTarget mutates game.user.targets.
    const tokenById = new Map();
    const register = (token) => { if (token?.id) tokenById.set(token.id, token); };
    for (const token of game.user.targets) register(token);
    for (const token of _baselineTargets) register(token);
    for (const token of tokens) register(token);

    const { desired, toAdd, toRemove } = computeMarqueeTargetUpdate({
        current: [...game.user.targets].map(token => token.id),
        inBox: tokens.map(token => token.id),
        baseline: [..._baselineTargets].map(token => token.id),
        additive
    });

    // Tokens can disappear during a drag; skip them instead of letting setTarget
    // throw.
    const apply = (id, state) => {
        const token = tokenById.get(id);
        if (token && !token.destroyed) token.setTarget(state, { user: game.user, releaseOthers: false });
    };
    for (const id of toRemove) apply(id, false);
    for (const id of toAdd) apply(id, true);

    if (toAdd.length || toRemove.length) {
        debugLog("marquee", `Reconciled marquee targets: ${desired.size} targeted (additive: ${additive}, +${toAdd.length}/-${toRemove.length})`);
    }
}

function _cleanupDragState() {
    const stage = canvas?.app?.stage;

    if (stage) {
        if (_onPointerMove) stage.off('pointermove', _onPointerMove);
        if (_onPointerUp) {
            stage.off('pointerup', _onPointerUp);
            stage.off('pointerupoutside', _onPointerUp);
        }
    }

    if (_graphics) {
        if (_graphics.parent) _graphics.parent.removeChild(_graphics);
        _graphics.destroy();
        _graphics = null;
    }

    _onPointerMove = null;
    _onPointerUp = null;
    _isDragging = false;
    _movedBeyondThreshold = false;
    _baselineTargets = new Set();
}
