/**
 * @file cursor-sharing.js
 * @description Transient socket/native activity bridge for shared cursor
 * images, positions, hidden pings, and visibility permission state.
 */

import { MODULE_ID, SOCKET_EVENT, SOCKET_MESSAGE_TYPES, CURSOR_SHARE_THROTTLE_MS, CURSOR_SIZE_MAX, debugLog } from './constants.js';
import {
    observeNativeCursorActivity,
    removeRemoteCursor,
    updateRemoteCursor,
    updateRemoteCursorImage,
    updateRemoteCursorUser
} from './cursor-overlay.js';
import { loadImage, getRotatedCursor } from './cursor-styles.js';
import { computeResizeOutput } from './cursor-geometry-core.js';
import { LatestValueRateLimiter } from './latest-value-rate-limiter.js';
import { canBroadcastVisibleCursor, getShowCursorPermissionState } from './foundry-permissions.js';
import { getHiddenSharedCursorUserIds, getUserCursorConfig, isSharedCursorUserVisible } from './settings.js';
import {
    MAX_CURSOR_IMAGE_DATA_URL_LENGTH,
    authenticateSocketSender,
    isKnownSocketMessageType,
    isSocketMessageForCurrentView,
    sanitizeHiddenPing,
    validateSocketMessage
} from './socket-messages.js';

// Foundry's native cursor code lives in client/canvas/containers/elements/cursor.mjs.
// Mirror its coordinates when available so our overlay stays on the same dot.

let _active = false;
let _broadcastEnabled = true;
let _registered = false;
let _lastBroadcast = 0;
let _userConnectedHookId = null;
let _updateUserHookId = null;
let _cachedCursorDataUrl = null;
let _cachedHotspotX = 0;
let _cachedHotspotY = 0;
let _broadcastInFlight = false;
let _broadcastQueued = false;
let _broadcastGeneration = 0;
let _permissionBlocked = false;
let _lastMoveDebugLog = 0;
let _lastSocketMoveDebugLog = 0;
let _socketListenerActive = false;
let _nativeUserActivityListenerActive = false;
const _inboundSocketRateLimits = new Map();

const INBOUND_CURSOR_MOVE_MIN_INTERVAL_MS = 25;
const INBOUND_CURSOR_IMAGE_MIN_INTERVAL_MS = 250;
const INBOUND_CURSOR_IMAGE_REQUEST_MIN_INTERVAL_MS = 1000;
const INBOUND_HIDDEN_PING_MIN_INTERVAL_MS = 500;

const _inboundCursorImageLimiter = new LatestValueRateLimiter({
    intervalMs: INBOUND_CURSOR_IMAGE_MIN_INTERVAL_MS,
    deliver: payload => _validateAndApplyInboundCursorImage(payload)
});

function debugCursorMoveBroadcast(currentPos, now) {
    if (now - _lastMoveDebugLog < 1000) return;
    _lastMoveDebugLog = now;
    debugLog("sharing", `Mouse move: emitting cursorMove at (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}), scene=${canvas.scene?.id}`);
}

function debugSocketMessage(data) {
    if (data?.type === SOCKET_MESSAGE_TYPES.CURSOR_MOVE) {
        const now = performance.now();
        if (now - _lastSocketMoveDebugLog < 1000) return;
        _lastSocketMoveDebugLog = now;
    }
    debugLog("sharing", `Socket received: type=${data.type}, userId=${data.userId}, sceneId=${data.sceneId}`);
}

function _isInboundRateLimited(userId, bucket, minIntervalMs) {
    const now = Date.now();
    const limits = _inboundSocketRateLimits.get(userId) ?? {};
    const last = limits[bucket] ?? 0;
    if (last && now - last < minIntervalMs) return true;

    limits[bucket] = now;
    _inboundSocketRateLimits.set(userId, limits);
    return false;
}

function _getCurrentLevelId() {
    const levelId = canvas?.level?.id;
    return typeof levelId === 'string' && levelId.length > 0 ? levelId : null;
}

function _getRecipientOptions(userId) {
    return { recipients: [userId] };
}

function _emitModuleSocket(data, recipientUserId = null) {
    if (recipientUserId) {
        game.socket.emit(SOCKET_EVENT, data, _getRecipientOptions(recipientUserId));
        return;
    }
    game.socket.emit(SOCKET_EVENT, data);
}

function _getAuthenticatedSender(data, senderId) {
    const result = authenticateSocketSender(data?.userId, senderId, game.users);
    if (!result.valid) {
        debugLog('sharing', `Ignored unauthenticated socket message: type=${data?.type}, error=${result.error}`);
        return null;
    }
    return result.user;
}

function _syncVisibleCursorPermission() {
    // Foundry v14 can deny visible cursor broadcasting by permission. When that
    // happens we clear our cached image and tell peers to hide this overlay too.
    const blocked = _broadcastEnabled && !canBroadcastVisibleCursor(globalThis.game?.user);
    const becameBlocked = blocked && !_permissionBlocked;
    const becameAllowed = !blocked && _permissionBlocked;
    _permissionBlocked = blocked;

    if (becameBlocked) {
        _broadcastGeneration += 1;
        _broadcastQueued = false;
        _cachedCursorDataUrl = null;
        _cachedHotspotX = 0;
        _cachedHotspotY = 0;
        _emitCursorHidden();
        debugLog("sharing", "Cursor broadcast blocked by Foundry SHOW_CURSOR permission");
    } else if (becameAllowed) {
        debugLog("sharing", "Cursor broadcast unblocked by Foundry SHOW_CURSOR permission");
    }

    return {
        allowed: !blocked,
        blocked,
        becameBlocked,
        becameAllowed
    };
}

function _canShowRemoteSharedCursor(userId) {
    if (!isSharedCursorUserVisible(userId)) return false;
    const user = game.users?.get?.(userId);
    if (!user) return false;
    return canBroadcastVisibleCursor(user);
}

export function startCursorSharing(broadcastEnabled = true) {
    debugLog("sharing", `startCursorSharing called, _active=${_active}, _registered=${_registered}, broadcastEnabled=${broadcastEnabled}`);
    _broadcastEnabled = broadcastEnabled;
    if (_active) {
        setCursorBroadcastEnabled(_broadcastEnabled);
        return;
    }
    _active = true;
    _broadcastGeneration += 1;

    // Module socket: images, positions, visibility, and hidden pings.
    game.socket.on(SOCKET_EVENT, _onSocketMessage);
    _socketListenerActive = true;
    debugLog("sharing", `Registered socket listener on "${SOCKET_EVENT}"`);
    game.socket.on("userActivity", _onFoundryUserActivity);
    _nativeUserActivityListenerActive = true;
    debugLog("sharing", "Registered Foundry userActivity listener for cursor alignment");

    // Foundry gives canvas coordinates here, but no unregister API. Register
    // once, then gate behavior with _active/_broadcastEnabled.
    if (!_registered) {
        canvas.registerMouseMoveHandler(_onCanvasMouseMove, 0);
        _registered = true;
        debugLog("sharing", "Registered canvas mouse move handler");
    }

    _userConnectedHookId = Hooks.on("userConnected", _onUserConnected);

    _updateUserHookId = Hooks.on('updateUser', _onUserUpdated);

    // Only build and broadcast cursor art when sharing is on and Foundry allows it.
    if (_broadcastEnabled && _syncVisibleCursorPermission().allowed) _broadcastCursorImage();
    _requestCursorImages();

    debugLog("sharing", "Cursor sharing started successfully");
}

export function setCursorBroadcastEnabled(enabled) {
    _broadcastGeneration += 1;
    _broadcastEnabled = enabled;
    if (!_active) {
        if (!enabled) _emitCursorHidden();
        _permissionBlocked = enabled && !canBroadcastVisibleCursor(globalThis.game?.user);
        return;
    }

    if (enabled) {
        if (_syncVisibleCursorPermission().allowed) _broadcastCursorImage();
        _requestCursorImages();
    } else {
        _broadcastQueued = false;
        _permissionBlocked = false;
        _cachedCursorDataUrl = null;
        _cachedHotspotX = 0;
        _cachedHotspotY = 0;
        _emitCursorHidden();
    }

    debugLog("sharing", `Cursor broadcast ${enabled ? "enabled" : "disabled"}`);
}

export function broadcastHiddenPing(position, pingData) {
    // Private mode pings ride over the module socket so Foundry does not receive
    // the local user's native cursor coordinates.
    game.socket.emit(SOCKET_EVENT, {
        type: SOCKET_MESSAGE_TYPES.HIDDEN_PING,
        userId: game.user.id,
        sceneId: canvas.scene?.id,
        levelId: _getCurrentLevelId(),
        position,
        ping: pingData
    });
    debugLog("sharing", `Broadcast hidden ping at (${position?.x?.toFixed?.(1) ?? "?"}, ${position?.y?.toFixed?.(1) ?? "?"})`);
}

export function stopCursorSharing() {
    if (!_active) {
        _inboundSocketRateLimits.clear();
        return;
    }
    _active = false;
    _broadcastEnabled = false;
    _broadcastGeneration += 1;
    _broadcastQueued = false;
    _permissionBlocked = false;

    game.socket.off(SOCKET_EVENT, _onSocketMessage);
    game.socket.off("userActivity", _onFoundryUserActivity);
    _socketListenerActive = false;
    _nativeUserActivityListenerActive = false;

    if (_userConnectedHookId !== null) {
        Hooks.off("userConnected", _userConnectedHookId);
        _userConnectedHookId = null;
    }

    if (_updateUserHookId !== null) {
        Hooks.off('updateUser', _updateUserHookId);
        _updateUserHookId = null;
    }

    _cachedCursorDataUrl = null;
    _cachedHotspotX = 0;
    _cachedHotspotY = 0;
    _inboundSocketRateLimits.clear();
    _inboundCursorImageLimiter.clear();

    debugLog("sharing", "Cursor sharing stopped");
}

export function syncHiddenRemoteCursors() {
    for (const userId of getHiddenSharedCursorUserIds()) {
        _inboundCursorImageLimiter.cancel(userId);
        removeRemoteCursor(userId);
    }
    if (_active) _requestCursorImages();
}

export function getCursorSharingDebugState() {
    return {
        active: _active,
        broadcastEnabled: _broadcastEnabled,
        registeredMouseHandler: _registered,
        socketListenerActive: _socketListenerActive,
        nativeUserActivityListenerActive: _nativeUserActivityListenerActive,
        hasCachedCursorImage: !!_cachedCursorDataUrl,
        cachedHotspotX: _cachedHotspotX,
        cachedHotspotY: _cachedHotspotY,
        broadcastInFlight: _broadcastInFlight,
        broadcastQueued: _broadcastQueued,
        broadcastGeneration: _broadcastGeneration,
        showCursorPermission: getShowCursorPermissionState(globalThis.game?.user),
        permissionBlocked: _broadcastEnabled && !canBroadcastVisibleCursor(globalThis.game?.user),
        visibleBroadcastAllowed: _broadcastEnabled && canBroadcastVisibleCursor(globalThis.game?.user),
        hiddenRemoteUsers: [...getHiddenSharedCursorUserIds()]
    };
}

/**
 * Rebuild and rebroadcast the local cursor image after profile changes.
 */
export async function refreshSharedCursorImage() {
    if (!_active || !_broadcastEnabled) return;
    if (!_syncVisibleCursorPermission().allowed) return;
    _broadcastGeneration += 1;
    _cachedCursorDataUrl = null;
    _cachedHotspotX = 0;
    _cachedHotspotY = 0;
    await _broadcastCursorImage();
}

/**
 * Mouse move handler registered with Foundry's canvas system.
 * Receives canvas coordinates (PIXI.Point) from the stage pointer events.
 */
function _cacheAndEmitCursorImage(dataUrl, hotspotX, hotspotY, generation) {
    if (dataUrl !== null && (typeof dataUrl !== 'string' || dataUrl.length > MAX_CURSOR_IMAGE_DATA_URL_LENGTH)) {
        throw new Error(`Shared cursor image exceeds the ${MAX_CURSOR_IMAGE_DATA_URL_LENGTH}-character transport limit.`);
    }
    if (!_active || !_broadcastEnabled) return false;
    if (!_syncVisibleCursorPermission().allowed) return false;
    if (generation !== _broadcastGeneration) return false;
    _cachedCursorDataUrl = dataUrl;
    _cachedHotspotX = hotspotX;
    _cachedHotspotY = hotspotY;
    _emitCursorImage(dataUrl, hotspotX, hotspotY);
    return true;
}

function _onCanvasMouseMove(currentPos) {
    if (!_active || !_broadcastEnabled) return;
    const permission = _syncVisibleCursorPermission();
    if (!permission.allowed) return;
    if (permission.becameAllowed) _broadcastCursorImage();

    const now = performance.now();
    if (now - _lastBroadcast < CURSOR_SHARE_THROTTLE_MS) return;
    _lastBroadcast = now;

    debugCursorMoveBroadcast(currentPos, now);

    const socket = game.socket.volatile ?? game.socket;
    socket.emit(SOCKET_EVENT, {
        type: SOCKET_MESSAGE_TYPES.CURSOR_MOVE,
        userId: game.user.id,
        sceneId: canvas.scene?.id,
        levelId: _getCurrentLevelId(),
        x: currentPos.x,
        y: currentPos.y
    });
}

async function _broadcastCursorImage() {
    if (!_broadcastEnabled) return;
    if (!_syncVisibleCursorPermission().allowed) return;

    // Cursor image processing is async. Queue one follow-up run instead of
    // interleaving multiple canvas/data-url builds for the same user.
    if (_broadcastInFlight) {
        _broadcastQueued = true;
        return;
    }
    _broadcastInFlight = true;
    const generation = _broadcastGeneration;

    try {
        const config = getUserCursorConfig(game.user);
        const isCursorEnabled = config.useCustomCursor;
        if (!isCursorEnabled) {
            _cacheAndEmitCursorImage(null, 0, 0, generation);
            return;
        }

        const states = config.cursorStates;
        const def = states?.default;
        if (!def?.image) {
            _cacheAndEmitCursorImage(null, 0, 0, generation);
            return;
        }

        const rotation = def.rotation || 0;
        const targetWidth = def.width || 0;
        const targetHeight = def.height || 0;

        // Resize/rotation changes what peers draw, so send processed image data.
        if (rotation !== 0 || targetWidth > 0 || targetHeight > 0) {
            const processed = await getRotatedCursor(def.image, def.hotspotX, def.hotspotY, rotation, targetWidth, targetHeight);
            if (processed) {
                _cacheAndEmitCursorImage(processed.dataUrl, processed.hotspotX, processed.hotspotY, generation);
                return;
            }
        }

        // No rotation/resize: convert the original image to a data URL so peers
        // do not need filesystem access to the same asset path. Always cap the
        // raster before transport, including natural-sized source images.
        const img = await loadImage(def.image);
        const out = computeResizeOutput(img.width, img.height, def.hotspotX, def.hotspotY, CURSOR_SIZE_MAX);
        const cvs = document.createElement('canvas');
        cvs.width = out.width;
        cvs.height = out.height;
        const ctx = cvs.getContext('2d');
        if (!ctx) throw new Error("Unable to create a 2D canvas context for shared cursor image.");
        ctx.drawImage(img, 0, 0, out.width, out.height);
        _cacheAndEmitCursorImage(cvs.toDataURL('image/png'), out.hotspotX, out.hotspotY, generation);
    } catch (e) {
        console.warn(`${MODULE_ID} | Failed to build shared cursor image:`, e);
        if (generation === _broadcastGeneration) _cacheAndEmitCursorImage(null, 0, 0, generation);
    } finally {
        _broadcastInFlight = false;
        if (_broadcastQueued) {
            _broadcastQueued = false;
            if (_active && _broadcastEnabled) _broadcastCursorImage();
        }
    }
}

function _applyInboundCursorImage({ senderId, data } = {}) {
    if (!_active || !senderId || !data) return;
    const sender = game.users?.get?.(senderId);
    if (!sender || !_canShowRemoteSharedCursor(senderId)) {
        removeRemoteCursor(senderId);
        return;
    }
    updateRemoteCursorImage(
        senderId,
        data.imageDataUrl,
        data.hotspotX,
        data.hotspotY,
        sender.name,
        data.namePosition,
        data.nameOffset
    );
}

function _normalizeSocketMessageOrLog(data) {
    const validation = validateSocketMessage(data);
    if (validation.valid) return validation.data;
    if (isKnownSocketMessageType(data?.type)) {
        debugLog("sharing", `Ignored malformed socket message: type=${data.type}, error=${validation.error}`);
    }
    return null;
}

function _validateAndApplyInboundCursorImage(payload) {
    const data = _normalizeSocketMessageOrLog(payload?.data);
    if (!data) return;
    debugSocketMessage(data);
    _applyInboundCursorImage({ ...payload, data });
}

function _emitCursorImage(dataUrl, hotspotX, hotspotY, recipientUserId = null) {
    if (!_broadcastEnabled) return;
    if (!_syncVisibleCursorPermission().allowed) return;

    // Send the owner's name placement with the image so every client agrees.
    let namePosition = "bottom-center";
    let nameOffset = { x: 0, y: 1.2 };
    try {
        const config = getUserCursorConfig(game.user);
        namePosition = config.namePosition;
        nameOffset = config.nameOffset;
    } catch { /* use defaults */ }

    _emitModuleSocket({
        type: SOCKET_MESSAGE_TYPES.CURSOR_IMAGE,
        userId: game.user.id,
        playerName: game.user.name,
        imageDataUrl: dataUrl,
        hotspotX,
        hotspotY,
        namePosition,
        nameOffset
    }, recipientUserId);
    debugLog("sharing", "Broadcast cursor image", dataUrl ? `(${dataUrl.length} bytes)` : "(cleared)");
}

function _emitCursorHidden(recipientUserId = null) {
    _emitModuleSocket({
        type: SOCKET_MESSAGE_TYPES.CURSOR_HIDDEN,
        userId: game.user.id
    }, recipientUserId);
    debugLog("sharing", "Broadcast cursor hidden");
}

function _requestCursorImages(targetUserId = null) {
    _emitModuleSocket({
        type: SOCKET_MESSAGE_TYPES.REQUEST_CURSOR_IMAGE,
        userId: game.user.id,
        targetUserId
    }, targetUserId);
    debugLog("sharing", targetUserId ? `Requested cursor image from ${targetUserId}` : "Requested cursor images from active peers");
}

function _onSocketMessage(data, senderId) {
    const sender = _getAuthenticatedSender(data, senderId);
    if (!sender) return;

    // Cursor-image header validation decodes bounded base64. Authenticate and
    // coalesce by sender before doing that work, while keeping null clears
    // immediate and fully validated.
    if (data?.type === SOCKET_MESSAGE_TYPES.CURSOR_IMAGE) {
        if (sender.id === game.user.id) return;
        if (!_canShowRemoteSharedCursor(sender.id)) {
            _inboundCursorImageLimiter.cancel(sender.id);
            removeRemoteCursor(sender.id);
            return;
        }
        const payload = { senderId: sender.id, data };
        if (data.imageDataUrl === null) {
            const normalizedData = _normalizeSocketMessageOrLog(data);
            if (!normalizedData) return;
            debugSocketMessage(normalizedData);
            _inboundCursorImageLimiter.cancel(sender.id);
            _applyInboundCursorImage({ ...payload, data: normalizedData });
        } else {
            _inboundCursorImageLimiter.push(sender.id, payload);
        }
        return;
    }

    data = _normalizeSocketMessageOrLog(data);
    if (!data) return;
    debugSocketMessage(data);
    if (data.type === SOCKET_MESSAGE_TYPES.CURSOR_MOVE) {
        if (sender.id === game.user.id) return;
        if (!isSocketMessageForCurrentView(data, sender, canvas)) {
            removeRemoteCursor(sender.id);
            return;
        }
        if (!_canShowRemoteSharedCursor(sender.id)) {
            removeRemoteCursor(sender.id);
            return;
        }
        if (_isInboundRateLimited(sender.id, "move", INBOUND_CURSOR_MOVE_MIN_INTERVAL_MS)) return;
        updateRemoteCursor(sender.id, data.x, data.y, { source: "module" });
    } else if (data.type === SOCKET_MESSAGE_TYPES.CURSOR_HIDDEN) {
        if (sender.id === game.user.id) return;
        _inboundCursorImageLimiter.cancel(sender.id);
        removeRemoteCursor(sender.id);
    } else if (data.type === SOCKET_MESSAGE_TYPES.HIDDEN_PING) {
        if (sender.id === game.user.id) return;
        if (!isSocketMessageForCurrentView(data, sender, canvas)) return;
        const user = sender;
        if (!user || !canvas.ready || !data.position) return;
        if (user.hasPermission?.('PING_CANVAS') !== true) return;
        if (_isInboundRateLimited(sender.id, 'hiddenPing', INBOUND_HIDDEN_PING_MIN_INTERVAL_MS)) return;
        const ping = sanitizeHiddenPing(data, user, globalThis.CONFIG?.Canvas);
        canvas.controls.handlePing(user, data.position, ping);
    } else if (data.type === SOCKET_MESSAGE_TYPES.REQUEST_CURSOR_IMAGE) {
        if (sender.id === game.user.id) return;
        if (data.targetUserId && data.targetUserId !== game.user.id) return;
        if (_isInboundRateLimited(sender.id, 'imageRequest', INBOUND_CURSOR_IMAGE_REQUEST_MIN_INTERVAL_MS)) return;
        // Another user is asking us for our current cursor image.
        if (_broadcastEnabled && _syncVisibleCursorPermission().allowed) {
            _emitCursorImage(_cachedCursorDataUrl, _cachedHotspotX, _cachedHotspotY, sender.id);
        } else {
            _emitCursorHidden(sender.id);
        }
    }
}

function _onFoundryUserActivity(userId, activityData = {}) {
    if (!_active || userId === game.user.id) return;
    const user = game.users?.get?.(userId);
    if (!user) {
        removeRemoteCursor(userId);
        return;
    }
    if (!_canShowRemoteSharedCursor(userId)) {
        removeRemoteCursor(userId);
        return;
    }

    if (activityData.active === false) {
        removeRemoteCursor(userId);
        return;
    }

    const view = {
        sceneId: activityData.sceneId ?? user.viewedScene,
        levelId: activityData.levelId ?? user.viewedLevel
    };
    if (!isSocketMessageForCurrentView(view, user, canvas)) {
        removeRemoteCursor(userId);
        return;
    }

    if (!Object.prototype.hasOwnProperty.call(activityData, "cursor")) return;

    const cursor = activityData.cursor;
    if (cursor === null) {
        removeRemoteCursor(userId);
        return;
    }

    const x = Number(cursor?.x);
    const y = Number(cursor?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    observeNativeCursorActivity(userId, { x, y });
    updateRemoteCursor(userId, x, y, { source: "native" });
}

function _removeCursorOutsideCurrentView(user) {
    if (!user || user.id === game.user.id) return;
    const view = { sceneId: user.viewedScene, levelId: user.viewedLevel };
    if (!isSocketMessageForCurrentView(view, user, canvas)) {
        _inboundCursorImageLimiter.cancel(user.id);
        removeRemoteCursor(user.id);
    }
}

function _onUserUpdated(user, change = {}) {
    const viewChanged = Object.prototype.hasOwnProperty.call(change, 'viewedScene') ||
        Object.prototype.hasOwnProperty.call(change, 'viewedLevel');
    const identityChanged = Object.prototype.hasOwnProperty.call(change, 'name') ||
        Object.prototype.hasOwnProperty.call(change, 'color');

    if (user.id !== game.user.id && identityChanged) updateRemoteCursorUser(user.id);
    if (!viewChanged) return;

    if (user.id !== game.user.id) {
        _removeCursorOutsideCurrentView(user);
        return;
    }

    const users = game.users?.contents ?? [...(game.users?.values?.() ?? [])];
    for (const remoteUser of users) _removeCursorOutsideCurrentView(remoteUser);
}

function _onUserConnected(user, connected) {
    if (user.id === game.user.id) return;
    if (!connected) {
        _inboundSocketRateLimits.delete(user.id);
        _inboundCursorImageLimiter.cancel(user.id, { forgetLast: true });
        removeRemoteCursor(user.id);
        debugLog("sharing", `User disconnected: ${user.name}`);
    } else {
        // Peer joined; exchange cursor images once visibility checks pass.
        if (_broadcastEnabled && _syncVisibleCursorPermission().allowed) {
            _emitCursorImage(_cachedCursorDataUrl, _cachedHotspotX, _cachedHotspotY, user.id);
        }
        if (_canShowRemoteSharedCursor(user.id)) _requestCursorImages(user.id);
        debugLog("sharing", `User connected: ${user.name}, exchanging cursor images`);
    }
}
