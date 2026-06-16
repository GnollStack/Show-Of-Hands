/**
 * Pure marquee selection helpers.
 *
 * This module holds the geometry and set logic behind middle-mouse marquee
 * targeting, kept free of Foundry/PIXI globals so it can be unit tested in Node
 * (mirroring the `diagnostics-core.js` pattern). `marquee-select.js` consumes
 * these and supplies the live Foundry token objects.
 */

/**
 * Normalize two corner points into a min/max rectangle. Corner order independent.
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {{left:number, top:number, right:number, bottom:number}}
 */
export function normalizeRect(x1, y1, x2, y2) {
    return {
        left: Math.min(x1, x2),
        top: Math.min(y1, y2),
        right: Math.max(x1, x2),
        bottom: Math.max(y1, y2)
    };
}

/**
 * Axis-aligned bounding-box intersection test. Uses strict inequalities, so a
 * token whose edge merely touches the rectangle edge is NOT considered inside.
 * @param {{left:number, top:number, right:number, bottom:number}} rect
 * @param {{left:number, top:number, right:number, bottom:number}} bounds
 * @returns {boolean}
 */
export function rectIntersectsBounds(rect, bounds) {
    return bounds.left < rect.right &&
           bounds.right > rect.left &&
           bounds.top < rect.bottom &&
           bounds.bottom > rect.top;
}

/**
 * Compute how the user's targets should change for a marquee selection.
 *
 * The desired set is the tokens in the box, plus the pre-drag baseline when
 * `additive` (Shift) is held. Returning only the diff vs. the current targets
 * lets the caller toggle just what changed, so an unchanged selection emits no
 * `setTarget` traffic.
 *
 * @param {object} params
 * @param {Iterable<string>} [params.current]  - Ids currently targeted
 * @param {Iterable<string>} [params.inBox]    - Ids inside the selection rectangle
 * @param {Iterable<string>} [params.baseline] - Ids targeted before the drag began
 * @param {boolean} [params.additive]          - Keep the baseline in addition to the box
 * @returns {{desired:Set<string>, toAdd:string[], toRemove:string[]}}
 */
export function computeMarqueeTargetUpdate({ current = [], inBox = [], baseline = [], additive = false } = {}) {
    const desired = new Set(inBox);
    if (additive) {
        for (const id of baseline) desired.add(id);
    }

    const currentSet = new Set(current);
    const toAdd = [];
    for (const id of desired) {
        if (!currentSet.has(id)) toAdd.push(id);
    }
    const toRemove = [];
    for (const id of currentSet) {
        if (!desired.has(id)) toRemove.push(id);
    }

    return { desired, toAdd, toRemove };
}
