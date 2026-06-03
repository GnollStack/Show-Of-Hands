const SHOW_CURSOR_PERMISSION = "SHOW_CURSOR";

export function getShowCursorPermissionState(user = globalThis.game?.user) {
    const state = {
        permission: SHOW_CURSOR_PERMISSION,
        available: typeof user?.hasPermission === "function",
        allowed: true,
        error: null
    };

    if (!state.available) return state;

    try {
        state.allowed = user.hasPermission(SHOW_CURSOR_PERMISSION) !== false;
    } catch (error) {
        state.allowed = true;
        state.error = error?.message ?? String(error);
    }

    return state;
}

export function canBroadcastVisibleCursor(user = globalThis.game?.user) {
    return getShowCursorPermissionState(user).allowed;
}
