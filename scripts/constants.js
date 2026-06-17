/**
 * @file constants.js
 * @description Shared Show of Hands identifiers, cursor defaults, socket
 * message names, and small runtime constants.
 */

// "show-of-hands" is the current module identity. "target-the-beastie" remains
// only as a legacy namespace for migration from older installs.
export const MODULE_ID = "show-of-hands";
export const LEGACY_MODULE_ID = "target-the-beastie";
export const MODULE_TITLE = "Show of Hands";
export const STYLE_ID = `${MODULE_ID}-cursor-style`;
export const DEFAULT_CURSOR_PATH = "";
export const DEFAULT_HOTSPOT = { x: 0, y: 0 };
export const SOCKET_EVENT = `module.${MODULE_ID}`;
export const CURSOR_SHARE_THROTTLE_MS = 33;
export const CURSOR_FADE_TIMEOUT_MS = 5000;
export const CURSOR_POINTER_SIZE = 16;
export const CURSOR_SIZE_MAX = 128;
export const CURSOR_LERP_SPEED = 0.1;

export const SOCKET_MESSAGE_TYPES = Object.freeze({
    CURSOR_MOVE: "cursorMove",
    CURSOR_IMAGE: "cursorImage",
    CURSOR_HIDDEN: "cursorHidden",
    HIDDEN_PING: "hiddenPing",
    REQUEST_CURSOR_IMAGE: "requestCursorImage"
});

export const CURSOR_STATE_DEFINITIONS = Object.freeze([
    {
        key: "default",
        tabLabel: "Default",
        label: "Default",
        description: "Normal cursor on empty canvas areas and non-interactive UI.",
        nativeDefault: "Browser default arrow",
        nativeCursor: "default",
        demoCursor: "default",
        demoActiveCursor: "default",
        demoHint: "Hover this box to feel the native default cursor.",
        enableToggle: false,
        disabledFallbackKey: null
    },
    {
        key: "hover",
        tabLabel: "Hover",
        label: "Hover / Clickable",
        description: "Used over hovered tokens and clickable Foundry controls.",
        nativeDefault: "Pointing hand",
        nativeCursor: "pointer",
        demoCursor: "pointer",
        demoActiveCursor: "pointer",
        demoHint: "Hover this box to preview Foundry's native clickable cursor.",
        enableToggle: true,
        disabledFallbackKey: "default"
    },
    {
        key: "click",
        tabLabel: "Click",
        label: "Click / Press",
        description: "Used while holding the mouse on clickable controls and pointer-mode canvas interactions.",
        nativeDefault: "Pressed clickable cursor",
        nativeCursor: "pointer",
        demoCursor: "pointer",
        demoActiveCursor: "pointer",
        demoHint: "Press and hold this box to preview the native pressed clickable cursor.",
        enableToggle: true,
        disabledFallbackKey: "hover"
    },
    {
        key: "drag",
        tabLabel: "Grab",
        label: "Hover To Drag",
        description: "Used over draggable headers, item rows, and other drag sources.",
        nativeDefault: "Open-hand grab",
        nativeCursor: "grab",
        demoCursor: "grab",
        demoActiveCursor: "grab",
        demoHint: "Hover this box to preview Foundry's native drag-ready cursor.",
        enableToggle: true,
        disabledFallbackKey: "default"
    },
    {
        key: "dragging",
        tabLabel: "Dragging",
        label: "Dragging",
        description: "Used while actively dragging draggable UI elements or drag sources.",
        nativeDefault: "Closed-hand grabbing",
        nativeCursor: "grabbing",
        demoCursor: "grab",
        demoActiveCursor: "grabbing",
        demoHint: "Press and hold this box to preview the native dragging cursor.",
        enableToggle: true,
        disabledFallbackKey: "drag"
    },
    {
        key: "resize",
        tabLabel: "Resize",
        label: "Resize",
        description: "Used over Foundry window resize handles.",
        nativeDefault: "Diagonal resize handle",
        nativeCursor: "nwse-resize",
        demoCursor: "nwse-resize",
        demoActiveCursor: "nwse-resize",
        demoHint: "Hover this box to preview the native resize cursor.",
        enableToggle: true,
        disabledFallbackKey: "default"
    },
    {
        key: "text",
        tabLabel: "Text",
        label: "Text Editing",
        description: "Used over text fields, editors, and editable content.",
        nativeDefault: "I-beam text cursor",
        nativeCursor: "text",
        demoCursor: "text",
        demoActiveCursor: "text",
        demoHint: "Hover this box to preview the native text-editing cursor.",
        enableToggle: true,
        disabledFallbackKey: "default"
    },
    {
        key: "targeting",
        tabLabel: "Target",
        label: "Targeting Mode",
        description: "Used when the targeting tool is active on the canvas.",
        nativeDefault: "Crosshair targeting cursor",
        nativeCursor: "crosshair",
        demoCursor: "crosshair",
        demoActiveCursor: "crosshair",
        demoHint: "Hover this box to preview the native targeting cursor.",
        enableToggle: true,
        disabledFallbackKey: "default"
    },
    {
        key: "panning",
        tabLabel: "Panning",
        label: "Panning / Dragging",
        description: "Used while right-dragging the canvas to pan the scene.",
        nativeDefault: "Closed-hand panning cursor",
        nativeCursor: "grabbing",
        demoCursor: "grab",
        demoActiveCursor: "grabbing",
        demoHint: "Press and hold this box to preview the native panning cursor.",
        enableToggle: true,
        disabledFallbackKey: "default"
    }
]);

export const CURSOR_STATE_KEYS = CURSOR_STATE_DEFINITIONS.map(state => state.key);
export const CURSOR_STATE_LABELS = Object.freeze(
    Object.fromEntries(CURSOR_STATE_DEFINITIONS.map(state => [state.key, state.label]))
);
export const CURSOR_STATE_DETAILS = Object.freeze(
    Object.fromEntries(CURSOR_STATE_DEFINITIONS.map(state => [state.key, state]))
);

// Pixels per stored offset unit when projecting the overlay name label onto the
// config preview image. Offsets are persisted as image half-size multipliers.
export const NAME_LABEL_PREVIEW_SCALE = 16;

export const NAME_POSITION_PRESETS = {
    "bottom-center": { anchorX: 0.5, anchorY: 0, offsetX: 0, offsetY: 1.2 },
    "bottom-right":  { anchorX: 0, anchorY: 0, offsetX: 0.5, offsetY: 0.6 },
    "top-center":    { anchorX: 0.5, anchorY: 1, offsetX: 0, offsetY: -0.3 },
    "right":         { anchorX: 0, anchorY: 0.5, offsetX: 1.0, offsetY: 0.3 }
};

// Marquee box select visuals and drag threshold.
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
        // Settings are not registered during early module import.
    }
}
