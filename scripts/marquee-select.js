import {
    MODULE_ID, debugLog,
    MARQUEE_DRAG_THRESHOLD, MARQUEE_FILL_COLOR, MARQUEE_FILL_ALPHA,
    MARQUEE_LINE_COLOR, MARQUEE_LINE_ALPHA, MARQUEE_LINE_WIDTH
} from './constants.js';
import { performSingleTarget } from './targeting.js';
import { isMiddleMouseMarqueeEnabled, tokenMatchesMarqueeFilter } from './settings.js';

let _startX = 0;
let _startY = 0;
let _startScreenX = 0;
let _startScreenY = 0;
let _isDragging = false;
let _movedBeyondThreshold = false;
let _graphics = null;
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
        debugLog("marquee", "Drag started, screen threshold exceeded");

        // Create graphics object for the selection rectangle
        _graphics = new PIXI.Graphics();
        canvas.controls.addChild(_graphics);
    }

    // Draw the selection rectangle
    _drawRect(_startX, _startY, worldPos.x, worldPos.y);
}

function _handlePointerUp(event) {
    const stage = canvas?.app?.stage;
    const isShift = event.originalEvent.shiftKey;

    if (_isDragging) {
        // Marquee drag completed — find and target tokens in the rectangle
        const worldPos = canvas.stage.toLocal(event.global);
        const rect = _normalizeRect(_startX, _startY, worldPos.x, worldPos.y);
        const tokens = _getTokensInRect(rect);

        debugLog("marquee", `Marquee select complete. Found ${tokens.length} tokens in rect`, rect);

        _targetTokens(tokens, isShift);
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

function _normalizeRect(x1, y1, x2, y2) {
    return {
        left: Math.min(x1, x2),
        top: Math.min(y1, y2),
        right: Math.max(x1, x2),
        bottom: Math.max(y1, y2)
    };
}

/**
 * Find all tokens whose bounds intersect the selection rectangle.
 * GM/co-GM can target all tokens (including hidden).
 * Players can only target visible tokens.
 */
function _getTokensInRect(rect) {
    const isGM = game.user.isGM;

    return canvas.tokens.placeables.filter(token => {
        // Permission check: players can only target visible tokens
        if (!isGM && !token.visible) return false;
        if (!tokenMatchesMarqueeFilter(token)) return false;

        // AABB intersection test
        const bounds = token.bounds;
        return bounds.left < rect.right &&
               bounds.right > rect.left &&
               bounds.top < rect.bottom &&
               bounds.bottom > rect.top;
    });
}

/**
 * Target the given tokens.
 * @param {Token[]} tokens - Tokens to target
 * @param {boolean} additive - If true, add to existing targets instead of replacing
 */
function _targetTokens(tokens, additive) {
    // If not additive, clear existing targets first. Snapshot the Set to an
    // array so iteration is unaffected by setTarget(false) mutating game.user.targets.
    if (!additive) {
        for (const t of [...game.user.targets]) {
            t.setTarget(false, { user: game.user, releaseOthers: false });
        }
    }

    // Target each token in the selection
    for (const token of tokens) {
        token.setTarget(true, { user: game.user, releaseOthers: false });
    }

    debugLog("marquee", `Targeted ${tokens.length} tokens (additive: ${additive})`);
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
}
