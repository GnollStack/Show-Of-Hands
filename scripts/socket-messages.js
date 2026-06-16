import { SOCKET_MESSAGE_TYPES } from './constants.js';

export const SOCKET_MESSAGE_TYPE_VALUES = Object.freeze(Object.values(SOCKET_MESSAGE_TYPES));
export const MAX_CURSOR_IMAGE_DATA_URL_LENGTH = 8_000_000;

const CURSOR_IMAGE_DATA_URL_PATTERN = /^data:image\/(png|webp|jpeg|gif);base64,/i;

function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}

function isOptionalString(value) {
    return value === undefined || value === null || typeof value === "string";
}

function hasUserId(data) {
    return typeof data.userId === "string" && data.userId.length > 0;
}

export function validateSocketMessage(data) {
    if (!isPlainObject(data)) {
        return { valid: false, error: "Socket message must be an object.", type: null };
    }

    const type = data.type;
    if (!SOCKET_MESSAGE_TYPE_VALUES.includes(type)) {
        return { valid: false, error: "Unknown socket message type.", type };
    }

    if (!hasUserId(data)) {
        return { valid: false, error: `${type} requires a userId string.`, type };
    }

    if (type === SOCKET_MESSAGE_TYPES.CURSOR_MOVE) {
        if (!isOptionalString(data.sceneId)) return { valid: false, error: "cursorMove sceneId must be a string or null.", type };
        if (!isFiniteNumber(data.x) || !isFiniteNumber(data.y)) {
            return { valid: false, error: "cursorMove requires finite x and y numbers.", type };
        }
    }

    if (type === SOCKET_MESSAGE_TYPES.CURSOR_IMAGE) {
        if (!(data.imageDataUrl === null || typeof data.imageDataUrl === "string")) {
            return { valid: false, error: "cursorImage imageDataUrl must be a string or null.", type };
        }
        if (typeof data.imageDataUrl === "string") {
            if (data.imageDataUrl.length > MAX_CURSOR_IMAGE_DATA_URL_LENGTH) {
                return { valid: false, error: "cursorImage imageDataUrl is too large.", type };
            }
            if (!CURSOR_IMAGE_DATA_URL_PATTERN.test(data.imageDataUrl)) {
                return { valid: false, error: "cursorImage imageDataUrl must be a supported image data URL.", type };
            }
        }
        if (!isFiniteNumber(data.hotspotX) || !isFiniteNumber(data.hotspotY)) {
            return { valid: false, error: "cursorImage requires finite hotspot numbers.", type };
        }
        if (!isOptionalString(data.playerName) || !isOptionalString(data.namePosition)) {
            return { valid: false, error: "cursorImage playerName and namePosition must be strings when provided.", type };
        }
        if (data.nameOffset !== undefined && data.nameOffset !== null && !isPlainObject(data.nameOffset)) {
            return { valid: false, error: "cursorImage nameOffset must be an object when provided.", type };
        }
        if (isPlainObject(data.nameOffset) && (!isFiniteNumber(data.nameOffset.x) || !isFiniteNumber(data.nameOffset.y))) {
            return { valid: false, error: "cursorImage nameOffset requires finite x and y numbers.", type };
        }
    }

    if (type === SOCKET_MESSAGE_TYPES.HIDDEN_PING) {
        if (!isOptionalString(data.sceneId)) return { valid: false, error: "hiddenPing sceneId must be a string or null.", type };
        if (!isPlainObject(data.position)) return { valid: false, error: "hiddenPing requires a position object.", type };
        if (!isFiniteNumber(data.position.x) || !isFiniteNumber(data.position.y)) {
            return { valid: false, error: "hiddenPing requires finite position x and y numbers.", type };
        }
    }

    if (type === SOCKET_MESSAGE_TYPES.REQUEST_CURSOR_IMAGE && !isOptionalString(data.targetUserId)) {
        return { valid: false, error: "requestCursorImage targetUserId must be a string or null when provided.", type };
    }

    return { valid: true, error: null, type };
}

export function isKnownSocketMessageType(type) {
    return SOCKET_MESSAGE_TYPE_VALUES.includes(type);
}
