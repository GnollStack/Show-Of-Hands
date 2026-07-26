import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SOCKET_MESSAGE_TYPES } from '../scripts/constants.js';
import { computeOverlayNamePlacement } from '../scripts/cursor-geometry-core.js';
import {
    CURSOR_NAME_POSITION_VALUES,
    MAX_CURSOR_NAME_OFFSET,
    MAX_CURSOR_IMAGE_DATA_URL_LENGTH,
    MAX_CURSOR_IMAGE_DIMENSION,
    MAX_SOCKET_WORLD_COORDINATE,
    authenticateSocketSender,
    getCursorImageDataUrlDimensions,
    isSocketMessageForCurrentView,
    isValidCursorImageDimensions,
    sanitizeHiddenPing,
    validateSocketMessage
} from '../scripts/socket-messages.js';

const USER_ID = 'user-1';

function makeImageHeaderDataUrl(mime, width = 1, height = 1) {
    let bytes;
    if (mime === 'png') {
        bytes = Buffer.alloc(24);
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(bytes, 0);
        Buffer.from('IHDR').copy(bytes, 12);
        bytes.writeUInt32BE(width, 16);
        bytes.writeUInt32BE(height, 20);
    } else if (mime === 'gif') {
        bytes = Buffer.alloc(10);
        Buffer.from('GIF89a').copy(bytes, 0);
        bytes.writeUInt16LE(width, 6);
        bytes.writeUInt16LE(height, 8);
    } else if (mime === 'jpeg') {
        bytes = Buffer.alloc(21);
        Buffer.from([0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08]).copy(bytes, 0);
        bytes.writeUInt16BE(height, 7);
        bytes.writeUInt16BE(width, 9);
    } else if (mime === 'webp') {
        bytes = Buffer.alloc(30);
        Buffer.from('RIFF').copy(bytes, 0);
        Buffer.from('WEBP').copy(bytes, 8);
        Buffer.from('VP8X').copy(bytes, 12);
        bytes.writeUIntLE(width - 1, 24, 3);
        bytes.writeUIntLE(height - 1, 27, 3);
    } else {
        throw new Error(`Unsupported test MIME: ${mime}`);
    }
    return `data:image/${mime};base64,${bytes.toString('base64')}`;
}

function assertValid(message) {
    const result = validateSocketMessage(message);
    assert.equal(result.valid, true, result.error);
    assert.equal(result.type, message.type);
    return result;
}

function assertInvalid(message, expectedErrorPart) {
    const result = validateSocketMessage(message);
    assert.equal(result.valid, false);
    assert.match(result.error, expectedErrorPart);
}

test('valid socket messages pass validation', () => {
    assertValid({
        type: SOCKET_MESSAGE_TYPES.CURSOR_MOVE,
        userId: USER_ID,
        sceneId: 'scene-1',
        levelId: 'balcony',
        x: 10,
        y: 20
    });

    assertValid({
        type: SOCKET_MESSAGE_TYPES.CURSOR_IMAGE,
        userId: USER_ID,
        imageDataUrl: makeImageHeaderDataUrl('png'),
        hotspotX: 1,
        hotspotY: 2,
        playerName: 'Beastie',
        namePosition: 'bottom-center',
        nameOffset: { x: 0, y: 1.2 }
    });

    assertValid({
        type: SOCKET_MESSAGE_TYPES.CURSOR_HIDDEN,
        userId: USER_ID
    });

    assertValid({
        type: SOCKET_MESSAGE_TYPES.HIDDEN_PING,
        userId: USER_ID,
        sceneId: null,
        levelId: null,
        position: { x: 10, y: 20 },
        ping: { pull: true }
    });

    assertValid({
        type: SOCKET_MESSAGE_TYPES.REQUEST_CURSOR_IMAGE,
        userId: USER_ID,
        targetUserId: null
    });
});

test('basic socket message shape failures are rejected', () => {
    assertInvalid(null, /object/);
    assertInvalid({ type: 'unknown', userId: USER_ID }, /Unknown/);
    assertInvalid({ type: SOCKET_MESSAGE_TYPES.CURSOR_HIDDEN }, /userId/);
});

test('cursorMove requires finite coordinates', () => {
    assertInvalid({
        type: SOCKET_MESSAGE_TYPES.CURSOR_MOVE,
        userId: USER_ID,
        sceneId: 'scene-1',
        x: Number.NaN,
        y: 20
    }, /finite x and y/);

    assertInvalid({
        type: SOCKET_MESSAGE_TYPES.CURSOR_MOVE,
        userId: USER_ID,
        sceneId: 'scene-1',
        levelId: 42,
        x: 10,
        y: 20
    }, /levelId/);

    assertInvalid({
        type: SOCKET_MESSAGE_TYPES.CURSOR_MOVE,
        userId: USER_ID,
        sceneId: 'scene-1',
        x: 10,
        y: Infinity
    }, /finite x and y/);
});

test('socket world coordinates are clamped without mutating the raw payload', () => {
    const move = {
        type: SOCKET_MESSAGE_TYPES.CURSOR_MOVE,
        userId: USER_ID,
        sceneId: 'scene-1',
        levelId: null,
        x: Number.MAX_VALUE,
        y: -Number.MAX_VALUE
    };
    const moveResult = assertValid(move);
    assert.equal(move.x, Number.MAX_VALUE);
    assert.equal(move.y, -Number.MAX_VALUE);
    assert.equal(moveResult.data.x, MAX_SOCKET_WORLD_COORDINATE);
    assert.equal(moveResult.data.y, -MAX_SOCKET_WORLD_COORDINATE);

    const hiddenPingResult = assertValid({
        type: SOCKET_MESSAGE_TYPES.HIDDEN_PING,
        userId: USER_ID,
        sceneId: 'scene-1',
        levelId: null,
        position: { x: -Number.MAX_VALUE, y: Number.MAX_VALUE }
    });
    assert.deepEqual(hiddenPingResult.data.position, {
        x: -MAX_SOCKET_WORLD_COORDINATE,
        y: MAX_SOCKET_WORLD_COORDINATE
    });
});

test('cursorImage accepts null clear and supported image data URLs', () => {
    assertValid({
        type: SOCKET_MESSAGE_TYPES.CURSOR_IMAGE,
        userId: USER_ID,
        imageDataUrl: null,
        hotspotX: 0,
        hotspotY: 0
    });

    for (const mime of ['png', 'webp', 'jpeg', 'gif']) {
        assertValid({
            type: SOCKET_MESSAGE_TYPES.CURSOR_IMAGE,
            userId: USER_ID,
            imageDataUrl: makeImageHeaderDataUrl(mime),
            hotspotX: 0,
            hotspotY: 0
        });
    }
});

test('cursorImage rejects unsupported or oversized image data', () => {
    assertInvalid({
        type: SOCKET_MESSAGE_TYPES.CURSOR_IMAGE,
        userId: USER_ID,
        imageDataUrl: 'data:text/html;base64,AAAA',
        hotspotX: 0,
        hotspotY: 0
    }, /supported image data URL/);

    assertInvalid({
        type: SOCKET_MESSAGE_TYPES.CURSOR_IMAGE,
        userId: USER_ID,
        imageDataUrl: 'javascript:alert(1)',
        hotspotX: 0,
        hotspotY: 0
    }, /supported image data URL/);

    assertInvalid({
        type: SOCKET_MESSAGE_TYPES.CURSOR_IMAGE,
        userId: USER_ID,
        imageDataUrl: 'data:image/png;base64,AAAA',
        hotspotX: 0,
        hotspotY: 0
    }, /image header/);

    const oversized = `data:image/png;base64,${'A'.repeat(MAX_CURSOR_IMAGE_DATA_URL_LENGTH)}`;
    assertInvalid({
        type: SOCKET_MESSAGE_TYPES.CURSOR_IMAGE,
        userId: USER_ID,
        imageDataUrl: oversized,
        hotspotX: 0,
        hotspotY: 0
    }, /too large/);

    const oversizedPngHeader = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(oversizedPngHeader, 0);
    Buffer.from('IHDR').copy(oversizedPngHeader, 12);
    oversizedPngHeader.writeUInt32BE(4096, 16);
    oversizedPngHeader.writeUInt32BE(2048, 20);
    const oversizedPng = `data:image/png;base64,${oversizedPngHeader.toString('base64')}`;
    assert.deepEqual(getCursorImageDataUrlDimensions(oversizedPng), { width: 4096, height: 2048 });
    assertInvalid({
        type: SOCKET_MESSAGE_TYPES.CURSOR_IMAGE,
        userId: USER_ID,
        imageDataUrl: oversizedPng,
        hotspotX: 0,
        hotspotY: 0
    }, /encoded dimensions/);
});

test('cursorImage validates finite hotspot and nameOffset coordinates', () => {
    assertInvalid({
        type: SOCKET_MESSAGE_TYPES.CURSOR_IMAGE,
        userId: USER_ID,
        imageDataUrl: null,
        hotspotX: Number.NEGATIVE_INFINITY,
        hotspotY: 0
    }, /hotspot/);

    assertInvalid({
        type: SOCKET_MESSAGE_TYPES.CURSOR_IMAGE,
        userId: USER_ID,
        imageDataUrl: null,
        hotspotX: 0,
        hotspotY: 0,
        nameOffset: { x: 0, y: 'bad' }
    }, /nameOffset/);
});

test('cursorImage clamps raster geometry and custom label offsets to finite bounds', () => {
    const result = assertValid({
        type: SOCKET_MESSAGE_TYPES.CURSOR_IMAGE,
        userId: USER_ID,
        imageDataUrl: makeImageHeaderDataUrl('png', 64, 32),
        hotspotX: Number.MAX_VALUE,
        hotspotY: -Number.MAX_VALUE,
        namePosition: 'custom',
        nameOffset: { x: Number.MAX_VALUE, y: -Number.MAX_VALUE }
    });

    assert.equal(result.data.hotspotX, 63);
    assert.equal(result.data.hotspotY, 0);
    assert.deepEqual(result.data.nameOffset, {
        x: MAX_CURSOR_NAME_OFFSET,
        y: -MAX_CURSOR_NAME_OFFSET
    });

    const placement = computeOverlayNamePlacement({
        namePosition: result.data.namePosition,
        nameOffset: result.data.nameOffset,
        scale: MAX_CURSOR_IMAGE_DIMENSION
    });
    assert.equal(Number.isFinite(placement.posX), true);
    assert.equal(Number.isFinite(placement.posY), true);
});

test('cursorImage namePosition accepts only supported UI values', () => {
    for (const namePosition of CURSOR_NAME_POSITION_VALUES) {
        assertValid({
            type: SOCKET_MESSAGE_TYPES.CURSOR_IMAGE,
            userId: USER_ID,
            imageDataUrl: null,
            hotspotX: 0,
            hotspotY: 0,
            namePosition
        });
    }

    assertInvalid({
        type: SOCKET_MESSAGE_TYPES.CURSOR_IMAGE,
        userId: USER_ID,
        imageDataUrl: null,
        hotspotX: 0,
        hotspotY: 0,
        namePosition: 'offscreen-injected'
    }, /namePosition/);
});

test('hiddenPing requires finite position coordinates', () => {
    assertInvalid({
        type: SOCKET_MESSAGE_TYPES.HIDDEN_PING,
        userId: USER_ID,
        sceneId: 'scene-1',
        position: { x: 1, y: Number.NaN }
    }, /position x and y/);

    assertInvalid({
        type: SOCKET_MESSAGE_TYPES.HIDDEN_PING,
        userId: USER_ID,
        sceneId: 'scene-1',
        levelId: null,
        position: { x: 1, y: 2 },
        ping: 'pull'
    }, /ping must be an object/);
});

test('authenticated socket identity must match a known Foundry user', () => {
    const user = { id: USER_ID, name: 'Beastie' };
    const users = new Map([[USER_ID, user]]);

    assert.deepEqual(authenticateSocketSender(USER_ID, USER_ID, users), {
        valid: true,
        error: null,
        user
    });
    assert.equal(authenticateSocketSender(USER_ID, 'user-2', users).valid, false);
    assert.equal(authenticateSocketSender(USER_ID, null, users).valid, false);
    assert.equal(authenticateSocketSender('unknown', 'unknown', users).valid, false);
});

test('socket positions require matching scene, payload level, and user viewed level', () => {
    const canvas = { scene: { id: 'scene-1' }, level: { id: 'balcony' } };
    const user = { viewedScene: 'scene-1', viewedLevel: 'balcony' };

    assert.equal(isSocketMessageForCurrentView({ sceneId: 'scene-1', levelId: 'balcony' }, user, canvas), true);
    assert.equal(isSocketMessageForCurrentView({ sceneId: 'scene-2', levelId: 'balcony' }, user, canvas), false);
    assert.equal(isSocketMessageForCurrentView({ sceneId: 'scene-1', levelId: 'ground' }, user, canvas), false);
    assert.equal(isSocketMessageForCurrentView(
        { sceneId: 'scene-1', levelId: 'balcony' },
        { ...user, viewedLevel: 'ground' },
        canvas
    ), false);
    assert.equal(isSocketMessageForCurrentView(
        { sceneId: 'scene-1', levelId: 'balcony' },
        { ...user, viewedScene: null },
        canvas
    ), false);
    assert.equal(isSocketMessageForCurrentView(
        { sceneId: 'scene-1', levelId: 'balcony' },
        { viewedLevel: 'balcony' },
        canvas
    ), false);

    const canvasWithoutLevels = { scene: { id: 'scene-1' } };
    assert.equal(isSocketMessageForCurrentView({ sceneId: 'scene-1', levelId: null }, {
        viewedScene: 'scene-1',
        viewedLevel: null
    }, canvasWithoutLevels), true);
    assert.equal(isSocketMessageForCurrentView({ sceneId: 'scene-1', levelId: null }, user, canvasWithoutLevels), false);
});

test('hidden ping sanitizer allowlists fields, clamps zoom, and reserves pull for GMs', () => {
    const data = {
        sceneId: 'scene-1',
        ping: {
            style: 'alert',
            pull: true,
            zoom: 99,
            duration: 999999,
            size: 999999,
            rings: 999999,
            color2: '#ffffff'
        }
    };
    const config = { maxZoom: 4, pings: { styles: { pulse: {}, alert: {} } } };

    assert.deepEqual(sanitizeHiddenPing(data, { isGM: false }, config), {
        scene: 'scene-1', style: 'alert', pull: false, zoom: 4
    });
    assert.deepEqual(sanitizeHiddenPing(data, { isGM: true }, config), {
        scene: 'scene-1', style: 'alert', pull: true, zoom: 4
    });
    assert.deepEqual(sanitizeHiddenPing({ sceneId: 'scene-1', ping: { style: 'injected', zoom: -5 } }, {}, config), {
        scene: 'scene-1', style: 'pulse', pull: false, zoom: 0.1
    });
});

test('decoded cursor image dimensions stay inside the transport raster bound', () => {
    assert.equal(isValidCursorImageDimensions(1, 1), true);
    assert.equal(isValidCursorImageDimensions(MAX_CURSOR_IMAGE_DIMENSION, MAX_CURSOR_IMAGE_DIMENSION), true);
    assert.equal(isValidCursorImageDimensions(MAX_CURSOR_IMAGE_DIMENSION + 1, 64), false);
    assert.equal(isValidCursorImageDimensions(64, 0), false);
    assert.equal(isValidCursorImageDimensions(Number.NaN, 64), false);
});
