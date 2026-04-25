import { MODULE_ID, CURSOR_POINTER_SIZE, CURSOR_FADE_TIMEOUT_MS, CURSOR_LERP_SPEED, NAME_POSITION_PRESETS, debugLog } from './constants.js';

let _container = null;
const _cursors = new Map();
const _pendingImages = new Map();
let _tickerCallback = null;
let _imageLoadSerial = 0;

// Cached settings — updated via onChange callbacks, avoids per-frame game.settings.get()
const _settings = {
    cursorSize: 16,
    cursorOpacity: 1,
    showNames: false,
    foundryCursorDisplay: "both",
    idleIdentityFade: false,
    disableCursorFade: false,
    namePosition: "bottom-center",
    nameOffset: { x: 0, y: 1.2 }
};

export function updateOverlaySetting(key, value) {
    _settings[key] = value;
    // Invalidate foundry cursor cache when display setting changes
    if (key === "foundryCursorDisplay") { _lastFoundryNames = null; _lastFoundryDots = null; }
    // Invalidate name positioning when name-related settings change
    if (key === "namePosition" || key === "nameOffset" || key === "showNames") {
        for (const [, entry] of _cursors) entry.nameDirty = true;
    }
}

export function initCursorOverlay() {
    if (_container) {
        debugLog("sharing", "initCursorOverlay: already initialized, skipping");
        return;
    }
    _container = new PIXI.Container();
    _container.name = "ttb-cursor-sharing";
    _container.eventMode = "none";
    canvas.controls.addChild(_container);

    _tickerCallback = () => _tick();
    canvas.app.ticker.add(_tickerCallback);
    debugLog("sharing", `initCursorOverlay: container added to canvas.controls, parent=${_container.parent?.name || 'unknown'}, visible=${_container.visible}`);
}

export function destroyCursorOverlay() {
    if (_tickerCallback) {
        canvas.app.ticker.remove(_tickerCallback);
        _tickerCallback = null;
    }
    // Destroy sprite textures before container teardown to prevent cache leaks
    for (const [, entry] of _cursors) {
        if (entry.sprite) {
            entry.sprite.destroy({ texture: true, baseTexture: true });
            entry.sprite = null;
        }
    }
    if (_container) {
        _container.destroy({ children: true });
        _container = null;
    }
    _cursors.clear();
    _pendingImages.clear();
    _lastFoundryNames = null;
    _lastFoundryDots = null;
    debugLog("sharing", "Cursor overlay destroyed");
}

export function updateRemoteCursor(userId, worldX, worldY) {
    if (!_container) {
        debugLog("sharing", "updateRemoteCursor: no container!");
        return;
    }
    if (userId === game.user.id) return;

    const entry = _getOrCreateCursor(userId);
    if (!entry) {
        debugLog("sharing", `updateRemoteCursor: failed to create cursor for ${userId}`);
        return;
    }

    debugLog("sharing", `updateRemoteCursor: userId=${userId}, pos=(${worldX.toFixed(1)}, ${worldY.toFixed(1)})`);

    entry.targetX = worldX;
    entry.targetY = worldY;
    entry.container.alpha = 1;
    entry.container.visible = true;
    entry.lastUpdate = Date.now();

    // On first update, snap directly to position
    if (!entry.initialized) {
        entry.container.position.set(worldX, worldY);
        entry.initialized = true;
        debugLog("sharing", `updateRemoteCursor: FIRST position set for ${userId} at (${worldX.toFixed(1)}, ${worldY.toFixed(1)})`);
    }
}

export function updateRemoteCursorImage(userId, imageDataUrl, hotspotX, hotspotY, playerName, namePosition, nameOffset) {
    if (userId === game.user.id) return;

    const entry = _cursors.get(userId);
    if (!_container || !entry) {
        // Store pending image data for when cursor is created
        _pendingImages.set(userId, { imageDataUrl, hotspotX, hotspotY, playerName, namePosition, nameOffset });
        return;
    }

    _setCursorLabel(entry, playerName);

    // Store per-cursor name position from the cursor owner's settings
    if (namePosition) entry.namePosition = namePosition;
    if (nameOffset) entry.nameOffset = nameOffset;
    entry.nameDirty = true;

    _applyCursorImage(entry, imageDataUrl, hotspotX, hotspotY);
}

export function removeRemoteCursor(userId) {
    const entry = _cursors.get(userId);
    if (entry) {
        if (entry.sprite) {
            entry.container.removeChild(entry.sprite);
            entry.sprite.destroy({ texture: true, baseTexture: true });
            entry.sprite = null;
        }
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
    text.anchor.set(0.5, 0);
    text.position.set(0, s * 1.2);

    // Idle identity elements — shown when cursor fades out and setting is enabled
    const idleDot = new PIXI.Graphics();
    idleDot.beginFill(color, 1);
    idleDot.drawCircle(0, 0, 6);
    idleDot.endFill();
    idleDot.lineStyle(1, 0x000000, 0.5);
    idleDot.drawCircle(0, 0, 6);
    idleDot.visible = false;

    const idleText = new PIXI.Text(user.name, {
        fontFamily: "Signika",
        fontSize: 14,
        fill: color,
        stroke: 0x000000,
        strokeThickness: 2
    });
    idleText.anchor.set(0.5, 0);
    idleText.position.set(0, 10);
    idleText.visible = false;

    const cursorContainer = new PIXI.Container();
    cursorContainer.addChild(g, text, idleDot, idleText);
    cursorContainer.eventMode = "none";
    _container.addChild(cursorContainer);

    const entry = {
        container: cursorContainer,
        arrow: g,
        text,
        idleDot,
        idleText,
        sprite: null,
        playerName: user.name,
        targetX: 0,
        targetY: 0,
        initialized: false,
        lastUpdate: Date.now(),
        baseSize: CURSOR_POINTER_SIZE,
        namePosition: null,
        nameOffset: null,
        nameDirty: true,
        imageLoadId: 0
    };
    _cursors.set(userId, entry);
    debugLog("sharing", `Created cursor for ${user.name}`);

    // Apply pending custom image if one was received before cursor creation
    const pending = _pendingImages.get(userId);
    if (pending) {
        _setCursorLabel(entry, pending.playerName);
        if (pending.namePosition) entry.namePosition = pending.namePosition;
        if (pending.nameOffset) entry.nameOffset = pending.nameOffset;
        _applyCursorImage(entry, pending.imageDataUrl, pending.hotspotX, pending.hotspotY);
        _pendingImages.delete(userId);
    }

    return entry;
}

function _setCursorLabel(entry, playerName) {
    if (typeof playerName !== "string" || !playerName.length) return;
    entry.playerName = playerName;
    entry.text.text = playerName;
    entry.idleText.text = playerName;
}

function _applyCursorImage(entry, imageDataUrl, hotspotX, hotspotY) {
    const imageLoadId = ++_imageLoadSerial;
    entry.imageLoadId = imageLoadId;

    // Remove old sprite and its texture to prevent PIXI texture cache leaks
    if (entry.sprite) {
        entry.container.removeChild(entry.sprite);
        entry.sprite.destroy({ texture: true, baseTexture: true });
        entry.sprite = null;
    }

    if (!imageDataUrl) {
        // Revert to arrow
        entry.arrow.visible = true;
        entry.baseSize = CURSOR_POINTER_SIZE;
        entry.nameDirty = true;
        return;
    }

    const img = new Image();
    img.onload = () => {
        if (!entry.container || entry.container.destroyed) return;
        if (entry.imageLoadId !== imageLoadId) return;

        const texture = PIXI.Texture.from(img);
        const sprite = new PIXI.Sprite(texture);

        // Position sprite so the hotspot aligns with (0,0) of the container
        sprite.anchor.set(
            hotspotX / img.width,
            hotspotY / img.height
        );

        entry.sprite = sprite;
        entry.arrow.visible = false;
        entry.baseSize = Math.max(img.width, img.height) || CURSOR_POINTER_SIZE;
        entry.container.addChildAt(sprite, 0);
        entry.nameDirty = true;

        debugLog("sharing", `Applied custom cursor image for user, size=${img.width}x${img.height}`);
    };
    img.onerror = () => {
        if (entry.imageLoadId !== imageLoadId) return;
        console.warn(`${MODULE_ID} | Failed to load shared cursor image`);
        entry.arrow.visible = true;
        entry.baseSize = CURSOR_POINTER_SIZE;
        entry.nameDirty = true;
    };
    img.src = imageDataUrl;
}

// Cached values to avoid redundant per-frame work
let _lastFoundryNames = null;
let _lastFoundryDots = null;

function _updateFoundryCursors(showFoundryNames, showFoundryDots) {
    const foundryCursors = canvas.controls?.cursors;
    if (!foundryCursors) return;
    for (const cursor of foundryCursors.children) {
        if (!cursor.children) continue;
        for (const child of cursor.children) {
            if (child instanceof PIXI.Graphics) {
                child.visible = showFoundryDots;
            } else if (child instanceof PIXI.Text) {
                child.visible = showFoundryNames;
            }
        }
    }
}

function _tick() {
    const now = Date.now();
    const zoom = canvas.stage.scale.x || 1;
    const { cursorSize, cursorOpacity, showNames, foundryCursorDisplay, namePosition, nameOffset } = _settings;

    // Only update Foundry's native cursor elements when the setting actually changes
    const showFoundryNames = foundryCursorDisplay === "both" || foundryCursorDisplay === "names-only";
    const showFoundryDots = foundryCursorDisplay === "both" || foundryCursorDisplay === "dots-only";
    if (showFoundryNames !== _lastFoundryNames || showFoundryDots !== _lastFoundryDots) {
        _lastFoundryNames = showFoundryNames;
        _lastFoundryDots = showFoundryDots;
        _updateFoundryCursors(showFoundryNames, showFoundryDots);
    }

    for (const [, entry] of _cursors) {
        // Toggle module overlay name label visibility and position
        // Only recalculate positioning when something changed (nameDirty flag)
        if (showNames) {
            if (entry.nameDirty) {
                const s = CURSOR_POINTER_SIZE;
                const cursorNamePos = entry.namePosition || namePosition;
                const cursorNameOff = entry.nameOffset || nameOffset;

                // The config preview positions the name relative to the image center,
                // but the container origin (0,0) is the hotspot. Compute the offset
                // from hotspot to image center so positions match the preview.
                let centerOffX = 0, centerOffY = 0;
                if (entry.sprite && entry.sprite.texture) {
                    const sw = entry.sprite.texture.width;
                    const sh = entry.sprite.texture.height;
                    centerOffX = sw * (0.5 - entry.sprite.anchor.x);
                    centerOffY = sh * (0.5 - entry.sprite.anchor.y);
                }

                if (cursorNamePos === "custom") {
                    entry.text.anchor.set(0.5, 0);
                    entry.text.position.set(centerOffX + s * cursorNameOff.x, centerOffY + s * cursorNameOff.y);
                } else {
                    const preset = NAME_POSITION_PRESETS[cursorNamePos];
                    if (preset) {
                        entry.text.anchor.set(preset.anchorX, preset.anchorY);
                        let posX = centerOffX + s * preset.offsetX;
                        let posY = centerOffY + s * preset.offsetY;

                        // For sprites, clamp so the name doesn't overlap the image
                        if (entry.sprite && entry.sprite.texture) {
                            const sw = entry.sprite.texture.width;
                            const sh = entry.sprite.texture.height;
                            const gap = s * 0.2;
                            // Push past bottom edge for bottom-anchored labels (anchorY 0 = text top at pos)
                            if (preset.anchorY === 0) {
                                posY = Math.max(posY, sh * (1 - entry.sprite.anchor.y) + gap);
                            }
                            // Push above top edge for top-anchored labels (anchorY 1 = text bottom at pos)
                            if (preset.anchorY === 1) {
                                posY = Math.min(posY, -sh * entry.sprite.anchor.y - gap);
                            }
                            // Push past right edge for left-anchored labels (anchorX 0 = text left at pos)
                            if (preset.anchorX === 0) {
                                posX = Math.max(posX, sw * (1 - entry.sprite.anchor.x) + gap);
                            }
                        }

                        entry.text.position.set(posX, posY);
                    }
                }
                entry.nameDirty = false;
            }
            entry.text.visible = true;
        } else {
            entry.text.visible = false;
        }
        // Smooth interpolation toward target position (matches Foundry's native dx/10 approach)
        if (entry.initialized) {
            const cx = entry.container.position.x;
            const cy = entry.container.position.y;
            const dx = entry.targetX - cx;
            const dy = entry.targetY - cy;

            // Snap if very close, otherwise lerp (matching Foundry's snap threshold)
            if (Math.abs(dx) + Math.abs(dy) < 0.5 / (CONFIG.Canvas.maxZoom || 3)) {
                entry.container.position.set(entry.targetX, entry.targetY);
            } else {
                entry.container.position.set(
                    cx + dx * CURSOR_LERP_SPEED,
                    cy + dy * CURSOR_LERP_SPEED
                );
            }
        }

        // Apply zoom-compensating scale
        const baseSize = entry.baseSize || CURSOR_POINTER_SIZE;
        const worldScale = cursorSize / (baseSize * zoom);
        entry.container.scale.set(worldScale);

        // Apply base opacity, with fade-out after timeout
        // When idle identity fade is enabled, use per-element alpha so hidden
        // Foundry elements (dot/name) can fade IN while the cursor fades OUT.
        const elapsed = now - entry.lastUpdate;
        const { disableCursorFade, idleIdentityFade } = _settings;
        const isFading = !disableCursorFade && elapsed > CURSOR_FADE_TIMEOUT_MS;
        // Determine which idle elements should appear (only the ones normally hidden)
        const shouldIdleDot = idleIdentityFade && (foundryCursorDisplay === "none" || foundryCursorDisplay === "names-only");
        const shouldIdleName = idleIdentityFade && (foundryCursorDisplay === "none" || foundryCursorDisplay === "dots-only");
        const hasIdleElements = shouldIdleDot || shouldIdleName;

        if (isFading) {
            const fadeElapsed = elapsed - CURSOR_FADE_TIMEOUT_MS;
            const fadeOutAlpha = Math.max(0, cursorOpacity * (1 - fadeElapsed / 1000));

            if (hasIdleElements) {
                // Per-element alpha: cursor fades out, idle identity fades in
                const fadeInAlpha = Math.min(cursorOpacity, fadeElapsed / 1000);
                entry.container.alpha = 1;

                // Fade out cursor visuals
                if (entry.sprite) entry.sprite.alpha = fadeOutAlpha;
                entry.arrow.alpha = fadeOutAlpha;
                if (showNames) entry.text.alpha = fadeOutAlpha;

                // Fade in idle identity elements
                entry.idleDot.visible = shouldIdleDot;
                entry.idleDot.alpha = shouldIdleDot ? fadeInAlpha : 0;
                entry.idleText.visible = shouldIdleName;
                entry.idleText.alpha = shouldIdleName ? fadeInAlpha : 0;

                // Keep container visible as long as idle elements are showing
                entry.container.visible = true;
            } else {
                // Original behavior — container-level fade
                entry.container.alpha = fadeOutAlpha;
                entry.idleDot.visible = false;
                entry.idleText.visible = false;
                if (fadeOutAlpha <= 0) {
                    entry.container.visible = false;
                }
            }
        } else {
            // Active cursor — full opacity, hide idle elements, reset per-element alphas
            entry.container.alpha = cursorOpacity;
            if (entry.sprite) entry.sprite.alpha = 1;
            entry.arrow.alpha = 1;
            if (showNames) entry.text.alpha = 1;
            entry.idleDot.visible = false;
            entry.idleText.visible = false;
        }
    }
}
