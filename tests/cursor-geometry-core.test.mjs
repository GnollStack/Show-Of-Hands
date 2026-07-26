import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CURSOR_SIZE_MAX, CURSOR_SOURCE_HOTSPOT_MAX } from '../scripts/constants.js';
import {
    computeCursorDisplaySize,
    computeCursorProcessingGeometry,
    computeCursorPreviewGeometry,
    computeCursorSourceHotspotBounds,
    computeResizeOutput,
    computeRotationOutput,
    computeOverlayNamePlacement,
    stepCursorLerp
} from '../scripts/cursor-geometry-core.js';

function closeTo(actual, expected, eps = 1e-9) {
    assert.ok(Math.abs(actual - expected) < eps, `expected ${actual} ≈ ${expected}`);
}

// --- computeCursorDisplaySize ---

test('source hotspot bounds follow the loaded image instead of the 128px output cap', () => {
    assert.deepEqual(computeCursorSourceHotspotBounds(512, 300), { maxX: 511, maxY: 299 });
    assert.deepEqual(computeCursorSourceHotspotBounds(1, 1), { maxX: 0, maxY: 0 });
    assert.deepEqual(computeCursorSourceHotspotBounds(0, 0), {
        maxX: CURSOR_SOURCE_HOTSPOT_MAX,
        maxY: CURSOR_SOURCE_HOTSPOT_MAX
    });
    assert.deepEqual(computeCursorSourceHotspotBounds(100_000, 100_000), {
        maxX: CURSOR_SOURCE_HOTSPOT_MAX,
        maxY: CURSOR_SOURCE_HOTSPOT_MAX
    });
});

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

test('computeCursorDisplaySize never rounds an extreme aspect ratio to zero', () => {
    assert.deepEqual(computeCursorDisplaySize(1, 128, 0, 1), { width: 1, height: 1 });
    assert.deepEqual(computeCursorDisplaySize(128, 1, 1, 0), { width: 1, height: 1 });
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

test('computeRotationOutput at 90 degrees keeps an exact square', () => {
    const out = computeRotationOutput(100, 100, 10, 20, 90, CURSOR_SIZE_MAX);
    assert.equal(out.width, 100);
    assert.equal(out.height, 100);
    assert.equal(out.scale, 1);
    closeTo(out.rad, Math.PI / 2);
    assert.ok(out.hotspotX >= 0 && out.hotspotX < out.width);
    assert.ok(out.hotspotY >= 0 && out.hotspotY < out.height);
});

test('quarter- and half-turn rotation bounds do not grow from trig epsilon', () => {
    const quarter = computeRotationOutput(128, 64, 0, 0, 90, CURSOR_SIZE_MAX);
    assert.equal(quarter.width, 64);
    assert.equal(quarter.height, 128);
    assert.equal(quarter.scale, 1);

    const half = computeRotationOutput(128, 64, 0, 0, 180, CURSOR_SIZE_MAX);
    assert.equal(half.width, 128);
    assert.equal(half.height, 64);
    assert.equal(half.scale, 1);
});

test('cursor hotspots are clamped inside the output raster', () => {
    const resized = computeResizeOutput(16, 8, 128, 128, CURSOR_SIZE_MAX);
    assert.deepEqual(resized, { width: 16, height: 8, hotspotX: 15, hotspotY: 7, scale: 1 });

    const rotated = computeRotationOutput(16, 8, 128, 128, 90, CURSOR_SIZE_MAX);
    assert.ok(rotated.hotspotX >= 0 && rotated.hotspotX < rotated.width);
    assert.ok(rotated.hotspotY >= 0 && rotated.hotspotY < rotated.height);
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

// --- computeCursorProcessingGeometry ---

test('computeCursorProcessingGeometry scales a stored hotspot with a configured resize', () => {
    const out = computeCursorProcessingGeometry(100, 50, 40, 20, 10, 5, 0, CURSOR_SIZE_MAX);

    assert.equal(out.displayWidth, 40);
    assert.equal(out.displayHeight, 20);
    assert.equal(out.width, 40);
    assert.equal(out.height, 20);
    assert.equal(out.hotspotX, 4);
    assert.equal(out.hotspotY, 2);
});

test('a hotspot at the far edge of a large source reaches the far edge after the 128px cap', () => {
    const out = computeCursorProcessingGeometry(512, 256, 0, 0, 511, 255, 0, CURSOR_SIZE_MAX);

    assert.equal(out.width, 128);
    assert.equal(out.height, 64);
    assert.equal(out.hotspotX, 127);
    assert.equal(out.hotspotY, 63);
});

test('computeCursorProcessingGeometry rotates the hotspot after configured resize scaling', () => {
    const out = computeCursorProcessingGeometry(100, 50, 40, 20, 10, 5, 90, CURSOR_SIZE_MAX);

    assert.equal(out.displayWidth, 40);
    assert.equal(out.displayHeight, 20);
    assert.equal(out.hotspotX, 18);
    assert.equal(out.hotspotY, 4);
    closeTo(out.rad, Math.PI / 2);
});

test('computeCursorPreviewGeometry matches the resized and rotated runtime raster', () => {
    const out = computeCursorPreviewGeometry(100, 50, 40, 20, 10, 5, 90, CURSOR_SIZE_MAX);

    assert.equal(out.width, 20);
    assert.equal(out.height, 40);
    assert.equal(out.hotspotX, 18);
    assert.equal(out.hotspotY, 4);
    assert.equal(out.imageWidth, 40);
    assert.equal(out.imageHeight, 20);
    assert.equal(out.imageLeft, -10);
    assert.equal(out.imageTop, 10);
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

test('computeOverlayNamePlacement keeps bottom preset at the saved center-relative offset', () => {
    const out = computeOverlayNamePlacement({
        namePosition: 'bottom-center',
        scale: 16,
        hasSprite: true,
        spriteWidth: 64,
        spriteHeight: 64,
        spriteAnchorX: 0.5,
        spriteAnchorY: 0.5
    });
    closeTo(out.posY, 19.2);
    closeTo(out.posX, 0);
});

test('computeOverlayNamePlacement keeps right preset at the saved center-relative offset', () => {
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
    closeTo(out.posX, 16);
    closeTo(out.posY, 4.8);
});

test('computeOverlayNamePlacement does not push a preset across transparent sprite padding', () => {
    const out = computeOverlayNamePlacement({
        namePosition: 'bottom-center',
        scale: 16,
        hasSprite: true,
        spriteWidth: 128,
        spriteHeight: 128,
        spriteAnchorX: 0.1,
        spriteAnchorY: 0.1
    });

    closeTo(out.posX, 51.2);
    closeTo(out.posY, 70.4);
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
