import { MODULE_ID, CURSOR_POINTER_SIZE, CURSOR_FADE_TIMEOUT_MS, CURSOR_LERP_SPEED, debugLog } from './constants.js';

let _container = null;
const _cursors = new Map();
let _tickerCallback = null;

export function initCursorOverlay() {
    if (_container) {
        console.log(`${MODULE_ID} | [DIAG] initCursorOverlay: already initialized, skipping`);
        return;
    }
    _container = new PIXI.Container();
    _container.name = "ttb-cursor-sharing";
    _container.eventMode = "none";
    canvas.controls.addChild(_container);

    _tickerCallback = () => _tick();
    canvas.app.ticker.add(_tickerCallback);
    console.log(`${MODULE_ID} | [DIAG] initCursorOverlay: container added to canvas.controls, parent=${_container.parent?.name || 'unknown'}, visible=${_container.visible}`);
}

export function destroyCursorOverlay() {
    if (_tickerCallback) {
        canvas.app.ticker.remove(_tickerCallback);
        _tickerCallback = null;
    }
    if (_container) {
        _container.destroy({ children: true });
        _container = null;
    }
    _cursors.clear();
    debugLog("sharing", "Cursor overlay destroyed");
}

let _updateLogCount = 0;
export function updateRemoteCursor(userId, worldX, worldY) {
    if (!_container) {
        if (_updateLogCount < 3) console.log(`${MODULE_ID} | [DIAG] updateRemoteCursor: no container!`);
        return;
    }
    if (userId === game.user.id) {
        if (_updateLogCount < 3) console.log(`${MODULE_ID} | [DIAG] updateRemoteCursor: ignoring own cursor`);
        return;
    }

    const entry = _getOrCreateCursor(userId);
    if (!entry) {
        if (_updateLogCount < 3) console.log(`${MODULE_ID} | [DIAG] updateRemoteCursor: failed to create cursor for ${userId}`);
        return;
    }

    if (_updateLogCount < 5) {
        _updateLogCount++;
        console.log(`${MODULE_ID} | [DIAG] updateRemoteCursor #${_updateLogCount}: userId=${userId}, pos=(${worldX.toFixed(1)}, ${worldY.toFixed(1)}), containerVisible=${entry.container.visible}, parentVisible=${_container.visible}`);
    }

    entry.targetX = worldX;
    entry.targetY = worldY;
    entry.container.alpha = 1;
    entry.container.visible = true;
    entry.lastUpdate = Date.now();

    // On first update, snap directly to position
    if (!entry.initialized) {
        entry.container.position.set(worldX, worldY);
        entry.initialized = true;
        console.log(`${MODULE_ID} | [DIAG] updateRemoteCursor: FIRST position set for ${userId} at (${worldX.toFixed(1)}, ${worldY.toFixed(1)})`);
    }
}

export function updateRemoteCursorImage(userId, imageDataUrl, hotspotX, hotspotY) {
    if (!_container) return;
    if (userId === game.user.id) return;

    const entry = _cursors.get(userId);
    if (!entry) {
        // Store pending image data for when cursor is created
        _pendingImages.set(userId, { imageDataUrl, hotspotX, hotspotY });
        return;
    }

    _applyCursorImage(entry, imageDataUrl, hotspotX, hotspotY);
}

const _pendingImages = new Map();

export function removeRemoteCursor(userId) {
    const entry = _cursors.get(userId);
    if (entry) {
        entry.container.destroy({ children: true });
        _cursors.delete(userId);
        debugLog("sharing", `Removed cursor for user ${userId}`);
    }
    _pendingImages.delete(userId);
}

function _getOrCreateCursor(userId) {
    if (_cursors.has(userId)) return _cursors.get(userId);

    const user = game.users.get(userId);
    if (!user) return null;

    const color = user.color;
    const s = CURSOR_POINTER_SIZE;

    // Arrow pointer shape (default fallback)
    const g = new PIXI.Graphics();
    g.beginFill(color, 0.85);
    g.lineStyle(1, 0x000000, 0.5);
    g.moveTo(0, 0);
    g.lineTo(s * 0.4, s);
    g.lineTo(0, s * 0.75);
    g.lineTo(-s * 0.15, s);
    g.closePath();
    g.endFill();

    // Name label
    const text = new PIXI.Text(user.name, {
        fontFamily: "Signika",
        fontSize: 14,
        fill: color,
        stroke: 0x000000,
        strokeThickness: 2
    });
    text.anchor.set(0, 0);
    text.position.set(s * 0.5, s * 0.6);

    const cursorContainer = new PIXI.Container();
    cursorContainer.addChild(g, text);
    cursorContainer.eventMode = "none";
    _container.addChild(cursorContainer);

    const entry = {
        container: cursorContainer,
        arrow: g,
        text,
        sprite: null,
        targetX: 0,
        targetY: 0,
        initialized: false,
        lastUpdate: Date.now()
    };
    _cursors.set(userId, entry);
    debugLog("sharing", `Created cursor for ${user.name}`);

    // Apply pending custom image if one was received before cursor creation
    const pending = _pendingImages.get(userId);
    if (pending) {
        _applyCursorImage(entry, pending.imageDataUrl, pending.hotspotX, pending.hotspotY);
        _pendingImages.delete(userId);
    }

    return entry;
}

function _applyCursorImage(entry, imageDataUrl, hotspotX, hotspotY) {
    // Remove old sprite if exists
    if (entry.sprite) {
        entry.container.removeChild(entry.sprite);
        entry.sprite.destroy();
        entry.sprite = null;
    }

    if (!imageDataUrl) {
        // Revert to arrow
        entry.arrow.visible = true;
        return;
    }

    const img = new Image();
    img.onload = () => {
        if (!entry.container || entry.container.destroyed) return;

        const texture = PIXI.Texture.from(img);
        const sprite = new PIXI.Sprite(texture);

        // Position sprite so the hotspot aligns with (0,0) of the container
        sprite.anchor.set(
            hotspotX / img.width,
            hotspotY / img.height
        );

        entry.sprite = sprite;
        entry.arrow.visible = false;
        entry.container.addChildAt(sprite, 0);

        debugLog("sharing", `Applied custom cursor image for user, size=${img.width}x${img.height}`);
    };
    img.src = imageDataUrl;
}

function _tick() {
    const now = Date.now();
    const zoom = canvas.stage.scale.x || 1;
    const cursorSize = game.settings.get(MODULE_ID, "shared-cursor-size") || 32;
    const showNames = game.settings.get(MODULE_ID, "show-cursor-names");
    // Scale cursors to maintain consistent screen size regardless of zoom
    const worldScale = cursorSize / (CURSOR_POINTER_SIZE * zoom);

    for (const [, entry] of _cursors) {
        // Toggle name label visibility
        entry.text.visible = showNames;
        // Smooth interpolation toward target position
        if (entry.initialized) {
            const cx = entry.container.position.x;
            const cy = entry.container.position.y;
            const dx = entry.targetX - cx;
            const dy = entry.targetY - cy;

            // Snap if very close, otherwise lerp
            if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
                entry.container.position.set(entry.targetX, entry.targetY);
            } else {
                entry.container.position.set(
                    cx + dx * CURSOR_LERP_SPEED,
                    cy + dy * CURSOR_LERP_SPEED
                );
            }
        }

        // Apply zoom-compensating scale
        entry.container.scale.set(worldScale);

        // Fade out after timeout
        const elapsed = now - entry.lastUpdate;
        if (elapsed > CURSOR_FADE_TIMEOUT_MS) {
            const fadeElapsed = elapsed - CURSOR_FADE_TIMEOUT_MS;
            entry.container.alpha = Math.max(0, 1 - fadeElapsed / 1000);
            if (entry.container.alpha <= 0) {
                entry.container.visible = false;
            }
        }
    }
}
