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

    // Hotspot values are in output (display) image coordinate space — no scaling needed.
    // drawImage handles the resize; the hotspot pixel positions stay as the user set them.

    if (!hasRotation) {
        // Resize only — clamp to MAX_CURSOR_SIZE
        const maxDim = Math.max(displayW, displayH);
        const scale = maxDim > MAX_CURSOR_SIZE ? MAX_CURSOR_SIZE / maxDim : 1;
        const finalW = Math.ceil(displayW * scale);
        const finalH = Math.ceil(displayH * scale);
        const finalHotspotX = Math.max(0, Math.round(hotspotX * scale));
        const finalHotspotY = Math.max(0, Math.round(hotspotY * scale));

        debugLog("cursor", `getRotatedCursor: resize only → ${finalW}x${finalH}, hotspot=(${finalHotspotX},${finalHotspotY})`);

        const canvas = document.createElement('canvas');
        canvas.width = finalW;
        canvas.height = finalH;
        canvas.getContext('2d').drawImage(img, 0, 0, finalW, finalH);

        return { dataUrl: canvas.toDataURL('image/png'), hotspotX: finalHotspotX, hotspotY: finalHotspotY };
    }

    // Rotation (with optional resize applied via drawImage dimensions)
    const rad = (degrees * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // New bounding box after rotating the display-sized image
    let newW = Math.ceil(Math.abs(displayW * cos) + Math.abs(displayH * sin));
    let newH = Math.ceil(Math.abs(displayW * sin) + Math.abs(displayH * cos));

    // Transform hotspot: rotate around display image center, then offset to new canvas center
    const cx = displayW / 2;
    const cy = displayH / 2;
    const dx = hotspotX - cx;
    const dy = hotspotY - cy;
    let newHotspotX = newW / 2 + dx * cos - dy * sin;
    let newHotspotY = newH / 2 + dx * sin + dy * cos;

    // Scale down if exceeds MAX_CURSOR_SIZE
    const maxDim = Math.max(newW, newH);
    const scale = maxDim > MAX_CURSOR_SIZE ? MAX_CURSOR_SIZE / maxDim : 1;

    if (scale < 1) {
        debugLog("cursor", `getRotatedCursor: rotated size ${newW}x${newH} exceeds ${MAX_CURSOR_SIZE}px, scaling by ${scale.toFixed(3)}`);
        newHotspotX *= scale;
        newHotspotY *= scale;
        newW = Math.ceil(newW * scale);
        newH = Math.ceil(newH * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = newW;
    canvas.height = newH;
    const ctx = canvas.getContext('2d');

    ctx.translate(newW / 2, newH / 2);
    ctx.scale(scale, scale);
    ctx.rotate(rad);
    // Draw at display size (handles resize + rotation in one pass)
    ctx.drawImage(img, -displayW / 2, -displayH / 2, displayW, displayH);

    const finalHotspotX = Math.max(0, Math.round(newHotspotX));
    const finalHotspotY = Math.max(0, Math.round(newHotspotY));

    debugLog("cursor", `getRotatedCursor: final size=${newW}x${newH}, hotspot=(${finalHotspotX},${finalHotspotY})`);

    return {
        dataUrl: canvas.toDataURL('image/png'),
        hotspotX: finalHotspotX,
        hotspotY: finalHotspotY
    };
}

async function buildCursorCSS(selector, state, important) {
    const imp = important ? " !important" : "";
    const rotation = state.rotation || 0;

    debugLog("cursor", `buildCursorCSS: selector="${selector}" image="${state.image}" hotspot=(${state.hotspotX},${state.hotspotY}) rotation=${rotation}`);

    const targetWidth = state.width || 0;
    const targetHeight = state.height || 0;

    if (rotation !== 0 || targetWidth > 0 || targetHeight > 0) {
        try {
            const processed = await getRotatedCursor(state.image, state.hotspotX, state.hotspotY, rotation, targetWidth, targetHeight);
            if (processed) {
                debugLog("cursor", `buildCursorCSS: processed image → hotspot=(${processed.hotspotX},${processed.hotspotY}), dataUrl length=${processed.dataUrl.length}`);
                return `${selector} { cursor: url('${processed.dataUrl}') ${processed.hotspotX} ${processed.hotspotY}, auto${imp}; }`;
            }
        } catch (e) {
            console.warn(`${MODULE_ID} | Failed to process cursor image:`, e);
        }
    }

    // Test if the image actually loads
    try {
        const testImg = await loadImage(state.image);
        debugLog("cursor", `buildCursorCSS: image loaded OK — ${testImg.width}x${testImg.height}px, src="${state.image}"`);
    } catch (e) {
        console.warn(`${MODULE_ID} | Cursor image FAILED to load: "${state.image}"`, e);
        debugLog("cursor", `buildCursorCSS: IMAGE LOAD FAILED for "${state.image}" — cursor will fall back to default`);
    }

    const rule = `${selector} { cursor: url('${state.image}') ${state.hotspotX} ${state.hotspotY}, auto${imp}; }`;
    debugLog("cursor", `buildCursorCSS: generated rule: ${rule}`);
    return rule;
}

export async function applyCursorStyles(isEnabled) {
    debugLog("cursor", `applyCursorStyles called, isEnabled=${isEnabled}`);

    const existingStyle = document.getElementById(STYLE_ID);
    if (existingStyle) {
        debugLog("cursor", "applyCursorStyles: removing existing style element");
        existingStyle.remove();
    }

    if (!isEnabled) {
        console.log(`${MODULE_ID} | Custom cursor disabled.`);
        return;
    }

    const states = game.settings.get(MODULE_ID, "cursor-states");
    debugLog("cursor", "applyCursorStyles: loaded cursor-states from settings:", JSON.stringify(states, null, 2));

    const def = states.default;

    if (!def.image) {
        debugLog("cursor", "applyCursorStyles: default state has no image, aborting");
        return;
    }

    const cssParts = [];
    cssParts.push(await buildCursorCSS("#board", def, true));
    cssParts.push(await buildCursorCSS("body", def, false));

    if (states.hover?.enabled && states.hover.image) {
        debugLog("cursor", "applyCursorStyles: hover state is enabled with image:", states.hover.image);
        cssParts.push(await buildCursorCSS("#board.ttb-cursor-hover, #board.ttb-cursor-hover *, body.ttb-cursor-hover, body.ttb-cursor-hover *", states.hover, true));
    }
    if (states.targeting?.enabled && states.targeting.image) {
        debugLog("cursor", "applyCursorStyles: targeting state is enabled with image:", states.targeting.image);
        cssParts.push(await buildCursorCSS("#board.ttb-cursor-targeting, #board.ttb-cursor-targeting *", states.targeting, true));
    }
    if (states.panning?.enabled && states.panning.image) {
        debugLog("cursor", "applyCursorStyles: panning state is enabled with image:", states.panning.image);
        cssParts.push(await buildCursorCSS("#board.ttb-cursor-panning, #board.ttb-cursor-panning *", states.panning, true));
    }

    const finalCSS = cssParts.join("\n");
    debugLog("cursor", "applyCursorStyles: final CSS:\n", finalCSS);

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = finalCSS;
    document.head.appendChild(style);
    console.log(`${MODULE_ID} | Custom cursor applied.`);
}
