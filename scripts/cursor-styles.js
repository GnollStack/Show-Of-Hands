import { MODULE_ID, STYLE_ID, debugLog } from './constants.js';

export function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

const MAX_CURSOR_SIZE = 128;
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

export async function getRotatedCursor(imageSrc, hotspotX, hotspotY, degrees, targetWidth = 0, targetHeight = 0) {
    const hasRotation = degrees && degrees !== 0;
    const hasResize = targetWidth > 0 || targetHeight > 0;
    if (!hasRotation && !hasResize) return null;

    const img = await loadImage(imageSrc);
    const nW = img.width;
    const nH = img.height;

    // Determine display size after resize
    let displayW = nW;
    let displayH = nH;
    if (targetWidth > 0 && targetHeight > 0) {
        displayW = targetWidth;
        displayH = targetHeight;
    } else if (targetWidth > 0) {
        displayW = targetWidth;
        displayH = Math.round(nH * (targetWidth / nW));
    } else if (targetHeight > 0) {
        displayH = targetHeight;
        displayW = Math.round(nW * (targetHeight / nH));
    }

    // Hotspot values are in output (display) image coordinate space; no extra scaling needed.
    if (!hasRotation) {
        const maxDim = Math.max(displayW, displayH);
        const scale = maxDim > MAX_CURSOR_SIZE ? MAX_CURSOR_SIZE / maxDim : 1;
        const finalW = Math.ceil(displayW * scale);
        const finalH = Math.ceil(displayH * scale);
        const finalHotspotX = Math.max(0, Math.round(hotspotX * scale));
        const finalHotspotY = Math.max(0, Math.round(hotspotY * scale));

        debugLog("cursor", `getRotatedCursor: resize only -> ${finalW}x${finalH}, hotspot=(${finalHotspotX},${finalHotspotY})`);

        const canvas = document.createElement("canvas");
        canvas.width = finalW;
        canvas.height = finalH;
        canvas.getContext("2d").drawImage(img, 0, 0, finalW, finalH);

        return { dataUrl: canvas.toDataURL("image/png"), hotspotX: finalHotspotX, hotspotY: finalHotspotY };
    }

    const rad = (degrees * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    let newW = Math.ceil(Math.abs(displayW * cos) + Math.abs(displayH * sin));
    let newH = Math.ceil(Math.abs(displayW * sin) + Math.abs(displayH * cos));

    const cx = displayW / 2;
    const cy = displayH / 2;
    const dx = hotspotX - cx;
    const dy = hotspotY - cy;
    let newHotspotX = newW / 2 + dx * cos - dy * sin;
    let newHotspotY = newH / 2 + dx * sin + dy * cos;

    const maxDim = Math.max(newW, newH);
    const scale = maxDim > MAX_CURSOR_SIZE ? MAX_CURSOR_SIZE / maxDim : 1;

    if (scale < 1) {
        debugLog("cursor", `getRotatedCursor: rotated size ${newW}x${newH} exceeds ${MAX_CURSOR_SIZE}px, scaling by ${scale.toFixed(3)}`);
        newHotspotX *= scale;
        newHotspotY *= scale;
        newW = Math.ceil(newW * scale);
        newH = Math.ceil(newH * scale);
    }

    const canvas = document.createElement("canvas");
    canvas.width = newW;
    canvas.height = newH;
    const ctx = canvas.getContext("2d");

    ctx.translate(newW / 2, newH / 2);
    ctx.scale(scale, scale);
    ctx.rotate(rad);
    ctx.drawImage(img, -displayW / 2, -displayH / 2, displayW, displayH);

    const finalHotspotX = Math.max(0, Math.round(newHotspotX));
    const finalHotspotY = Math.max(0, Math.round(newHotspotY));

    debugLog("cursor", `getRotatedCursor: final size=${newW}x${newH}, hotspot=(${finalHotspotX},${finalHotspotY})`);

    return {
        dataUrl: canvas.toDataURL("image/png"),
        hotspotX: finalHotspotX,
        hotspotY: finalHotspotY
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
    debugLog("cursor", `applyCursorStyles called, isEnabled=${isEnabled}`);

    const existingStyle = document.getElementById(STYLE_ID);
    if (existingStyle) {
        debugLog("cursor", "applyCursorStyles: removing existing style element");
        existingStyle.remove();
    }

    restoreFoundryCursorVariables();

    if (!isEnabled) {
        debugLog("cursor", "Custom cursor disabled.");
        return;
    }

    const states = game.settings.get(MODULE_ID, "cursor-states");
    debugLog("cursor", "applyCursorStyles: loaded cursor-states from settings:", JSON.stringify(states, null, 2));

    const rootStyle = document.documentElement?.style;
    for (const nativeState of ROOT_CURSOR_VARIABLES) {
        const value = await buildCursorValue(states[nativeState.key], nativeState.fallback, nativeState.disabledFallback);
        rootStyle?.setProperty(nativeState.cssVar, value);
        debugLog("cursor", `applyCursorStyles: set ${nativeState.cssVar} = ${value}`);
    }
    rootStyle?.setProperty("--cursor-default-down", "var(--cursor-default)");
    rootStyle?.setProperty("--cursor-text-down", "var(--cursor-text)");
    debugLog("cursor", "applyCursorStyles: set inline root cursor vars");

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
    cssParts.push(buildCursorRule(RESIZE_SELECTOR, resizeValue));

    const targetingValue = await buildCursorValue(states.targeting, "crosshair", "var(--cursor-default)");
    cssParts.push(buildCursorRule("#board.ttb-cursor-targeting, #board.ttb-cursor-targeting *", targetingValue, true));

    const panningValue = await buildCursorValue(states.panning, "grabbing", "var(--cursor-default)");
    cssParts.push(buildCursorRule("#board.ttb-cursor-panning, #board.ttb-cursor-panning *", panningValue, true));

    const finalCSS = cssParts.join("\n");
    debugLog("cursor", "applyCursorStyles: final CSS:\n", finalCSS);

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = finalCSS;
    document.head.appendChild(style);
    debugLog("cursor", "Custom cursor applied.");
}
