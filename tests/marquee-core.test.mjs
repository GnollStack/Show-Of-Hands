import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    normalizeRect,
    rectIntersectsBounds,
    computeMarqueeTargetUpdate
} from '../scripts/marquee-core.js';

function boundsOf(left, top, right, bottom) {
    return { left, top, right, bottom };
}

test('normalizeRect is corner-order independent', () => {
    const expected = { left: 10, top: 20, right: 30, bottom: 40 };
    assert.deepEqual(normalizeRect(10, 20, 30, 40), expected);
    assert.deepEqual(normalizeRect(30, 40, 10, 20), expected);
    assert.deepEqual(normalizeRect(30, 20, 10, 40), expected);
});

test('rectIntersectsBounds detects overlap and containment', () => {
    const rect = normalizeRect(0, 0, 100, 100);
    // Partial overlap
    assert.equal(rectIntersectsBounds(rect, boundsOf(50, 50, 150, 150)), true);
    // Fully contained
    assert.equal(rectIntersectsBounds(rect, boundsOf(10, 10, 20, 20)), true);
    // Rect fully inside token bounds
    assert.equal(rectIntersectsBounds(rect, boundsOf(-50, -50, 200, 200)), true);
});

test('rectIntersectsBounds rejects separated boxes', () => {
    const rect = normalizeRect(0, 0, 100, 100);
    assert.equal(rectIntersectsBounds(rect, boundsOf(200, 0, 300, 100)), false);
    assert.equal(rectIntersectsBounds(rect, boundsOf(0, 200, 100, 300)), false);
});

test('rectIntersectsBounds treats edge-only contact as no overlap (strict)', () => {
    const rect = normalizeRect(0, 0, 100, 100);
    // Right edge of rect touches left edge of bounds — strict < means no select
    assert.equal(rectIntersectsBounds(rect, boundsOf(100, 0, 200, 100)), false);
    // Bottom edge touches top edge
    assert.equal(rectIntersectsBounds(rect, boundsOf(0, 100, 100, 200)), false);
});

test('computeMarqueeTargetUpdate replace mode drops the baseline', () => {
    const { desired, toAdd, toRemove } = computeMarqueeTargetUpdate({
        current: ['a', 'b'],
        inBox: ['b', 'c'],
        baseline: ['a', 'b'],
        additive: false
    });
    assert.deepEqual([...desired].sort(), ['b', 'c']);
    assert.deepEqual(toAdd.sort(), ['c']);       // c newly targeted
    assert.deepEqual(toRemove.sort(), ['a']);    // a (baseline, not in box) cleared
});

test('computeMarqueeTargetUpdate additive mode keeps the baseline', () => {
    const { desired, toAdd, toRemove } = computeMarqueeTargetUpdate({
        current: ['a'],
        inBox: ['c'],
        baseline: ['a', 'b'],
        additive: true
    });
    assert.deepEqual([...desired].sort(), ['a', 'b', 'c']);
    assert.deepEqual(toAdd.sort(), ['b', 'c']);  // b (baseline) + c (box) added
    assert.deepEqual(toRemove, []);              // nothing removed
});

test('computeMarqueeTargetUpdate emits no diff when selection is unchanged', () => {
    const { toAdd, toRemove } = computeMarqueeTargetUpdate({
        current: ['a', 'b'],
        inBox: ['a', 'b'],
        baseline: ['a', 'b'],
        additive: false
    });
    assert.deepEqual(toAdd, []);
    assert.deepEqual(toRemove, []);
});

test('computeMarqueeTargetUpdate clears everything for an empty replace selection', () => {
    const { desired, toAdd, toRemove } = computeMarqueeTargetUpdate({
        current: ['a', 'b'],
        inBox: [],
        baseline: ['a', 'b'],
        additive: false
    });
    assert.equal(desired.size, 0);
    assert.deepEqual(toAdd, []);
    assert.deepEqual(toRemove.sort(), ['a', 'b']);
});

test('computeMarqueeTargetUpdate defaults to an empty replace update', () => {
    const { desired, toAdd, toRemove } = computeMarqueeTargetUpdate();
    assert.equal(desired.size, 0);
    assert.deepEqual(toAdd, []);
    assert.deepEqual(toRemove, []);
});
