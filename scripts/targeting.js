import { MODULE_ID, debugLog } from './constants.js';

/**
 * Perform single-token targeting on the currently hovered token.
 * Called by marquee-select.js when a middle-click (no drag) is detected.
 * @param {boolean} isShift - Whether shift key is held for multi-targeting
 */
export function performSingleTarget(isShift) {
    if (!canvas.tokens.hover) {
        // Empty-space click without shift clears all of the local user's targets.
        // Shift means additive elsewhere in this module, so shift+empty is a no-op.
        // Independent of `use-mousewheel-targeting` so the clear works whether the
        // user has targeting, marquee, or both enabled.
        const clearOnEmpty = game.settings.get(MODULE_ID, "clear-targets-on-empty-click");
        if (clearOnEmpty && !isShift && game.user.targets.size > 0) {
            debugLog("marquee", `Clearing ${game.user.targets.size} targets (empty-space click)`);
            // Snapshot to array — setTarget(false) mutates game.user.targets.
            for (const t of [...game.user.targets]) {
                t.setTarget(false, { user: game.user, releaseOthers: false });
            }
        }
        return;
    }

    // On-token branch is gated by the targeting setting.
    const targetingEnabled = game.settings.get(MODULE_ID, "use-mousewheel-targeting");
    if (!targetingEnabled) return;

    const targetAction = game.keybindings.actions.get("core.target");
    if (targetAction?.onDown) {
        debugLog("marquee", "Single target on hovered token, shift:", isShift);
        targetAction.onDown({ isShift });
    }
}
