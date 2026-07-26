/**
 * Pure cursor geometry helpers.
 *
 * Cursor resize, rotation, overlay-label placement, and movement easing live
 * here so they can be tested without Foundry or PIXI. Keep the output stable;
 * both the tests and the live cursor rendering rely on these numbers.
 */

import { CURSOR_SIZE_MAX, CURSOR_SOURCE_HOTSPOT_MAX, NAME_POSITION_PRESETS } from './constants.js';

/**
 * Return the largest selectable source-pixel coordinate for each image axis.
 * Unknown/loading images retain the profile safety ceiling until dimensions
 * become available; a loaded image uses its actual last pixel.
 */
export function computeCursorSourceHotspotBounds(
    naturalW,
    naturalH,
    max = CURSOR_SOURCE_HOTSPOT_MAX
) {
    const requestedLimit = Math.floor(Number(max));
    const limit = Number.isFinite(requestedLimit) && requestedLimit >= 0
        ? requestedLimit
        : CURSOR_SOURCE_HOTSPOT_MAX;
    const axisMax = dimension => {
        const size = Math.floor(Number(dimension));
        if (!Number.isFinite(size) || size <= 0) return limit;
        return Math.min(limit, Math.max(0, size - 1));
    };
    return { maxX: axisMax(naturalW), maxY: axisMax(naturalH) };
}

/**
 * Work out the display size after an optional resize. If only width or height
 * is set, preserve the original aspect ratio.
 * @returns {{width:number, height:number}}
 */
export function computeCursorDisplaySize(naturalW, naturalH, targetW = 0, targetH = 0) {
    if (targetW > 0 && targetH > 0) return { width: targetW, height: targetH };
    if (targetW > 0) {
        return { width: targetW, height: Math.max(1, Math.round(naturalH * (targetW / naturalW))) };
    }
    if (targetH > 0) {
        return { width: Math.max(1, Math.round(naturalW * (targetH / naturalH))), height: targetH };
    }
    return { width: naturalW, height: naturalH };
}

/**
 * Resize pass: stay under the browser cursor size limit and move the hotspot
 * with the image.
 * @returns {{width:number, height:number, hotspotX:number, hotspotY:number, scale:number}}
 */
export function computeResizeOutput(displayW, displayH, hotspotX, hotspotY, max = CURSOR_SIZE_MAX) {
    const maxDim = Math.max(displayW, displayH);
    const scale = maxDim > max ? max / maxDim : 1;
    const width = Math.ceil(displayW * scale);
    const height = Math.ceil(displayH * scale);
    return {
        width,
        height,
        hotspotX: Math.min(Math.max(0, width - 1), Math.max(0, Math.round(hotspotX * scale))),
        hotspotY: Math.min(Math.max(0, height - 1), Math.max(0, Math.round(hotspotY * scale))),
        scale
    };
}

/**
 * Rotation pass: return the new box, hotspot, scale, and radians needed for
 * rasterizing. The hotspot is rotated before any size-limit scaling.
 * @returns {{width:number, height:number, hotspotX:number, hotspotY:number, scale:number, rad:number}}
 */
export function computeRotationOutput(displayW, displayH, hotspotX, hotspotY, degrees, max = CURSOR_SIZE_MAX) {
    const rad = (degrees * Math.PI) / 180;
    const snapTrig = value => {
        if (Math.abs(value) < 1e-12) return 0;
        if (Math.abs(Math.abs(value) - 1) < 1e-12) return Math.sign(value);
        return value;
    };
    const cos = snapTrig(Math.cos(rad));
    const sin = snapTrig(Math.sin(rad));

    let newW = Math.ceil(Math.abs(displayW * cos) + Math.abs(displayH * sin));
    let newH = Math.ceil(Math.abs(displayW * sin) + Math.abs(displayH * cos));

    const cx = displayW / 2;
    const cy = displayH / 2;
    const dx = hotspotX - cx;
    const dy = hotspotY - cy;
    let newHotspotX = newW / 2 + dx * cos - dy * sin;
    let newHotspotY = newH / 2 + dx * sin + dy * cos;

    const maxDim = Math.max(newW, newH);
    const scale = maxDim > max ? max / maxDim : 1;

    if (scale < 1) {
        newHotspotX *= scale;
        newHotspotY *= scale;
        newW = Math.ceil(newW * scale);
        newH = Math.ceil(newH * scale);
    }

    return {
        width: newW,
        height: newH,
        hotspotX: Math.min(Math.max(0, newW - 1), Math.max(0, Math.round(newHotspotX))),
        hotspotY: Math.min(Math.max(0, newH - 1), Math.max(0, Math.round(newHotspotY))),
        scale,
        rad
    };
}

/**
 * Build the resize/rotation geometry from source-image coordinates. Stored
 * hotspots are measured on the natural image, so resize them independently on
 * each axis before applying rotation or the browser cursor size cap.
 *
 * @returns {{displayWidth:number, displayHeight:number, width:number, height:number, hotspotX:number, hotspotY:number, scale:number, rad?:number}}
 */
export function computeCursorProcessingGeometry(
    naturalW,
    naturalH,
    targetW,
    targetH,
    hotspotX,
    hotspotY,
    degrees = 0,
    max = CURSOR_SIZE_MAX
) {
    const { width: displayWidth, height: displayHeight } = computeCursorDisplaySize(
        naturalW,
        naturalH,
        targetW,
        targetH
    );
    const displayHotspotX = hotspotX * (naturalW > 0 ? displayWidth / naturalW : 1);
    const displayHotspotY = hotspotY * (naturalH > 0 ? displayHeight / naturalH : 1);
    const output = degrees
        ? computeRotationOutput(displayWidth, displayHeight, displayHotspotX, displayHotspotY, degrees, max)
        : computeResizeOutput(displayWidth, displayHeight, displayHotspotX, displayHotspotY, max);

    return { displayWidth, displayHeight, ...output };
}

/**
 * Lay out the configuration preview exactly like the processed cursor raster:
 * an unrotated image centered inside its final rotated/capped output box, with
 * the hotspot expressed in that output box.
 */
export function computeCursorPreviewGeometry(
    naturalW,
    naturalH,
    targetW,
    targetH,
    hotspotX,
    hotspotY,
    degrees = 0,
    max = CURSOR_SIZE_MAX
) {
    const output = computeCursorProcessingGeometry(
        naturalW,
        naturalH,
        targetW,
        targetH,
        hotspotX,
        hotspotY,
        degrees,
        max
    );
    const imageWidth = degrees ? output.displayWidth * output.scale : output.width;
    const imageHeight = degrees ? output.displayHeight * output.scale : output.height;
    return {
        ...output,
        imageWidth,
        imageHeight,
        imageLeft: (output.width - imageWidth) / 2,
        imageTop: (output.height - imageHeight) / 2
    };
}

/**
 * Place the overlay name relative to the cursor hotspot. Positions come from
 * the image center, matching the config preview exactly.
 *
 * @returns {{anchorX:number, anchorY:number, posX:number, posY:number}|null}
 *          null means the caller should leave the current label placement alone.
 */
export function computeOverlayNamePlacement({
    namePosition,
    nameOffset = { x: 0, y: 0 },
    scale,
    hasSprite = false,
    spriteWidth = 0,
    spriteHeight = 0,
    spriteAnchorX = 0,
    spriteAnchorY = 0,
    presets = NAME_POSITION_PRESETS
} = {}) {
    const s = scale;

    // The overlay container is anchored at the hotspot; shift to image center
    // to match the config preview.
    let centerOffX = 0, centerOffY = 0;
    if (hasSprite) {
        centerOffX = spriteWidth * (0.5 - spriteAnchorX);
        centerOffY = spriteHeight * (0.5 - spriteAnchorY);
    }

    if (namePosition === "custom") {
        return {
            anchorX: 0.5,
            anchorY: 0,
            posX: centerOffX + s * nameOffset.x,
            posY: centerOffY + s * nameOffset.y
        };
    }

    const preset = presets[namePosition];
    if (!preset) return null;

    return {
        anchorX: preset.anchorX,
        anchorY: preset.anchorY,
        posX: centerOffX + s * preset.offsetX,
        posY: centerOffY + s * preset.offsetY
    };
}

/**
 * Move one step toward a target. Snap when close enough; otherwise use the same
 * gentle dx/10 style easing Foundry uses.
 * @returns {{x:number, y:number}}
 */
export function stepCursorLerp(currentX, currentY, targetX, targetY, snapThreshold, speed) {
    const dx = targetX - currentX;
    const dy = targetY - currentY;
    if (Math.abs(dx) + Math.abs(dy) < snapThreshold) {
        return { x: targetX, y: targetY };
    }
    return { x: currentX + dx * speed, y: currentY + dy * speed };
}
