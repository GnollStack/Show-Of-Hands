/**
 * Pure cursor geometry helpers.
 *
 * Cursor resize, rotation, overlay-label placement, and movement easing live
 * here so they can be tested without Foundry or PIXI. Keep the output stable;
 * both the tests and the live cursor rendering rely on these numbers.
 */

import { CURSOR_SIZE_MAX, NAME_POSITION_PRESETS } from './constants.js';

/**
 * Work out the display size after an optional resize. If only width or height
 * is set, preserve the original aspect ratio.
 * @returns {{width:number, height:number}}
 */
export function computeCursorDisplaySize(naturalW, naturalH, targetW = 0, targetH = 0) {
    if (targetW > 0 && targetH > 0) return { width: targetW, height: targetH };
    if (targetW > 0) return { width: targetW, height: Math.round(naturalH * (targetW / naturalW)) };
    if (targetH > 0) return { width: Math.round(naturalW * (targetH / naturalH)), height: targetH };
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
    return {
        width: Math.ceil(displayW * scale),
        height: Math.ceil(displayH * scale),
        hotspotX: Math.max(0, Math.round(hotspotX * scale)),
        hotspotY: Math.max(0, Math.round(hotspotY * scale)),
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
        hotspotX: Math.max(0, Math.round(newHotspotX)),
        hotspotY: Math.max(0, Math.round(newHotspotY)),
        scale,
        rad
    };
}

/**
 * Place the overlay name relative to the cursor hotspot. Positions come from
 * the image center, matching the config preview; presets are nudged outside the
 * sprite edges when custom art is present.
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

    let posX = centerOffX + s * preset.offsetX;
    let posY = centerOffY + s * preset.offsetY;

    if (hasSprite) {
        const gap = s * 0.2;
        // Keep preset labels just outside the sprite when custom art is present.
        if (preset.anchorY === 0) posY = Math.max(posY, spriteHeight * (1 - spriteAnchorY) + gap);
        if (preset.anchorY === 1) posY = Math.min(posY, -spriteHeight * spriteAnchorY - gap);
        if (preset.anchorX === 0) posX = Math.max(posX, spriteWidth * (1 - spriteAnchorX) + gap);
    }

    return { anchorX: preset.anchorX, anchorY: preset.anchorY, posX, posY };
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
