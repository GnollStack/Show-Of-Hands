import { MODULE_ID, SOCKET_EVENT, CURSOR_SHARE_THROTTLE_MS, debugLog } from './constants.js';
import { updateRemoteCursor, updateRemoteCursorImage, removeRemoteCursor } from './cursor-overlay.js';
import { loadImage, getRotatedCursor } from './cursor-styles.js';
import { canBroadcastVisibleCursor, getShowCursorPermissionState } from './foundry-permissions.js';
import { getHiddenSharedCursorUserIds, getUserCursorConfig, isSharedCursorUserVisible } from './settings.js';

// foundry deafult C:\Program Files\Foundry Virtual Tabletop\resources\app\client\canvas\containers\elements\cursor.mjs

let _active = false;
let _broadcastEnabled = true;
let _registered = false;
let _lastBroadcast = 0;
let _userConnectedHookId = null;
let _cachedCursorDataUrl = null;
let _cachedHotspotX = 0;
let _cachedHotspotY = 0;
let _broadcastInFlight = false;
let _broadcastQueued = false;
let _permissionBlocked = false;
let _lastMoveDebugLog = 0;
let _lastSocketMoveDebugLog = 0;

function debugCursorMoveBroadcast(currentPos, now) {
    if (now - _lastMoveDebugLog < 1000) return;
    _lastMoveDebugLog = now;
    debugLog("sharing", `Mouse move: emitting cursorMove at (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}), scene=${canvas.scene?.id}`);
}

function debugSocketMessage(data) {
    if (data?.type === "cursorMove") {
        const now = performance.now();
        if (now - _lastSocketMoveDebugLog < 1000) return;
        _lastSocketMoveDebugLog = now;
    }
    debugLog("sharing", `Socket received: type=${data.type}, userId=${data.userId}, sceneId=${data.sceneId}`);
}

function _syncVisibleCursorPermission() {
    const blocked = _broadcastEnabled && !canBroadcastVisibleCursor(globalThis.game?.user);
    const becameBlocked = blocked && !_permissionBlocked;
    const becameAllowed = !blocked && _permissionBlocked;
    _permissionBlocked = blocked;

    if (becameBlocked) {
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

    // Listen for our module's socket messages (cursor images + position)
    game.socket.on(SOCKET_EVENT, _onSocketMessage);
    debugLog("sharing", `Registered socket listener on "${SOCKET_EVENT}"`);
    game.socket.on("userActivity", _onFoundryUserActivity);
    debugLog("sharing", "Registered Foundry userActivity listener for cursor alignment");

    // Register a mouse move handler using Foundry's canvas system.
    // This receives canvas coordinates directly from PIXI pointer events.
    // Registration is permanent (no unregister API), so we only do it once
    // and gate on _active inside the handler.
    if (!_registered) {
        canvas.registerMouseMoveHandler(_onCanvasMouseMove, 0);
        _registered = true;
        debugLog("sharing", "Registered canvas mouse move handler");
    }

    _userConnectedHookId = Hooks.on("userConnected", _onUserConnected);

    // Build and broadcast our custom cursor image only when local sharing is enabled and permitted by Foundry.
    if (_broadcastEnabled && _syncVisibleCursorPermission().allowed) _broadcastCursorImage();
    _requestCursorImages();

    debugLog("sharing", "Cursor sharing started successfully");
}

export function setCursorBroadcastEnabled(enabled) {
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
        _permissionBlocked = false;
        _cachedCursorDataUrl = null;
        _cachedHotspotX = 0;
        _cachedHotspotY = 0;
        _emitCursorHidden();
    }

    debugLog("sharing", `Cursor broadcast ${enabled ? "enabled" : "disabled"}`);
}

export function broadcastHiddenPing(position, pingData) {
    game.socket.emit(SOCKET_EVENT, {
        type: "hiddenPing",
        userId: game.user.id,
        sceneId: canvas.scene?.id,
        position,
        ping: pingData
    });
    debugLog("sharing", `Broadcast hidden ping at (${position?.x?.toFixed?.(1) ?? "?"}, ${position?.y?.toFixed?.(1) ?? "?"})`);
}

export function stopCursorSharing() {
    if (!_active) return;
    _active = false;
    _broadcastEnabled = false;
    _permissionBlocked = false;

    game.socket.off(SOCKET_EVENT, _onSocketMessage);
    game.socket.off("userActivity", _onFoundryUserActivity);

    if (_userConnectedHookId !== null) {
        Hooks.off("userConnected", _userConnectedHookId);
        _userConnectedHookId = null;
    }

    _cachedCursorDataUrl = null;
    _cachedHotspotX = 0;
    _cachedHotspotY = 0;

    debugLog("sharing", "Cursor sharing stopped");
}

export function syncHiddenRemoteCursors() {
    for (const userId of getHiddenSharedCursorUserIds()) {
        removeRemoteCursor(userId);
    }
    if (_active) _requestCursorImages();
}

export function getCursorSharingDebugState() {
    return {
        active: _active,
        broadcastEnabled: _broadcastEnabled,
        registeredMouseHandler: _registered,
        hasCachedCursorImage: !!_cachedCursorDataUrl,
        cachedHotspotX: _cachedHotspotX,
        cachedHotspotY: _cachedHotspotY,
        broadcastInFlight: _broadcastInFlight,
        broadcastQueued: _broadcastQueued,
        showCursorPermission: getShowCursorPermissionState(globalThis.game?.user),
        permissionBlocked: _broadcastEnabled && !canBroadcastVisibleCursor(globalThis.game?.user),
        visibleBroadcastAllowed: _broadcastEnabled && canBroadcastVisibleCursor(globalThis.game?.user),
        hiddenRemoteUsers: [...getHiddenSharedCursorUserIds()]
    };
}

/**
 * Call this when the user changes their cursor settings to re-broadcast.
 */
export async function refreshSharedCursorImage() {
    if (!_active || !_broadcastEnabled) return;
    if (!_syncVisibleCursorPermission().allowed) return;
    await _broadcastCursorImage();
}

/**
 * Mouse move handler registered with Foundry's canvas system.
 * Receives canvas coordinates (PIXI.Point) from the stage pointer events.
 */
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
        type: "cursorMove",
        userId: game.user.id,
        sceneId: canvas.scene?.id,
        x: currentPos.x,
        y: currentPos.y
    });
}

async function _broadcastCursorImage() {
    if (!_broadcastEnabled) return;
    if (!_syncVisibleCursorPermission().allowed) return;

    // Guard against concurrent async calls — queue a re-run instead of interleaving
    if (_broadcastInFlight) {
        _broadcastQueued = true;
        return;
    }
    _broadcastInFlight = true;

    try {
        const config = getUserCursorConfig(game.user);
        const isCursorEnabled = config.useCustomCursor;
        if (!isCursorEnabled) {
            _cachedCursorDataUrl = null;
            _cachedHotspotX = 0;
            _cachedHotspotY = 0;
            _emitCursorImage(null, 0, 0);
            return;
        }

        const states = config.cursorStates;
        const def = states?.default;
        if (!def?.image) {
            _cachedCursorDataUrl = null;
            _cachedHotspotX = 0;
            _cachedHotspotY = 0;
            _emitCursorImage(null, 0, 0);
            return;
        }

        const rotation = def.rotation || 0;
        const targetWidth = def.width || 0;
        const targetHeight = def.height || 0;

        // Process the cursor image (apply rotation/resize if needed)
        if (rotation !== 0 || targetWidth > 0 || targetHeight > 0) {
            const processed = await getRotatedCursor(def.image, def.hotspotX, def.hotspotY, rotation, targetWidth, targetHeight);
            if (processed) {
                _cachedCursorDataUrl = processed.dataUrl;
                _cachedHotspotX = processed.hotspotX;
                _cachedHotspotY = processed.hotspotY;
                _emitCursorImage(_cachedCursorDataUrl, _cachedHotspotX, _cachedHotspotY);
                return;
            }
        }

        // No rotation/resize — convert original image to data URL
        const img = await loadImage(def.image);
        const cvs = document.createElement('canvas');
        cvs.width = img.width;
        cvs.height = img.height;
        cvs.getContext('2d').drawImage(img, 0, 0);
        _cachedCursorDataUrl = cvs.toDataURL('image/png');
        _cachedHotspotX = def.hotspotX;
        _cachedHotspotY = def.hotspotY;
        if (_broadcastEnabled) _emitCursorImage(_cachedCursorDataUrl, _cachedHotspotX, _cachedHotspotY);
    } catch (e) {
        console.warn(`${MODULE_ID} | Failed to build shared cursor image:`, e);
        _cachedCursorDataUrl = null;
        _cachedHotspotX = 0;
        _cachedHotspotY = 0;
        _emitCursorImage(null, 0, 0);
    } finally {
        _broadcastInFlight = false;
        if (_broadcastQueued) {
            _broadcastQueued = false;
            _broadcastCursorImage();
        }
    }
}

function _emitCursorImage(dataUrl, hotspotX, hotspotY) {
    if (!_broadcastEnabled) return;
    if (!_syncVisibleCursorPermission().allowed) return;

    // Include name position settings so other clients position the label correctly
    let namePosition = "bottom-center";
    let nameOffset = { x: 0, y: 1.2 };
    try {
        const config = getUserCursorConfig(game.user);
        namePosition = config.namePosition;
        nameOffset = config.nameOffset;
    } catch { /* use defaults */ }

    game.socket.emit(SOCKET_EVENT, {
        type: "cursorImage",
        userId: game.user.id,
        playerName: game.user.name,
        imageDataUrl: dataUrl,
        hotspotX,
        hotspotY,
        namePosition,
        nameOffset
    });
    debugLog("sharing", "Broadcast cursor image", dataUrl ? `(${dataUrl.length} bytes)` : "(cleared)");
}

function _emitCursorHidden() {
    game.socket.emit(SOCKET_EVENT, {
        type: "cursorHidden",
        userId: game.user.id
    });
    debugLog("sharing", "Broadcast cursor hidden");
}

function _requestCursorImages(targetUserId = null) {
    game.socket.emit(SOCKET_EVENT, {
        type: "requestCursorImage",
        userId: game.user.id,
        targetUserId
    });
    debugLog("sharing", targetUserId ? `Requested cursor image from ${targetUserId}` : "Requested cursor images from active peers");
}

function _onSocketMessage(data) {
    debugSocketMessage(data);
    if (data.type === "cursorMove") {
        if (data.userId === game.user.id) return;
        if (!_canShowRemoteSharedCursor(data.userId)) {
            removeRemoteCursor(data.userId);
            return;
        }
        if (data.sceneId !== canvas.scene?.id) return;
        updateRemoteCursor(data.userId, data.x, data.y, { source: "module" });
    } else if (data.type === "cursorImage") {
        if (data.userId === game.user.id) return;
        if (!_canShowRemoteSharedCursor(data.userId)) {
            removeRemoteCursor(data.userId);
            return;
        }
        updateRemoteCursorImage(
            data.userId,
            data.imageDataUrl,
            data.hotspotX,
            data.hotspotY,
            data.playerName,
            data.namePosition,
            data.nameOffset
        );
    } else if (data.type === "cursorHidden") {
        if (data.userId === game.user.id) return;
        removeRemoteCursor(data.userId);
    } else if (data.type === "hiddenPing") {
        if (data.userId === game.user.id) return;
        if (data.sceneId !== canvas.scene?.id) return;
        const user = game.users.get(data.userId);
        if (!user || !canvas.ready || !data.position) return;
        canvas.controls.handlePing(user, data.position, data.ping ?? {});
    } else if (data.type === "requestCursorImage") {
        if (data.userId === game.user.id) return;
        if (data.targetUserId && data.targetUserId !== game.user.id) return;
        if (!_broadcastEnabled) return;
        // Another user is asking us for our cursor image
        if (_broadcastEnabled && _syncVisibleCursorPermission().allowed) _emitCursorImage(_cachedCursorDataUrl, _cachedHotspotX, _cachedHotspotY);
        else _emitCursorHidden();
    }
}

function _onFoundryUserActivity(userId, activityData = {}) {
    if (!_active || userId === game.user.id) return;
    if (!_canShowRemoteSharedCursor(userId)) {
        removeRemoteCursor(userId);
        return;
    }

    if (activityData.active === false) {
        removeRemoteCursor(userId);
        return;
    }

    const sceneId = activityData.sceneId ?? game.users.get(userId)?.viewedScene;
    if (sceneId && sceneId !== canvas.scene?.id) {
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

    updateRemoteCursor(userId, x, y, { source: "native" });
}

function _onUserConnected(user, connected) {
    if (user.id === game.user.id) return;
    if (!connected) {
        removeRemoteCursor(user.id);
        debugLog("sharing", `User disconnected: ${user.name}`);
    } else {
        // New user joined — send them our cursor image
        if (_broadcastEnabled && _syncVisibleCursorPermission().allowed) {
            _emitCursorImage(_cachedCursorDataUrl, _cachedHotspotX, _cachedHotspotY);
        }
        // Request their cursor image
        if (_canShowRemoteSharedCursor(user.id)) _requestCursorImages(user.id);
        debugLog("sharing", `User connected: ${user.name}, exchanging cursor images`);
    }
}
