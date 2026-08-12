/**
 * @file cursor-styles.js
 * @description Builds and applies Show of Hands cursor CSS from the local
 * user's cursor profile.
 */

import {
    CURSOR_CLICKABLE_SELECTOR,
    CURSOR_DRAGGABLE_SELECTOR,
    CURSOR_INACTIVE_SELECTOR,
    CURSOR_SIZE_MAX,
    MODULE_ID,
    STYLE_ID,
    debugLog
} from './constants.js';
import { getUserCursorConfig } from './settings.js';
import { computeCursorProcessingGeometry } from './cursor-geometry-core.js';

export const CURSOR_IMAGE_LOAD_TIMEOUT_MS = 10_000;

export function loadImage(src, { timeoutMs = CURSOR_IMAGE_LOAD_TIMEOUT_MS } = {}) {
    const requestedTimeout = Number(timeoutMs);
    const effectiveTimeout = Number.isFinite(requestedTimeout) && requestedTimeout >= 0
        ? Math.min(requestedTimeout, CURSOR_IMAGE_LOAD_TIMEOUT_MS)
        : CURSOR_IMAGE_LOAD_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
        const img = new Image();
        let settled = false;
        let timeoutId = null;

        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
            img.onload = null;
            img.onerror = null;
            callback(value);
        };

        img.onload = () => finish(resolve, img);
        img.onerror = () => finish(reject, new Error(`Cursor image failed to load: "${src}"`));
        timeoutId = globalThis.setTimeout(() => {
            const error = new Error(`Cursor image load timed out after ${effectiveTimeout}ms: "${src}"`);
            error.name = "TimeoutError";
            finish(reject, error);
            try {
                img.removeAttribute?.("src");
            } catch {
                // Ignore an image element that became unavailable during abort.
            }
        }, effectiveTimeout);

        try {
            img.src = src;
        } catch (error) {
            finish(reject, error);
        }
    });
}

function getCursorDocuments() {
    const documents = new Set();
    if (globalThis.document) documents.add(globalThis.document);

    try {
        const windows = globalThis.foundry?.applications?.detached?.windows;
        for (const descriptor of windows?.values?.() ?? []) {
            const win = descriptor?.window ?? descriptor;
            if (!win?.closed && win?.document) documents.add(win.document);
        }
    } catch {
        // A detached window can close while its registry is being traversed.
    }
    return [...documents];
}

function getCursorVariableNames(style) {
    const names = new Set();
    if (!style) return names;
    if (Number.isFinite(style.length) && typeof style.item === "function") {
        for (let index = 0; index < style.length; index += 1) {
            const name = style.item(index);
            if (name?.startsWith?.("--cursor")) names.add(name);
        }
    }
    for (const name of Object.keys(style)) {
        if (name.startsWith("--cursor")) names.add(name);
    }
    return names;
}

function removeCursorVariables(doc) {
    const style = doc?.documentElement?.style;
    if (!style) return;
    for (const name of getCursorVariableNames(style)) style.removeProperty(name);
}

function copyCursorVariables(sourceDocument, targetDocument) {
    if (!sourceDocument || !targetDocument || sourceDocument === targetDocument) return;
    const source = sourceDocument.documentElement?.style;
    const target = targetDocument.documentElement?.style;
    if (!source || !target) return;
    removeCursorVariables(targetDocument);
    for (const name of getCursorVariableNames(source)) {
        const value = source.getPropertyValue?.(name) ?? source[name];
        const priority = source.getPropertyPriority?.(name) ?? "";
        if (value !== undefined && value !== null && value !== "") target.setProperty(name, value, priority);
    }
}

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
const ACTIVE_CLICKABLE_UI_SELECTOR = [
    `:is(${CURSOR_CLICKABLE_SELECTOR})`,
    `:not(:is(${CURSOR_INACTIVE_SELECTOR}))`,
    // When the same element is both clickable and draggable, its grab cursor
    // owns the interaction. A real nested button does not match this exclusion
    // and therefore keeps the clickable cursor.
    `:not(:is(${CURSOR_DRAGGABLE_SELECTOR}))`
].join("");

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

function serializeCssString(value) {
    const escaped = String(value).replace(/[\0-\x1F\x7F'\\\u2028\u2029]/g, character => {
        const codePoint = character.codePointAt(0);
        if (codePoint === 0x27 || codePoint === 0x5C) return `\\${character}`;
        return codePoint === 0 ? "\\fffd " : `\\${codePoint.toString(16)} `;
    });
    return `'${escaped}'`;
}

function buildCursorUrl(value) {
    return `url(${serializeCssString(value)})`;
}

function processLoadedCursor(img, hotspotX, hotspotY, degrees, targetWidth, targetHeight) {
    const naturalWidth = Number(img?.naturalWidth || img?.width || 0);
    const naturalHeight = Number(img?.naturalHeight || img?.height || 0);
    const hasRotation = degrees && degrees !== 0;
    const hasResize = targetWidth > 0 || targetHeight > 0;
    const exceedsCursorCap = naturalWidth > CURSOR_SIZE_MAX || naturalHeight > CURSOR_SIZE_MAX;
    const hotspotNeedsClamp = hotspotX < 0 || hotspotY < 0 || hotspotX >= naturalWidth || hotspotY >= naturalHeight;
    if (!hasRotation && !hasResize && !exceedsCursorCap && !hotspotNeedsClamp) return null;
    if (!(naturalWidth > 0) || !(naturalHeight > 0)) return null;

    const out = computeCursorProcessingGeometry(
        naturalWidth,
        naturalHeight,
        targetWidth,
        targetHeight,
        hotspotX,
        hotspotY,
        degrees,
        CURSOR_SIZE_MAX
    );
    const displayW = out.displayWidth;
    const displayH = out.displayHeight;

    if (!hasRotation) {
        debugLog("cursor", `getRotatedCursor: resize only -> ${out.width}x${out.height}, hotspot=(${out.hotspotX},${out.hotspotY})`);

        const canvas = document.createElement("canvas");
        canvas.width = out.width;
        canvas.height = out.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, out.width, out.height);

        return { dataUrl: canvas.toDataURL("image/png"), hotspotX: out.hotspotX, hotspotY: out.hotspotY };
    }

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

export async function getRotatedCursor(imageSrc, hotspotX, hotspotY, degrees, targetWidth = 0, targetHeight = 0) {
    const img = await loadImage(imageSrc);
    return processLoadedCursor(img, hotspotX, hotspotY, degrees, targetWidth, targetHeight);
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

    try {
        const testImg = await loadImage(state.image);
        const processed = processLoadedCursor(testImg, state.hotspotX, state.hotspotY, rotation, targetWidth, targetHeight);
        if (processed) {
            debugLog("cursor", `buildCursorValue: processed image -> hotspot=(${processed.hotspotX},${processed.hotspotY}), dataUrl length=${processed.dataUrl.length}`);
            return `${buildCursorUrl(processed.dataUrl)} ${processed.hotspotX} ${processed.hotspotY}, ${fallback}`;
        }
        debugLog("cursor", `buildCursorValue: image loaded OK -> ${testImg.width}x${testImg.height}px, src="${state.image}"`);
        return `${buildCursorUrl(state.image)} ${state.hotspotX} ${state.hotspotY}, ${fallback}`;
    } catch (e) {
        console.warn(`${MODULE_ID} | Cursor image FAILED to load: "${state.image}"`, e);
        debugLog("cursor", `buildCursorValue: IMAGE LOAD FAILED for "${state.image}" -> falling back to ${fallback}`);
        return fallback;
    }
}

function buildCursorRule(selector, cursorValue, important = false) {
    return `${selector} { cursor: ${cursorValue}${important ? " !important" : ""}; }`;
}

function restoreFoundryCursorVariables(documents = getCursorDocuments()) {
    // Foundry owns the root cursor variables. Restore its defaults first, then
    // layer Show of Hands overrides inline on documentElement below.
    if (typeof game?.configureCursors === "function") {
        game.configureCursors();
        const primaryDocument = globalThis.document;
        for (const doc of documents) copyCursorVariables(primaryDocument, doc);
        debugLog("cursor", "restoreFoundryCursorVariables: reset root cursor vars through game.configureCursors()");
        return;
    }

    for (const doc of documents) removeCursorVariables(doc);
    debugLog("cursor", "restoreFoundryCursorVariables: removed root cursor vars as fallback");
}

export async function applyCursorStyles(isEnabled) {
    const applyId = ++_applyCursorSerial;
    const config = getUserCursorConfig(game.user);
    const enabled = isEnabled ?? config.useCustomCursor;
    debugLog("cursor", `applyCursorStyles called, isEnabled=${enabled}`);

    if (!enabled) {
        const targetDocuments = getCursorDocuments();
        restoreFoundryCursorVariables(targetDocuments);
        for (const doc of targetDocuments) doc.getElementById?.(STYLE_ID)?.remove?.();
        debugLog("cursor", "Custom cursor disabled.");
        return;
    }

    const states = config.cursorStates;
    debugLog("cursor", "applyCursorStyles: loaded user cursor-states summary:", summarizeCursorStatesForLog(states));

    // Resolve independent state images together. No active DOM state is touched
    // until every value is ready and this generation is still current.
    const [rootCursorValues, resizeValue, targetingValue, panningValue] = await Promise.all([
        Promise.all(ROOT_CURSOR_VARIABLES.map(async nativeState => ({
            cssVar: nativeState.cssVar,
            value: await buildCursorValue(states[nativeState.key], nativeState.fallback, nativeState.disabledFallback)
        }))),
        buildCursorValue(states.resize, "nwse-resize", "var(--cursor-default)"),
        buildCursorValue(states.targeting, "crosshair", "var(--cursor-default)"),
        buildCursorValue(states.panning, "grabbing", "var(--cursor-default)")
    ]);
    if (applyId !== _applyCursorSerial) {
        debugLog("cursor", "applyCursorStyles: stale async apply cancelled before DOM commit");
        return;
    }
    const clickCursorValue = rootCursorValues.find(entry => entry.cssVar === "--cursor-pointer-down")?.value;
    const shouldShareClickCursorWithDefaultDown = states.click?.enabled === false
        || (typeof clickCursorValue === "string" && clickCursorValue.startsWith("url("));

    const cssParts = [];
    cssParts.push(buildCursorRule("body", "var(--cursor-default)"));
    // Keep this non-important so PIXI's inline pointer-down/default-down and
    // grabbing states can advance through Foundry's V14 cursor state machine.
    cssParts.push(buildCursorRule("#board", "var(--cursor-default)"));

    if (states.drag) {
        cssParts.push(buildCursorRule(`body :is(${CURSOR_DRAGGABLE_SELECTOR})`, "var(--cursor-grab)"));
    }

    if (states.text) {
        cssParts.push(buildCursorRule(`body :is(${TEXT_UI_SELECTOR})`, "var(--cursor-text)"));
    }

    if (states.hover) {
        cssParts.push(buildCursorRule(`body ${ACTIVE_CLICKABLE_UI_SELECTOR}`, "var(--cursor-pointer)"));
        cssParts.push(buildCursorRule("#board.ttb-cursor-hover, #board.ttb-cursor-hover *", "var(--cursor-pointer)"));
    }

    if (states.click) {
        // Once a qualifying press begins, keep its cursor while the pointer is
        // held even if it moves off the original control before release.
        cssParts.push(buildCursorRule("body.ttb-cursor-click, body.ttb-cursor-click *", "var(--cursor-pointer-down)", true));
    }

    cssParts.push(buildCursorRule(RESIZE_SELECTOR, resizeValue));
    cssParts.push(buildCursorRule("#board.ttb-cursor-targeting, #board.ttb-cursor-targeting *", targetingValue, true));
    cssParts.push(buildCursorRule("#board.ttb-cursor-panning, #board.ttb-cursor-panning *", panningValue, true));

    const finalCSS = cssParts.join("\n");
    debugLog("cursor", `applyCursorStyles: generated ${cssParts.length} CSS rules (${finalCSS.length} chars)`);

    // A pop-out may have opened while image processing was in flight. Refresh
    // the target set and prepare replacements before touching the active style.
    const targetDocuments = getCursorDocuments();
    const replacements = targetDocuments.map(doc => {
        const replacement = doc.createElement?.("style") ?? null;
        if (replacement) {
            replacement.id = `${STYLE_ID}-pending-${applyId}`;
            replacement.textContent = finalCSS;
        }
        return {
            doc,
            existingStyle: doc.getElementById?.(STYLE_ID) ?? null,
            replacement
        };
    });

    // The generation cannot interleave once this synchronous commit begins.
    // Append the ready stylesheet before removing its predecessor so there is
    // no frame in which custom cursor rules disappear.
    for (const target of replacements) {
        if (!target.replacement || !target.doc.head) continue;
        try {
            target.doc.head.appendChild(target.replacement);
        } catch (error) {
            target.replacement = null;
            console.warn(`${MODULE_ID} | Failed to stage cursor styles in a document:`, error);
        }
    }

    restoreFoundryCursorVariables(targetDocuments);
    for (const { doc } of replacements) {
        const rootStyle = doc.documentElement?.style;
        for (const { cssVar, value } of rootCursorValues) {
            rootStyle?.setProperty(cssVar, value);
            debugLog("cursor", `applyCursorStyles: set ${cssVar} = ${summarizeCursorValueForLog(value)}`);
        }
        // A configured click image covers both non-dragging press types. When
        // the image is empty or failed to load, preserve Foundry's distinct
        // native default-down fallback instead of turning the canvas arrow into
        // pointer-down. A disabled click state intentionally falls back to Hover.
        if (shouldShareClickCursorWithDefaultDown) {
            rootStyle?.setProperty("--cursor-default-down", "var(--cursor-pointer-down)");
        }
        rootStyle?.setProperty("--cursor-text-down", "var(--cursor-text)");
    }
    for (const { existingStyle, replacement } of replacements) {
        if (!replacement) continue;
        existingStyle?.remove?.();
        replacement.id = STYLE_ID;
    }
    debugLog("cursor", "applyCursorStyles: set inline root cursor vars in all live documents");
    debugLog("cursor", "Custom cursor applied.");
}
