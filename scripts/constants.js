export const MODULE_ID = "target-the-beastie";
export const STYLE_ID = `${MODULE_ID}-cursor-style`;
export const DEFAULT_CURSOR_PATH = `modules/${MODULE_ID}/assets/AOM_cursor_pointer.png`;
export const DEFAULT_HOTSPOT = { x: 4, y: 4 };
export const CURSOR_STATE_KEYS = ["default", "hover", "targeting", "panning"];
export const SOCKET_EVENT = `module.${MODULE_ID}`;
export const CURSOR_SHARE_THROTTLE_MS = 33;
export const CURSOR_FADE_TIMEOUT_MS = 5000;
export const CURSOR_POINTER_SIZE = 16;
export const CURSOR_LERP_SPEED = 0.1;

export const CURSOR_STATE_LABELS = {
    default: "Default",
    hover: "Hover (over token)",
    targeting: "Targeting Mode",
    panning: "Panning / Dragging"
};

export const NAME_POSITION_PRESETS = {
    "bottom-center": { anchorX: 0.5, anchorY: 0, offsetX: 0, offsetY: 1.2 },
    "bottom-right":  { anchorX: 0, anchorY: 0, offsetX: 0.5, offsetY: 0.6 },
    "top-center":    { anchorX: 0.5, anchorY: 1, offsetX: 0, offsetY: -0.3 },
    "right":         { anchorX: 0, anchorY: 0.5, offsetX: 1.0, offsetY: 0.3 }
};

// Marquee box select constants
export const MARQUEE_DRAG_THRESHOLD = 10;
export const MARQUEE_FILL_COLOR = 0x4488FF;
export const MARQUEE_FILL_ALPHA = 0.15;
export const MARQUEE_LINE_COLOR = 0x4488FF;
export const MARQUEE_LINE_ALPHA = 0.8;
export const MARQUEE_LINE_WIDTH = 2;

export const DEBUG_MODES = {
    off: "Off",
    all: "All",
    cursor: "Cursor CSS & Settings",
    states: "State Detection (hover/targeting/panning)",
    config: "Config UI & Save",
    sharing: "Cursor Sharing",
    marquee: "Marquee Box Select"
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
