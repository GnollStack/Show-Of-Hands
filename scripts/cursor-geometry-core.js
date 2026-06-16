/**
 * Pure cursor geometry helpers.
 *
 * The math behind cursor image resize/rotation (consumed by `cursor-styles.js`)
 * and shared-overlay name placement / movement interpolation (consumed by
 * `cursor-overlay.js`), kept free of canvas/PIXI globals so it can be unit
 * tested in Node (mirroring the `diagnostics-core.js` pattern). Numeric output
 * must stay identical to the previous inline implementations.
 */

import { CURSOR_SIZE_MAX, NAME_POSITION_PRESETS } from './constants.js';

/**
 * Resolve the on-screen display size after an optional resize. When only one of
 * width/height is given, the other is derived to preserve aspect ratio.
 * @returns {{width:number, height:number}}
 */
export function computeCursorDisplaySize(naturalW, naturalH, targetW = 0, targetH = 0) {
    if (targetW > 0 && targetH > 0) return { width: targetW, height: targetH };
    if (targetW > 0) return { width: targetW, height: Math.round(naturalH * (targetW / naturalW)) };
    if (targetH > 0) return { width: Math.round(naturalW * (targetH / naturalH)), height: targetH };
    return { width: naturalW, height: naturalH };
}

/**
 * Resize-only output: scale down to the browser-safe max dimension and scale the
 * hotspot to match.
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
 * Rotation output: the rotated bounding-box size, the rotated hotspot, and the
 * scale/radians the caller needs to rasterize. Hotspot is computed against the
 * pre-scale box, then scaled down with everything else if the box exceeds `max`.
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
 * Compute the overlay name label's anchor and position relative to the cursor
 * container origin (the hotspot). Positions are derived from the image center so
 * they match the config preview; for presets the label is pushed clear of the
 * image edges so it never overlaps the cursor sprite.
 *
 * @returns {{anchorX:number, anchorY:number, posX:number, posY:number}|null}
 *          null when `namePosition` is an unknown preset (caller leaves the label as-is).
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

    // The container origin (0,0) is the hotspot; offset to the image center so
    // positions match the config preview (which is image-center relative).
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
        // Push past bottom edge for bottom-anchored labels (anchorY 0 = text top at pos)
        if (preset.anchorY === 0) posY = Math.max(posY, spriteHeight * (1 - spriteAnchorY) + gap);
        // Push above top edge for top-anchored labels (anchorY 1 = text bottom at pos)
        if (preset.anchorY === 1) posY = Math.min(posY, -spriteHeight * spriteAnchorY - gap);
        // Push past right edge for left-anchored labels (anchorX 0 = text left at pos)
        if (preset.anchorX === 0) posX = Math.max(posX, spriteWidth * (1 - spriteAnchorX) + gap);
    }

    return { anchorX: preset.anchorX, anchorY: preset.anchorY, posX, posY };
}

/**
 * One interpolation step toward a target position. Snaps to the target when the
 * remaining Manhattan distance is below `snapThreshold`, otherwise moves a
 * `speed` fraction of the way (matching Foundry's native dx/10 approach).
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
