import { CURSOR_SIZE_MAX, MODULE_ID, STYLE_ID, debugLog } from './constants.js';
import { getUserCursorConfig } from './settings.js';
import { computeCursorDisplaySize, computeResizeOutput, computeRotationOutput } from './cursor-geometry-core.js';

export function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

const POINTER_UI_SELECTOR = [
    "a",
    "button",
    "select",
    "summary",
    "[role='button']",
    "[data-action]",
    "[data-control]",
    "[data-tab]",
    ".control-tool",
    ".scene-control",
    ".header-button",
    ".window-header .header-control",
    ".window-app .tab",
    ".window-app .directory-item",
    ".window-app .item-control",
    ".window-app .effect-control",
    ".window-app .rollable"
].join(", ");
const DRAG_UI_SELECTOR = [
    ".window-app li.item",
    ".window-app .item-name",
    "[draggable='true']",
    ".draggable"
].join(", ");
const TEXT_UI_SELECTOR = [
    "input:not([type='range']):not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit']):not([type='reset']):not([type='file']):not([type='color'])",
    "textarea",
    "[contenteditable='true']",
    ".editor-content",
    ".ProseMirror"
].join(", ");
const RESIZE_SELECTOR = [
    ".application .window-resize-handle",
    "body.game .app .window-resizable-handle"
].join(", ");

const ROOT_CURSOR_VARIABLES = [
    { key: "default", cssVar: "--cursor-default", fallback: "default", disabledFallback: "default" },
    { key: "hover", cssVar: "--cursor-pointer", fallback: "pointer", disabledFallback: "var(--cursor-default)" },
    { key: "click", cssVar: "--cursor-pointer-down", fallback: "pointer", disabledFallback: "var(--cursor-pointer)" },
    { key: "drag", cssVar: "--cursor-grab", fallback: "grab", disabledFallback: "var(--cursor-default)" },
    { key: "dragging", cssVar: "--cursor-grab-down", fallback: "grabbing", disabledFallback: "var(--cursor-grab)" },
    { key: "text", cssVar: "--cursor-text", fallback: "text", disabledFallback: "var(--cursor-default)" }
];

let _applyCursorSerial = 0;

function summarizeCursorStatesForLog(states = {}) {
    return Object.fromEntries(Object.entries(states ?? {}).map(([key, state]) => [
        key,
        {
            enabled: state?.enabled !== false,
            hasImage: typeof state?.image === "string" && state.image.length > 0,
            image: state?.image || "",
            hotspot: [state?.hotspotX ?? 0, state?.hotspotY ?? 0],
            rotation: state?.rotation ?? 0,
            size: [state?.width ?? 0, state?.height ?? 0]
        }
    ]));
}

function summarizeCursorValueForLog(value) {
    if (typeof value !== "string") return value;
    const summarized = value.replace(/url\('data:image\/[^']+'\)/g, match => `url('[data-url ${match.length} chars]')`);
    return summarized.length > 240 ? `${summarized.slice(0, 240)}...` : summarized;
}

export async function getRotatedCursor(imageSrc, hotspotX, hotspotY, degrees, targetWidth = 0, targetHeight = 0) {
    const hasRotation = degrees && degrees !== 0;
    const hasResize = targetWidth > 0 || targetHeight > 0;
    if (!hasRotation && !hasResize) return null;

    const img = await loadImage(imageSrc);
    const { width: displayW, height: displayH } = computeCursorDisplaySize(img.width, img.height, targetWidth, targetHeight);

    // Hotspot values are in output (display) image coordinate space; no extra scaling needed.
    if (!hasRotation) {
        const out = computeResizeOutput(displayW, displayH, hotspotX, hotspotY, CURSOR_SIZE_MAX);

        debugLog("cursor", `getRotatedCursor: resize only -> ${out.width}x${out.height}, hotspot=(${out.hotspotX},${out.hotspotY})`);

        const canvas = document.createElement("canvas");
        canvas.width = out.width;
        canvas.height = out.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, out.width, out.height);

        return { dataUrl: canvas.toDataURL("image/png"), hotspotX: out.hotspotX, hotspotY: out.hotspotY };
    }

    const out = computeRotationOutput(displayW, displayH, hotspotX, hotspotY, degrees, CURSOR_SIZE_MAX);

    if (out.scale < 1) {
        debugLog("cursor", `getRotatedCursor: rotated size exceeds ${CURSOR_SIZE_MAX}px, scaling by ${out.scale.toFixed(3)}`);
    }

    const canvas = document.createElement("canvas");
    canvas.width = out.width;
    canvas.height = out.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.translate(out.width / 2, out.height / 2);
    ctx.scale(out.scale, out.scale);
    ctx.rotate(out.rad);
    ctx.drawImage(img, -displayW / 2, -displayH / 2, displayW, displayH);

    debugLog("cursor", `getRotatedCursor: final size=${out.width}x${out.height}, hotspot=(${out.hotspotX},${out.hotspotY})`);

    return {
        dataUrl: canvas.toDataURL("image/png"),
        hotspotX: out.hotspotX,
        hotspotY: out.hotspotY
    };
}

async function buildCursorValue(state, fallback, disabledFallback = fallback) {
    if (state?.enabled === false) {
        return disabledFallback;
    }

    if (!state?.image) {
        return fallback;
    }

    const rotation = state.rotation || 0;
    const targetWidth = state.width || 0;
    const targetHeight = state.height || 0;

    if (rotation !== 0 || targetWidth > 0 || targetHeight > 0) {
        try {
            const processed = await getRotatedCursor(state.image, state.hotspotX, state.hotspotY, rotation, targetWidth, targetHeight);
            if (processed) {
                debugLog("cursor", `buildCursorValue: processed image -> hotspot=(${processed.hotspotX},${processed.hotspotY}), dataUrl length=${processed.dataUrl.length}`);
                return `url('${processed.dataUrl}') ${processed.hotspotX} ${processed.hotspotY}, ${fallback}`;
            }
        } catch (e) {
            console.warn(`${MODULE_ID} | Failed to process cursor image:`, e);
        }
    }

    try {
        const testImg = await loadImage(state.image);
        debugLog("cursor", `buildCursorValue: image loaded OK -> ${testImg.width}x${testImg.height}px, src="${state.image}"`);
        return `url('${state.image}') ${state.hotspotX} ${state.hotspotY}, ${fallback}`;
    } catch (e) {
        console.warn(`${MODULE_ID} | Cursor image FAILED to load: "${state.image}"`, e);
        debugLog("cursor", `buildCursorValue: IMAGE LOAD FAILED for "${state.image}" -> falling back to ${fallback}`);
        return fallback;
    }
}

function buildCursorRule(selector, cursorValue, important = false) {
    return `${selector} { cursor: ${cursorValue}${important ? " !important" : ""}; }`;
}

function restoreFoundryCursorVariables() {
    if (typeof game?.configureCursors === "function") {
        game.configureCursors();
        debugLog("cursor", "restoreFoundryCursorVariables: reset root cursor vars through game.configureCursors()");
        return;
    }

    const rootStyle = document.documentElement?.style;
    if (!rootStyle) return;
    for (const key of Object.keys(rootStyle)) {
        if (key.startsWith("--cursor")) rootStyle.removeProperty(key);
    }
    debugLog("cursor", "restoreFoundryCursorVariables: removed root cursor vars as fallback");
}

export async function applyCursorStyles(isEnabled) {
    const applyId = ++_applyCursorSerial;
    const config = getUserCursorConfig(game.user);
    const enabled = isEnabled ?? config.useCustomCursor;
    debugLog("cursor", `applyCursorStyles called, isEnabled=${enabled}`);

    const existingStyle = document.getElementById(STYLE_ID);
    if (existingStyle) {
        debugLog("cursor", "applyCursorStyles: removing existing style element");
        existingStyle.remove();
    }

    restoreFoundryCursorVariables();

    if (!enabled) {
        debugLog("cursor", "Custom cursor disabled.");
        return;
    }

    const states = config.cursorStates;
    debugLog("cursor", "applyCursorStyles: loaded user cursor-states summary:", summarizeCursorStatesForLog(states));

    const rootCursorValues = [];
    for (const nativeState of ROOT_CURSOR_VARIABLES) {
        const value = await buildCursorValue(states[nativeState.key], nativeState.fallback, nativeState.disabledFallback);
        if (applyId !== _applyCursorSerial) {
            debugLog("cursor", "applyCursorStyles: stale async apply cancelled before root vars");
            return;
        }
        rootCursorValues.push({ cssVar: nativeState.cssVar, value });
    }

    const cssParts = [];
    cssParts.push(buildCursorRule("body", "var(--cursor-default)"));
    cssParts.push(buildCursorRule("#board", "var(--cursor-default)", true));

    if (states.drag) {
        cssParts.push(buildCursorRule(`body :is(${DRAG_UI_SELECTOR})`, "var(--cursor-grab)"));
    }

    if (states.text) {
        cssParts.push(buildCursorRule(`body :is(${TEXT_UI_SELECTOR})`, "var(--cursor-text)"));
    }

    if (states.hover) {
        cssParts.push(buildCursorRule(`body :is(${POINTER_UI_SELECTOR})`, "var(--cursor-pointer)"));
        cssParts.push(buildCursorRule("#board.ttb-cursor-hover, #board.ttb-cursor-hover *", "var(--cursor-pointer)", true));
    }

    const resizeValue = await buildCursorValue(states.resize, "nwse-resize", "var(--cursor-default)");
    if (applyId !== _applyCursorSerial) {
        debugLog("cursor", "applyCursorStyles: stale async apply cancelled before resize CSS");
        return;
    }
    cssParts.push(buildCursorRule(RESIZE_SELECTOR, resizeValue));

    const targetingValue = await buildCursorValue(states.targeting, "crosshair", "var(--cursor-default)");
    if (applyId !== _applyCursorSerial) {
        debugLog("cursor", "applyCursorStyles: stale async apply cancelled before targeting CSS");
        return;
    }
    cssParts.push(buildCursorRule("#board.ttb-cursor-targeting, #board.ttb-cursor-targeting *", targetingValue, true));

    const panningValue = await buildCursorValue(states.panning, "grabbing", "var(--cursor-default)");
    if (applyId !== _applyCursorSerial) {
        debugLog("cursor", "applyCursorStyles: stale async apply cancelled before panning CSS");
        return;
    }
    cssParts.push(buildCursorRule("#board.ttb-cursor-panning, #board.ttb-cursor-panning *", panningValue, true));

    const finalCSS = cssParts.join("\n");
    debugLog("cursor", `applyCursorStyles: generated ${cssParts.length} CSS rules (${finalCSS.length} chars)`);

    const rootStyle = document.documentElement?.style;
    for (const { cssVar, value } of rootCursorValues) {
        rootStyle?.setProperty(cssVar, value);
        debugLog("cursor", `applyCursorStyles: set ${cssVar} = ${summarizeCursorValueForLog(value)}`);
    }
    rootStyle?.setProperty("--cursor-default-down", "var(--cursor-default)");
    rootStyle?.setProperty("--cursor-text-down", "var(--cursor-text)");
    debugLog("cursor", "applyCursorStyles: set inline root cursor vars");

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = finalCSS;
    document.head.appendChild(style);
    debugLog("cursor", "Custom cursor applied.");
}
