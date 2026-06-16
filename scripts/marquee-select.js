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
// Targets that existed before the current drag began. Lets additive (Shift)
// drags keep prior targets while non-additive drags clear them, even as the
// live preview box grows and shrinks over tokens mid-drag.
let _baselineTargets = new Set();
let _onPointerDown = null;
let _onPointerMove = null;
let _onPointerUp = null;

/**
 * Toggle the marquee select listener on the canvas stage.
 * This handler owns all middle-mouse button interactions:
 * - Click (no drag) → single-token targeting
 * - Drag → marquee box select
 * @param {boolean} isEnabled
 */
export function toggleMarqueeListener(isEnabled) {
    const stage = canvas?.app?.stage;
    if (!stage) return;

    // Always clean up existing listeners
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
 * Clean up all marquee listeners and graphics. Called on canvasTearDown.
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

    // Defensive: if a prior session never received a pointerup (e.g. focus loss
    // during drag), wipe its lingering listeners and graphics before starting fresh.
    _cleanupDragState();

    // Record start position in world space
    const worldPos = canvas.stage.toLocal(event.global);
    _startX = worldPos.x;
    _startY = worldPos.y;
    _startScreenX = event.global.x;
    _startScreenY = event.global.y;

    debugLog("marquee", "Pointer down at world:", _startX, _startY, "screen:", _startScreenX, _startScreenY);

    // Attach move and up listeners for this drag session
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

        // Check if marquee select is enabled before starting drag
        if (!isMiddleMouseMarqueeEnabled()) return;

        _isDragging = true;
        // Snapshot existing targets so additive vs. replace semantics stay
        // correct as tokens enter/leave the live preview box during the drag.
        _baselineTargets = new Set(game.user.targets);
        debugLog("marquee", "Drag started, screen threshold exceeded");

        // Create graphics object for the selection rectangle
        _graphics = new PIXI.Graphics();
        canvas.controls.addChild(_graphics);
    }

    // Draw the selection rectangle
    _drawRect(_startX, _startY, worldPos.x, worldPos.y);

    // Live preview: target tokens currently inside the box before release so
    // the selection is visible while dragging.
    const rect = normalizeRect(_startX, _startY, worldPos.x, worldPos.y);
    const tokens = _getTokensInRect(rect);
    _reconcileTargets(tokens, event.originalEvent?.shiftKey ?? false);
}

function _handlePointerUp(event) {
    const stage = canvas?.app?.stage;
    const isShift = event.originalEvent.shiftKey;

    if (_isDragging) {
        // Marquee drag completed — find and target tokens in the rectangle
        const worldPos = canvas.stage.toLocal(event.global);
        const rect = normalizeRect(_startX, _startY, worldPos.x, worldPos.y);
        const tokens = _getTokensInRect(rect);

        debugLog("marquee", `Marquee select complete. Found ${tokens.length} tokens in rect`, rect);

        _reconcileTargets(tokens, isShift);
    } else if (!_movedBeyondThreshold) {
        // No drag — single-click path. performSingleTarget self-gates on
        // `middle-mouse-actions` (on-token branch) and on
        // `clear-targets-on-empty-click` (empty-canvas branch).
        performSingleTarget(isShift);
    }

    // Clean up drag state
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
 * Find all tokens whose bounds intersect the selection rectangle.
 * GM/co-GM can target all tokens (including hidden).
 * Players can only target visible tokens.
 */
function _getTokensInRect(rect) {
    const isGM = game.user.isGM;

    return canvas.tokens.placeables.filter(token => {
        // Filter order (invariant): visibility gate, level filter, disposition
        // filter, then rectangle intersection.
        if (!isGM && !token.visible) return false;
        if (!tokenMatchesMarqueeLevelFilter(token)) return false;
        if (!tokenMatchesMarqueeFilter(token)) return false;
        return rectIntersectsBounds(rect, token.bounds);
    });
}

/**
 * Reconcile the local user's targets to match the marquee selection.
 *
 * Computes the desired target set — the tokens in the box, plus the pre-drag
 * baseline when `additive` (Shift) is held — then only toggles the tokens that
 * differ from the current targets. Reconciling (instead of clearing and
 * re-adding) keeps the live preview stable while dragging and avoids emitting
 * redundant target updates when the selection has not changed since the last
 * pointer move.
 *
 * @param {Token[]} tokens - Tokens currently inside the selection rectangle
 * @param {boolean} additive - If true, keep the pre-drag targets in addition to the box
 */
function _reconcileTargets(tokens, additive) {
    // Build an id -> token lookup across every token we might touch, and
    // snapshot current target ids up front so the pure diff is computed before
    // any setTarget(false) mutates game.user.targets.
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

    // Skip tokens that vanished mid-drag (e.g. deleted) to avoid setTarget throwing.
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
