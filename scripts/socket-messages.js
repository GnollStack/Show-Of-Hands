import { CURSOR_SIZE_MAX, NAME_POSITION_PRESETS, SOCKET_MESSAGE_TYPES } from './constants.js';

export const SOCKET_MESSAGE_TYPE_VALUES = Object.freeze(Object.values(SOCKET_MESSAGE_TYPES));
export const MAX_CURSOR_IMAGE_DATA_URL_LENGTH = 256_000;
export const MAX_CURSOR_IMAGE_DIMENSION = CURSOR_SIZE_MAX;
export const MAX_SOCKET_WORLD_COORDINATE = 10_000_000;
export const MAX_CURSOR_NAME_OFFSET = 100;
export const CURSOR_NAME_POSITION_VALUES = Object.freeze([
    ...Object.keys(NAME_POSITION_PRESETS),
    'custom'
]);

const CURSOR_IMAGE_DATA_URL_PATTERN = /^data:image\/(png|webp|jpeg|gif);base64,/i;
const CURSOR_NAME_POSITION_SET = new Set(CURSOR_NAME_POSITION_VALUES);

function decodeDataUrlBytes(dataUrl) {
    try {
        const comma = dataUrl.indexOf(',');
        if (comma < 0 || typeof globalThis.atob !== 'function') return null;
        const binary = globalThis.atob(dataUrl.slice(comma + 1));
        return Uint8Array.from(binary, character => character.charCodeAt(0));
    } catch {
        return null;
    }
}

function readUint16BE(bytes, offset) {
    return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint24LE(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32BE(bytes, offset) {
    return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16)
        + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

function hasAscii(bytes, offset, value) {
    if (offset + value.length > bytes.length) return false;
    for (let index = 0; index < value.length; index += 1) {
        if (bytes[offset + index] !== value.charCodeAt(index)) return false;
    }
    return true;
}

function getJpegDimensions(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
    const sofMarkers = new Set([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]);
    let offset = 2;
    while (offset + 3 < bytes.length) {
        while (offset < bytes.length && bytes[offset] !== 0xFF) offset += 1;
        while (offset < bytes.length && bytes[offset] === 0xFF) offset += 1;
        if (offset >= bytes.length) break;
        const marker = bytes[offset++];
        if (marker === 0xD9 || marker === 0xDA) break;
        if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) continue;
        if (offset + 1 >= bytes.length) break;
        const length = readUint16BE(bytes, offset);
        if (length < 2 || offset + length > bytes.length) break;
        if (sofMarkers.has(marker) && length >= 7) {
            return {
                width: readUint16BE(bytes, offset + 5),
                height: readUint16BE(bytes, offset + 3)
            };
        }
        offset += length;
    }
    return null;
}

/** Read encoded dimensions without asking the browser to decompress the image. */
export function getCursorImageDataUrlDimensions(dataUrl) {
    if (typeof dataUrl !== 'string') return null;
    const match = CURSOR_IMAGE_DATA_URL_PATTERN.exec(dataUrl);
    if (!match) return null;
    const bytes = decodeDataUrlBytes(dataUrl);
    if (!bytes) return null;
    const mime = match[1].toLowerCase();

    if (mime === 'png') {
        if (bytes.length < 24 || !hasAscii(bytes, 1, 'PNG') || !hasAscii(bytes, 12, 'IHDR')) return null;
        return { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) };
    }
    if (mime === 'gif') {
        if (bytes.length < 10 || (!hasAscii(bytes, 0, 'GIF87a') && !hasAscii(bytes, 0, 'GIF89a'))) return null;
        return {
            width: bytes[6] | (bytes[7] << 8),
            height: bytes[8] | (bytes[9] << 8)
        };
    }
    if (mime === 'jpeg') return getJpegDimensions(bytes);
    if (mime !== 'webp' || bytes.length < 30 || !hasAscii(bytes, 0, 'RIFF') || !hasAscii(bytes, 8, 'WEBP')) return null;

    if (hasAscii(bytes, 12, 'VP8X')) {
        return { width: readUint24LE(bytes, 24) + 1, height: readUint24LE(bytes, 27) + 1 };
    }
    if (hasAscii(bytes, 12, 'VP8L') && bytes[20] === 0x2F) {
        return {
            width: 1 + (((bytes[22] & 0x3F) << 8) | bytes[21]),
            height: 1 + (((bytes[24] & 0x0F) << 10) | (bytes[23] << 2) | (bytes[22] >> 6))
        };
    }
    if (hasAscii(bytes, 12, 'VP8 ') && bytes[23] === 0x9D && bytes[24] === 0x01 && bytes[25] === 0x2A) {
        return {
            width: (bytes[26] | (bytes[27] << 8)) & 0x3FFF,
            height: (bytes[28] | (bytes[29] << 8)) & 0x3FFF
        };
    }
    return null;
}

function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}

function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function isOptionalString(value) {
    return value === undefined || value === null || typeof value === "string";
}

function hasUserId(data) {
    return typeof data.userId === "string" && data.userId.length > 0;
}

function normalizeId(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Resolve a claimed payload identity through Foundry's authenticated sender. */
export function authenticateSocketSender(claimedUserId, senderId, users) {
    const claimedId = normalizeId(claimedUserId);
    const authenticatedId = normalizeId(senderId);
    if (!claimedId || !authenticatedId) {
        return { valid: false, error: 'Socket sender identity is missing.', user: null };
    }
    if (claimedId !== authenticatedId) {
        return { valid: false, error: 'Socket payload identity does not match its authenticated sender.', user: null };
    }
    const user = users?.get?.(authenticatedId) ?? null;
    if (!user) {
        return { valid: false, error: 'Socket sender is not a known Foundry user.', user: null };
    }
    return { valid: true, error: null, user };
}

/**
 * Require a socket position to belong to the scene and Scene Levels view that
 * both this client and the authenticated remote user are currently viewing.
 */
export function isSocketMessageForCurrentView(data, user, canvasRef = globalThis.canvas) {
    const currentSceneId = normalizeId(canvasRef?.scene?.id);
    const messageSceneId = normalizeId(data?.sceneId);
    if (!currentSceneId || messageSceneId !== currentSceneId) return false;

    const viewedSceneId = normalizeId(user?.viewedScene);
    if (viewedSceneId !== currentSceneId) return false;

    const currentLevelId = normalizeId(canvasRef?.level?.id);
    const messageLevelId = normalizeId(data?.levelId);
    const viewedLevelId = normalizeId(user?.viewedLevel);
    return messageLevelId === currentLevelId && viewedLevelId === currentLevelId;
}

/** Reduce a private-mode ping to Foundry's documented broadcast fields. */
export function sanitizeHiddenPing(data, user, canvasConfig = globalThis.CONFIG?.Canvas) {
    const source = isPlainObject(data?.ping) ? data.ping : {};
    const styles = canvasConfig?.pings?.styles ?? {};
    const style = typeof source.style === 'string' && Object.prototype.hasOwnProperty.call(styles, source.style)
        ? source.style
        : 'pulse';
    const configuredMaxZoom = Number(canvasConfig?.maxZoom);
    const maxZoom = Number.isFinite(configuredMaxZoom) && configuredMaxZoom > 0 ? configuredMaxZoom : 3;
    const requestedZoom = Number(source.zoom);
    const zoom = Number.isFinite(requestedZoom)
        ? Math.min(maxZoom, Math.max(0.1, requestedZoom))
        : 1;

    return {
        scene: normalizeId(data?.sceneId),
        style,
        pull: user?.isGM === true && source.pull === true,
        zoom
    };
}

export function isValidCursorImageDimensions(width, height, maxDimension = MAX_CURSOR_IMAGE_DIMENSION) {
    return Number.isFinite(width) &&
        Number.isFinite(height) &&
        width > 0 &&
        height > 0 &&
        width <= maxDimension &&
        height <= maxDimension;
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
        if (!isOptionalString(data.levelId)) return { valid: false, error: 'cursorMove levelId must be a string or null.', type };
        if (!isOptionalString(data.sceneId)) return { valid: false, error: "cursorMove sceneId must be a string or null.", type };
        if (!isFiniteNumber(data.x) || !isFiniteNumber(data.y)) {
            return { valid: false, error: "cursorMove requires finite x and y numbers.", type };
        }
        return {
            valid: true,
            error: null,
            type,
            data: {
                ...data,
                x: clampNumber(data.x, -MAX_SOCKET_WORLD_COORDINATE, MAX_SOCKET_WORLD_COORDINATE),
                y: clampNumber(data.y, -MAX_SOCKET_WORLD_COORDINATE, MAX_SOCKET_WORLD_COORDINATE)
            }
        };
    }

    if (type === SOCKET_MESSAGE_TYPES.CURSOR_IMAGE) {
        let dimensions = null;
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
            dimensions = getCursorImageDataUrlDimensions(data.imageDataUrl);
            if (!dimensions) {
                return { valid: false, error: "cursorImage encoded image header is invalid or unsupported.", type };
            }
            if (!isValidCursorImageDimensions(dimensions.width, dimensions.height)) {
                return { valid: false, error: "cursorImage encoded dimensions exceed the supported bounds.", type };
            }
        }
        if (!isFiniteNumber(data.hotspotX) || !isFiniteNumber(data.hotspotY)) {
            return { valid: false, error: "cursorImage requires finite hotspot numbers.", type };
        }
        if (!isOptionalString(data.playerName) || !isOptionalString(data.namePosition)) {
            return { valid: false, error: "cursorImage playerName and namePosition must be strings when provided.", type };
        }
        if (data.namePosition !== undefined && data.namePosition !== null && !CURSOR_NAME_POSITION_SET.has(data.namePosition)) {
            return { valid: false, error: "cursorImage namePosition is not supported.", type };
        }
        if (data.nameOffset !== undefined && data.nameOffset !== null && !isPlainObject(data.nameOffset)) {
            return { valid: false, error: "cursorImage nameOffset must be an object when provided.", type };
        }
        if (isPlainObject(data.nameOffset) && (!isFiniteNumber(data.nameOffset.x) || !isFiniteNumber(data.nameOffset.y))) {
            return { valid: false, error: "cursorImage nameOffset requires finite x and y numbers.", type };
        }
        const maxHotspotX = dimensions ? Math.max(0, dimensions.width - 1) : MAX_CURSOR_IMAGE_DIMENSION - 1;
        const maxHotspotY = dimensions ? Math.max(0, dimensions.height - 1) : MAX_CURSOR_IMAGE_DIMENSION - 1;
        return {
            valid: true,
            error: null,
            type,
            data: {
                ...data,
                hotspotX: clampNumber(data.hotspotX, 0, maxHotspotX),
                hotspotY: clampNumber(data.hotspotY, 0, maxHotspotY),
                ...(isPlainObject(data.nameOffset) ? {
                    nameOffset: {
                        ...data.nameOffset,
                        x: clampNumber(data.nameOffset.x, -MAX_CURSOR_NAME_OFFSET, MAX_CURSOR_NAME_OFFSET),
                        y: clampNumber(data.nameOffset.y, -MAX_CURSOR_NAME_OFFSET, MAX_CURSOR_NAME_OFFSET)
                    }
                } : {})
            }
        };
    }

    if (type === SOCKET_MESSAGE_TYPES.HIDDEN_PING) {
        if (!isOptionalString(data.levelId)) return { valid: false, error: 'hiddenPing levelId must be a string or null.', type };
        if (!isOptionalString(data.sceneId)) return { valid: false, error: "hiddenPing sceneId must be a string or null.", type };
        if (!isPlainObject(data.position)) return { valid: false, error: "hiddenPing requires a position object.", type };
        if (!isFiniteNumber(data.position.x) || !isFiniteNumber(data.position.y)) {
            return { valid: false, error: "hiddenPing requires finite position x and y numbers.", type };
        }
        if (data.ping !== undefined && data.ping !== null && !isPlainObject(data.ping)) {
            return { valid: false, error: "hiddenPing ping must be an object when provided.", type };
        }
        return {
            valid: true,
            error: null,
            type,
            data: {
                ...data,
                position: {
                    ...data.position,
                    x: clampNumber(data.position.x, -MAX_SOCKET_WORLD_COORDINATE, MAX_SOCKET_WORLD_COORDINATE),
                    y: clampNumber(data.position.y, -MAX_SOCKET_WORLD_COORDINATE, MAX_SOCKET_WORLD_COORDINATE)
                }
            }
        };
    }

    if (type === SOCKET_MESSAGE_TYPES.REQUEST_CURSOR_IMAGE && !isOptionalString(data.targetUserId)) {
        return { valid: false, error: "requestCursorImage targetUserId must be a string or null when provided.", type };
    }

    return { valid: true, error: null, type, data: { ...data } };
}

export function isKnownSocketMessageType(type) {
    return SOCKET_MESSAGE_TYPE_VALUES.includes(type);
}
