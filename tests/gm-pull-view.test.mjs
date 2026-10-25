import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureGmView, clampCanvasZoom, computeFitZoom, resolveGmPullZoom } from '../scripts/gm-pull-view.js';
import { SETTING_DEFINITIONS, getSettingDefault } from '../scripts/settings.js';

function makeCanvas(width = 1920, height = 1080, zoom = 1.25) {
    return {
        ready: true, stage: { scale: { x: zoom } },
        app: { renderer: { screen: { width, height }, width: width * 2, height: height * 2, resolution: 2 } },
        dimensions: { scale: { min: 0.02, max: 12 } }
    };
}

test('GM pull setting is world controlled and defaults to fitting the GM view', () => {
    const definition = SETTING_DEFINITIONS.find(d => d.key === 'gm-pull-view-mode');
    assert.equal(definition.scope, 'world');
    assert.equal(definition.restricted, true);
    assert.equal(getSettingDefault(definition), 'fit');
    assert.deepEqual(Object.keys(definition.choices), ['keep', 'native', 'fit']);
});

test('fit captures CSS viewport area and covers it on different screen shapes', () => {
    const gm = makeCanvas();
    const view = captureGmView(gm);
    assert.deepEqual(view, { width: 1536, height: 864 });
    for (const [width, height, expected] of [
        [1920, 1080, 1.25], [1440, 900, 0.9375], [1280, 1024, 5 / 6],
        [2560, 1080, 1.25], [1080, 1920, 0.703125]
    ]) {
        const player = makeCanvas(width, height, 2);
        const zoom = resolveGmPullZoom('fit', view, player);
        assert.ok(Math.abs(zoom - expected) < 1e-9);
        assert.ok(width / zoom >= view.width - 1e-9);
        assert.ok(height / zoom >= view.height - 1e-9);
        assert.equal(resolveGmPullZoom('keep', view, player), 2);
        player.app.renderer.resolution = 1;
        assert.equal(resolveGmPullZoom('fit', view, player), zoom, 'pixel density cannot change the view');
    }
    delete gm.app.renderer.screen;
    gm.screenDimensions = [1920, 1080];
    assert.deepEqual(captureGmView(gm), view);
});

test('zoom uses actual dynamic limits, and invalid input retains current zoom', () => {
    const canvas = makeCanvas();
    for (const zoom of [0.05, 0.5, 4, 6]) assert.equal(clampCanvasZoom(zoom, canvas, { maxZoom: 3 }), zoom);
    assert.equal(clampCanvasZoom(100, canvas), 12);
    assert.equal(clampCanvasZoom(0.001, canvas), 0.02);
    for (const zoom of [undefined, null, 0, -1, NaN, Infinity, '4']) {
        assert.equal(clampCanvasZoom(zoom, canvas), 1.25);
    }
    assert.equal(resolveGmPullZoom('fit', { width: 1, height: 1 }, canvas), 12);
    assert.equal(resolveGmPullZoom('fit', { width: 1e9, height: 1e9 }, canvas), 0.02);
});

test('missing canvases and invalid or overflowing dimensions fail without a pull', () => {
    assert.equal(captureGmView({ ready: false }), null);
    assert.equal(captureGmView({ ready: true }), null);
    for (const width of [0, -1, NaN, Infinity, '100', Number.MIN_VALUE]) {
        assert.equal(computeFitZoom({ width, height: width }, { width: 1920, height: 1080 }), null);
    }
    assert.equal(resolveGmPullZoom('native', {}, makeCanvas()), null);
    assert.equal(resolveGmPullZoom('fit', {}, makeCanvas()), null);
    assert.equal(resolveGmPullZoom('keep', null, { ready: false }), null);
});
