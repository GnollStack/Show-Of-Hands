import { MODULE_ID, SOCKET_EVENT, CURSOR_SHARE_THROTTLE_MS, debugLog } from './constants.js';
import { updateRemoteCursor, updateRemoteCursorImage, removeRemoteCursor } from './cursor-overlay.js';
import { loadImage, getRotatedCursor } from './cursor-styles.js';

let _active = false;
let _registered = false;
let _lastBroadcast = 0;
let _moveLogCount = 0;
let _userConnectedHookId = null;
let _cachedCursorDataUrl = null;
let _cachedHotspotX = 0;
let _cachedHotspotY = 0;

export function startCursorSharing() {
    console.log(`${MODULE_ID} | [DIAG] startCursorSharing called, _active=${_active}, _registered=${_registered}`);
    if (_active) return;
    _active = true;

    // Listen for our module's socket messages (cursor images + position)
    game.socket.on(SOCKET_EVENT, _onSocketMessage);
    console.log(`${MODULE_ID} | [DIAG] Registered socket listener on "${SOCKET_EVENT}"`);

    // Register a mouse move handler using Foundry's canvas system.
    // This receives canvas coordinates directly from PIXI pointer events.
    // Registration is permanent (no unregister API), so we only do it once
    // and gate on _active inside the handler.
    if (!_registered) {
        canvas.registerMouseMoveHandler(_onCanvasMouseMove, 0);
        _registered = true;
        console.log(`${MODULE_ID} | [DIAG] Registered canvas mouse move handler`);
    }

    _userConnectedHookId = Hooks.on("userConnected", _onUserConnected);

    // Build and broadcast our custom cursor image
    _broadcastCursorImage();

    console.log(`${MODULE_ID} | [DIAG] Cursor sharing started successfully`);
}

export function stopCursorSharing() {
    if (!_active) return;
    _active = false;

    game.socket.off(SOCKET_EVENT, _onSocketMessage);

    if (_userConnectedHookId !== null) {
        Hooks.off("userConnected", _userConnectedHookId);
        _userConnectedHookId = null;
    }

    _cachedCursorDataUrl = null;

    debugLog("sharing", "Cursor sharing stopped");
}

/**
 * Call this when the user changes their cursor settings to re-broadcast.
 */
export async function refreshSharedCursorImage() {
    if (!_active) return;
    await _broadcastCursorImage();
}

/**
 * Mouse move handler registered with Foundry's canvas system.
 * Receives canvas coordinates (PIXI.Point) from the stage pointer events.
 */
function _onCanvasMouseMove(currentPos) {
    if (!_active) return;

    const now = performance.now();
    if (now - _lastBroadcast < CURSOR_SHARE_THROTTLE_MS) return;
    _lastBroadcast = now;

    // Log first 5 emissions to confirm handler fires and coords are sane
    if (_moveLogCount < 5) {
        _moveLogCount++;
        console.log(`${MODULE_ID} | [DIAG] Mouse move #${_moveLogCount}: emitting cursorMove at (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}), scene=${canvas.scene?.id}`);
    }

    game.socket.emit(SOCKET_EVENT, {
        type: "cursorMove",
        userId: game.user.id,
        sceneId: canvas.scene?.id,
        x: currentPos.x,
        y: currentPos.y
    });
}

async function _broadcastCursorImage() {
    try {
        const isCursorEnabled = game.settings.get(MODULE_ID, "use-custom-cursor");
        if (!isCursorEnabled) {
            _cachedCursorDataUrl = null;
            _emitCursorImage(null, 0, 0);
            return;
        }

        const states = game.settings.get(MODULE_ID, "cursor-states");
        const def = states?.default;
        if (!def?.image) {
            _cachedCursorDataUrl = null;
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
        _emitCursorImage(_cachedCursorDataUrl, _cachedHotspotX, _cachedHotspotY);
    } catch (e) {
        console.warn(`${MODULE_ID} | Failed to build shared cursor image:`, e);
        _cachedCursorDataUrl = null;
    }
}

function _emitCursorImage(dataUrl, hotspotX, hotspotY) {
    game.socket.emit(SOCKET_EVENT, {
        type: "cursorImage",
        userId: game.user.id,
        imageDataUrl: dataUrl,
        hotspotX,
        hotspotY
    });
    debugLog("sharing", "Broadcast cursor image", dataUrl ? `(${dataUrl.length} bytes)` : "(cleared)");
}

let _recvLogCount = 0;
function _onSocketMessage(data) {
    // Log first 5 received messages per type
    if (_recvLogCount < 5) {
        _recvLogCount++;
        console.log(`${MODULE_ID} | [DIAG] Socket received #${_recvLogCount}: type=${data.type}, userId=${data.userId}, myId=${game.user.id}, sceneId=${data.sceneId}, myScene=${canvas.scene?.id}`);
    }
    if (data.type === "cursorMove") {
        if (data.sceneId !== canvas.scene?.id) return;
        updateRemoteCursor(data.userId, data.x, data.y);
    } else if (data.type === "cursorImage") {
        updateRemoteCursorImage(data.userId, data.imageDataUrl, data.hotspotX, data.hotspotY);
    } else if (data.type === "requestCursorImage") {
        // Another user is asking us for our cursor image
        if (_cachedCursorDataUrl) {
            _emitCursorImage(_cachedCursorDataUrl, _cachedHotspotX, _cachedHotspotY);
        }
    }
}

function _onUserConnected(user, connected) {
    if (!connected) {
        removeRemoteCursor(user.id);
        debugLog("sharing", `User disconnected: ${user.name}`);
    } else {
        // New user joined — send them our cursor image
        if (_cachedCursorDataUrl) {
            _emitCursorImage(_cachedCursorDataUrl, _cachedHotspotX, _cachedHotspotY);
        }
        // Request their cursor image
        game.socket.emit(SOCKET_EVENT, {
            type: "requestCursorImage",
            userId: game.user.id
        });
        debugLog("sharing", `User connected: ${user.name}, exchanging cursor images`);
    }
}
