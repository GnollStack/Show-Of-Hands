import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CURSOR_SIZE_MAX } from '../scripts/constants.js';
import {
    computeCursorDisplaySize,
    computeResizeOutput,
    computeRotationOutput,
    computeOverlayNamePlacement,
    stepCursorLerp
} from '../scripts/cursor-geometry-core.js';

function closeTo(actual, expected, eps = 1e-9) {
    assert.ok(Math.abs(actual - expected) < eps, `expected ${actual} ≈ ${expected}`);
}

// --- computeCursorDisplaySize ---

test('computeCursorDisplaySize returns natural size when no target given', () => {
    assert.deepEqual(computeCursorDisplaySize(100, 50, 0, 0), { width: 100, height: 50 });
});

test('computeCursorDisplaySize honors both explicit dimensions', () => {
    assert.deepEqual(computeCursorDisplaySize(100, 50, 40, 30), { width: 40, height: 30 });
});

test('computeCursorDisplaySize preserves aspect when one dimension given', () => {
    assert.deepEqual(computeCursorDisplaySize(100, 50, 40, 0), { width: 40, height: 20 });
    assert.deepEqual(computeCursorDisplaySize(100, 50, 0, 25), { width: 50, height: 25 });
});

// --- computeResizeOutput ---

test('computeResizeOutput keeps size when within the max', () => {
    const out = computeResizeOutput(50, 50, 10, 10, CURSOR_SIZE_MAX);
    assert.deepEqual(out, { width: 50, height: 50, hotspotX: 10, hotspotY: 10, scale: 1 });
});

test('computeResizeOutput scales oversized images down and scales the hotspot', () => {
    const out = computeResizeOutput(256, 128, 128, 64, CURSOR_SIZE_MAX);
    assert.equal(out.scale, 0.5);
    assert.equal(out.width, 128);
    assert.equal(out.height, 64);
    assert.equal(out.hotspotX, 64);
    assert.equal(out.hotspotY, 32);
    assert.ok(Math.max(out.width, out.height) <= CURSOR_SIZE_MAX);
});

// --- computeRotationOutput ---

test('computeRotationOutput at 0 degrees is an identity for dims and hotspot', () => {
    const out = computeRotationOutput(100, 100, 10, 20, 0, CURSOR_SIZE_MAX);
    assert.deepEqual(out, { width: 100, height: 100, hotspotX: 10, hotspotY: 20, scale: 1, rad: 0 });
});

test('computeRotationOutput at 90 degrees keeps a square within one pixel', () => {
    const out = computeRotationOutput(100, 100, 10, 20, 90, CURSOR_SIZE_MAX);
    assert.ok(out.width >= 100 && out.width <= 101);
    assert.ok(out.height >= 100 && out.height <= 101);
    assert.equal(out.scale, 1);
    closeTo(out.rad, Math.PI / 2);
    assert.ok(out.hotspotX >= 0 && out.hotspotX <= out.width);
    assert.ok(out.hotspotY >= 0 && out.hotspotY <= out.height);
});

test('computeRotationOutput at 45 degrees grows the bounding box', () => {
    const out = computeRotationOutput(50, 50, 0, 0, 45, CURSOR_SIZE_MAX);
    assert.ok(out.width > 50, 'rotated box should be larger than the source');
    assert.equal(out.scale, 1);
});

test('computeRotationOutput scales an oversized rotated box down to the max', () => {
    const out = computeRotationOutput(100, 100, 0, 0, 45, CURSOR_SIZE_MAX);
    assert.ok(out.scale < 1, 'oversized rotation should scale down');
    assert.ok(out.width <= CURSOR_SIZE_MAX);
    assert.ok(out.height <= CURSOR_SIZE_MAX);
});

// --- computeOverlayNamePlacement ---

test('computeOverlayNamePlacement custom uses image-center offset', () => {
    const out = computeOverlayNamePlacement({
        namePosition: 'custom',
        nameOffset: { x: 2, y: 3 },
        scale: 16,
        hasSprite: false
    });
    assert.equal(out.anchorX, 0.5);
    assert.equal(out.anchorY, 0);
    closeTo(out.posX, 32);
    closeTo(out.posY, 48);
});

test('computeOverlayNamePlacement applies preset offsets without a sprite', () => {
    const bottom = computeOverlayNamePlacement({ namePosition: 'bottom-center', scale: 16, hasSprite: false });
    assert.equal(bottom.anchorX, 0.5);
    assert.equal(bottom.anchorY, 0);
    closeTo(bottom.posX, 0);
    closeTo(bottom.posY, 19.2);

    const top = computeOverlayNamePlacement({ namePosition: 'top-center', scale: 16, hasSprite: false });
    assert.equal(top.anchorY, 1);
    closeTo(top.posY, -4.8);
});

test('computeOverlayNamePlacement clamps bottom labels past the sprite edge', () => {
    const out = computeOverlayNamePlacement({
        namePosition: 'bottom-center',
        scale: 16,
        hasSprite: true,
        spriteWidth: 64,
        spriteHeight: 64,
        spriteAnchorX: 0.5,
        spriteAnchorY: 0.5
    });
    // base posY (19.2) is pushed to sh*(1-anchorY)+gap = 32 + 3.2
    closeTo(out.posY, 35.2);
    closeTo(out.posX, 0);
});

test('computeOverlayNamePlacement clamps left-anchored labels past the right edge', () => {
    const out = computeOverlayNamePlacement({
        namePosition: 'right',
        scale: 16,
        hasSprite: true,
        spriteWidth: 64,
        spriteHeight: 64,
        spriteAnchorX: 0.5,
        spriteAnchorY: 0.5
    });
    assert.equal(out.anchorX, 0);
    assert.equal(out.anchorY, 0.5);
    closeTo(out.posX, 35.2); // max(16, 32 + 3.2)
    closeTo(out.posY, 4.8);
});

test('computeOverlayNamePlacement returns null for an unknown preset', () => {
    const out = computeOverlayNamePlacement({ namePosition: 'nope', scale: 16, hasSprite: false });
    assert.equal(out, null);
});

// --- stepCursorLerp ---

test('stepCursorLerp snaps to target within the threshold', () => {
    assert.deepEqual(stepCursorLerp(0, 0, 0.1, 0.1, 0.5, 0.1), { x: 0.1, y: 0.1 });
});

test('stepCursorLerp moves a speed fraction beyond the threshold', () => {
    assert.deepEqual(stepCursorLerp(0, 0, 10, 0, 0.5, 0.1), { x: 1, y: 0 });
});
