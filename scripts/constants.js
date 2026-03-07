export const MODULE_ID = "target-the-beastie";
export const STYLE_ID = `${MODULE_ID}-cursor-style`;
export const DEFAULT_CURSOR_PATH = `modules/${MODULE_ID}/assets/AOM_cursor_pointer.png`;
export const DEFAULT_HOTSPOT = { x: 4, y: 4 };
export const CURSOR_STATE_KEYS = ["default", "hover", "targeting", "panning"];
export const SOCKET_EVENT = `module.${MODULE_ID}`;
export const CURSOR_SHARE_THROTTLE_MS = 50;
export const CURSOR_FADE_TIMEOUT_MS = 5000;
export const CURSOR_POINTER_SIZE = 16;
export const CURSOR_LERP_SPEED = 0.25;

export const CURSOR_STATE_LABELS = {
    default: "Default",
    hover: "Hover (over token)",
    targeting: "Targeting Mode",
    panning: "Panning / Dragging"
};

export const DEBUG_MODES = {
    off: "Off",
    all: "All",
    cursor: "Cursor CSS & Settings",
    states: "State Detection (hover/targeting/panning)",
    config: "Config UI & Save",
    sharing: "Cursor Sharing"
};

export function debugLog(category, ...args) {
    try {
        const mode = game.settings.get(MODULE_ID, "debug-mode");
        if (mode === "off") return;
        if (mode === "all" || mode === category) {
            console.log(`${MODULE_ID} | [DEBUG:${category}]`, ...args);
        }
    } catch {
        // Settings not ready yet
    }
}
