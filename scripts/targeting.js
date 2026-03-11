import { debugLog } from './constants.js';

/**
 * Perform single-token targeting on the currently hovered token.
 * Called by marquee-select.js when a middle-click (no drag) is detected.
 * @param {boolean} isShift - Whether shift key is held for multi-targeting
 */
export function performSingleTarget(isShift) {
    if (!canvas.tokens.hover) return;

    const targetAction = game.keybindings.actions.get("core.target");
    if (targetAction?.onDown) {
        debugLog("marquee", "Single target on hovered token, shift:", isShift);
        targetAction.onDown({ isShift });
    }
}
