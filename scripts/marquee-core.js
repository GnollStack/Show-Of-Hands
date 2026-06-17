/**
 * Pure marquee selection helpers.
 *
 * Kept free of Foundry and PIXI globals so the targeting math can be tested in
 * Node. The live Foundry token objects are supplied by `marquee-select.js`.
 */

/**
 * Build a min/max rectangle from any two corners.
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
 * Axis-aligned bounds check. Edges have to overlap; simply touching an edge
 * does not count.
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
 * Work out the target diff for a marquee drag.
 *
 * The desired set is everything in the box, plus the pre-drag targets when
 * Shift is held. Returning only the diff keeps live-preview updates quiet when
 * nothing changed.
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
