import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SOCKET_MESSAGE_TYPES } from '../scripts/constants.js';
import {
    MAX_CURSOR_IMAGE_DATA_URL_LENGTH,
    validateSocketMessage
} from '../scripts/socket-messages.js';

const USER_ID = 'user-1';

function assertValid(message) {
    const result = validateSocketMessage(message);
    assert.equal(result.valid, true, result.error);
    assert.equal(result.type, message.type);
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
        x: 10,
        y: 20
    });

    assertValid({
        type: SOCKET_MESSAGE_TYPES.CURSOR_IMAGE,
        userId: USER_ID,
        imageDataUrl: 'data:image/png;base64,AAAA',
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
        x: 10,
        y: Infinity
    }, /finite x and y/);
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
            imageDataUrl: `data:image/${mime};base64,AAAA`,
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

    const oversized = `data:image/png;base64,${'A'.repeat(MAX_CURSOR_IMAGE_DATA_URL_LENGTH)}`;
    assertInvalid({
        type: SOCKET_MESSAGE_TYPES.CURSOR_IMAGE,
        userId: USER_ID,
        imageDataUrl: oversized,
        hotspotX: 0,
        hotspotY: 0
    }, /too large/);
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

test('hiddenPing requires finite position coordinates', () => {
    assertInvalid({
        type: SOCKET_MESSAGE_TYPES.HIDDEN_PING,
        userId: USER_ID,
        sceneId: 'scene-1',
        position: { x: 1, y: Number.NaN }
    }, /position x and y/);
});
