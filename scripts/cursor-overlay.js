/**
 * @file cursor-overlay.js
 * @description PIXI overlay for rendering remote Show of Hands cursors inside
 * Foundry's screen-space cursor layer.
 */

import { MODULE_ID, CURSOR_POINTER_SIZE, CURSOR_FADE_TIMEOUT_MS, CURSOR_LERP_SPEED, NAME_LABEL_OFFSET_SCALE, debugLog } from './constants.js';
import { computeOverlayNamePlacement, stepCursorLerp } from './cursor-geometry-core.js';
import { canBroadcastVisibleCursor } from './foundry-permissions.js';
import {
    MAX_CURSOR_IMAGE_DIMENSION,
    getCursorImageDataUrlDimensions,
    isSocketMessageForCurrentView,
    isValidCursorImageDimensions
} from './socket-messages.js';

let _container = null;
const _cursors = new Map();
const _pendingImages = new Map();
const _pendingPositions = new Map();
let _tickerCallback = null;
let _imageLoadSerial = 0;
const MOVEMENT_SOURCE_NATIVE = "native";

// Settings cache filled by onChange callbacks. The ticker reads this instead
// of calling game.settings every frame.
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
    // Foundry owns its cursor PIXI children. Mark the cache dirty only when a
    // display setting can affect them.
    if (key === "foundryCursorDisplay") {
        _lastFoundryNames = null;
        _lastFoundryDots = null;
        _markFoundryChildrenDirty();
    }
    // Name placement depends on owner profile plus viewer settings, so each
    // entry gets recomputed lazily.
    if (key === "namePosition" || key === "nameOffset" || key === "showNames" || key === "cursorSize") {
        for (const [, entry] of _cursors) entry.nameDirty = true;
    }
}

export function getCursorOverlayDebugState() {
    const parent = _getOverlayParent();
    return {
        initialized: !!(_container && !_container.destroyed),
        parentAvailable: !!parent,
        attachedToParent: !!(_container && !_container.destroyed && _container.parent === parent),
        cursorCount: _cursors.size,
        pendingImageCount: _pendingImages.size,
        pendingPositionCount: _pendingPositions.size,
        tickerActive: !!_tickerCallback
    };
}

export function initCursorOverlay() {
    const parent = _getOverlayParent();
    const wasInitialized = !!(_container && !_container.destroyed && _container.parent === parent);
    if (_ensureOverlayContainer() && wasInitialized) {
        debugLog("sharing", "initCursorOverlay: already initialized, skipping");
    }
}

export function destroyCursorOverlay() {
    if (_tickerCallback) {
        if (canvas?.app?.ticker) canvas.app.ticker.remove(_tickerCallback);
        _tickerCallback = null;
    }
    _updateFoundryCursors(true, true);
    _detachFoundryChildrenListeners();
    _destroyAllCursorEntries();
    if (_container && !_container.destroyed) {
        _container.destroy({ children: true });
    }
    _container = null;
    _cursors.clear();
    _pendingImages.clear();
    _pendingPositions.clear();
    _lastFoundryNames = null;
    _lastFoundryDots = null;
    _lastFoundryChildrenLength = -1;
    _markFoundryChildrenDirty();
    debugLog("sharing", "Cursor overlay destroyed");
}

export function updateRemoteCursor(userId, worldX, worldY, { source = "module" } = {}) {
    if (!_ensureOverlayContainer(false)) {
        debugLog("sharing", "updateRemoteCursor: no container!");
        return;
    }
    if (userId === game.user.id) return;

    if (source === MOVEMENT_SOURCE_NATIVE) {
        // Native movement by itself is not enough to show our fallback arrow.
        // Park it until module metadata or movement authorizes an entry. Once an
        // entry exists, native updates apply directly and need no pending copy.
        if (!_cursors.has(userId)) {
            _pendingPositions.set(userId, { x: worldX, y: worldY, lastUpdate: Date.now() });
            if (!_pendingImages.has(userId)) return;
        }
    }

    const entry = _getOrCreateCursor(userId);
    if (!entry) {
        debugLog("sharing", `updateRemoteCursor: failed to create cursor for ${userId}`);
        return;
    }

    // When Foundry native movement is available, trust it over delayed module
    // packets so the overlay stays with Foundry's dot.
    if (source !== MOVEMENT_SOURCE_NATIVE && entry.nativeMovementSeen) return;
    if (source === MOVEMENT_SOURCE_NATIVE) entry.nativeMovementSeen = true;

    debugLog("sharing", `updateRemoteCursor: userId=${userId}, pos=(${worldX.toFixed(1)}, ${worldY.toFixed(1)})`);

    entry.targetX = worldX;
    entry.targetY = worldY;
    entry.container.alpha = 1;
    entry.container.visible = true;
    entry.lastUpdate = Date.now();

    // First update snaps to avoid lerping in from the origin.
    if (!entry.initialized) {
        entry.currentX = worldX;
        entry.currentY = worldY;
        _projectCursorPosition(entry);
        entry.initialized = true;
        debugLog("sharing", `updateRemoteCursor: FIRST position set for ${userId} at (${worldX.toFixed(1)}, ${worldY.toFixed(1)})`);
    }
}

export function updateRemoteCursorImage(userId, imageDataUrl, hotspotX, hotspotY, playerName, namePosition, nameOffset) {
    if (userId === game.user.id) return;

    _ensureOverlayContainer(false);
    const entry = _cursors.get(userId);
    if (!_container || !entry) {
        // Image data can arrive before movement creates the PIXI entry. Park it
        // so the first real cursor gets the right art.
        _pendingImages.set(userId, { imageDataUrl, hotspotX, hotspotY, playerName, namePosition, nameOffset });
        const pendingPosition = _pendingPositions.get(userId);
        if (pendingPosition) updateRemoteCursor(userId, pendingPosition.x, pendingPosition.y, { source: MOVEMENT_SOURCE_NATIVE });
        return;
    }

    _setCursorLabel(entry, playerName);

    // Use the cursor owner's saved name placement.
    if (namePosition) entry.namePosition = namePosition;
    if (nameOffset) entry.nameOffset = nameOffset;
    entry.nameDirty = true;
    entry.imageDataUrl = imageDataUrl;
    entry.hotspotX = hotspotX;
    entry.hotspotY = hotspotY;

    _applyCursorImage(entry, imageDataUrl, hotspotX, hotspotY);
}

export function removeRemoteCursor(userId) {
    const entry = _cursors.get(userId);
    if (entry) {
        _destroyCursorEntry(entry);
        _cursors.delete(userId);
        debugLog("sharing", `Removed cursor for user ${userId}`);
    }
    _pendingImages.delete(userId);
    _pendingPositions.delete(userId);
}

function _getOrCreateCursor(userId) {
    if (_cursors.has(userId)) return _cursors.get(userId);
    if (!_ensureOverlayContainer(false)) return null;

    const user = game.users.get(userId);
    if (!user) return null;

    const color = user.color;
    const s = CURSOR_POINTER_SIZE;
    const pendingPosition = _pendingPositions.get(userId) ?? null;

    // Fallback arrow shown when a peer has no custom cursor image.
    const g = new PIXI.Graphics();
    g.beginFill(color, 0.85);
    g.lineStyle(1, 0x000000, 0.5);
    g.moveTo(0, 0);
    g.lineTo(s * 0.4, s);
    g.lineTo(0, s * 0.75);
    g.lineTo(-s * 0.15, s);
    g.closePath();
    g.endFill();

    // Show of Hands overlay name label.
    const text = new PIXI.Text(user.name, {
        fontFamily: "Signika",
        fontSize: 14,
        fill: color,
        stroke: 0x000000,
        strokeThickness: 2
    });
    text.anchor.set(0.5, 0);
    text.position.set(0, s * 1.2);

    // Only show idle identity when fade-out is on and the viewer normally hides
    // Foundry's dot or name.
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

    // Scale only cursor artwork. Names and idle identity remain readable at a
    // stable screen-space size even when large source art is reduced.
    const artContainer = new PIXI.Container();
    artContainer.addChild(g);

    const cursorContainer = new PIXI.Container();
    cursorContainer.addChild(artContainer, text, idleDot, idleText);
    cursorContainer.eventMode = "none";
    _container.addChild(cursorContainer);

    const entry = {
        container: cursorContainer,
        artContainer,
        arrow: g,
        text,
        idleDot,
        idleText,
        sprite: null,
        playerName: user.name,
        currentX: pendingPosition?.x ?? 0,
        currentY: pendingPosition?.y ?? 0,
        targetX: pendingPosition?.x ?? 0,
        targetY: pendingPosition?.y ?? 0,
        initialized: !!pendingPosition,
        lastUpdate: pendingPosition?.lastUpdate ?? Date.now(),
        baseSize: CURSOR_POINTER_SIZE,
        namePosition: null,
        nameOffset: null,
        nameDirty: true,
        imageLoadId: 0,
        imageDataUrl: null,
        imageWidth: 0,
        imageHeight: 0,
        hotspotX: 0,
        hotspotY: 0,
        nativeMovementSeen: !!pendingPosition
    };
    _cursors.set(userId, entry);
    if (pendingPosition) {
        _pendingPositions.delete(userId);
        _projectCursorPosition(entry);
    }
    debugLog("sharing", `Created cursor for ${user.name}`);

    // Apply any custom image that arrived before this PIXI entry existed.
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
    if (!entry.container || entry.container.destroyed) return;

    const imageLoadId = ++_imageLoadSerial;
    entry.imageLoadId = imageLoadId;
    entry.imageDataUrl = imageDataUrl;
    entry.hotspotX = hotspotX;
    entry.hotspotY = hotspotY;

    // Destroy the old sprite and texture before replacing it; PIXI otherwise keeps the texture around.
    _destroyCursorSprite(entry);

    if (!imageDataUrl) {
        // Revert to the fallback arrow when the peer clears their custom image.
        entry.arrow.visible = true;
        entry.baseSize = CURSOR_POINTER_SIZE;
        entry.imageWidth = 0;
        entry.imageHeight = 0;
        entry.nameDirty = true;
        return;
    }

    const encodedDimensions = getCursorImageDataUrlDimensions(imageDataUrl);
    if (!encodedDimensions || !isValidCursorImageDimensions(encodedDimensions.width, encodedDimensions.height)) {
        console.warn(`${MODULE_ID} | Rejected malformed or out-of-bounds shared cursor image header (max ${MAX_CURSOR_IMAGE_DIMENSION}px)`);
        entry.imageDataUrl = null;
        entry.arrow.visible = true;
        entry.baseSize = CURSOR_POINTER_SIZE;
        entry.imageWidth = 0;
        entry.imageHeight = 0;
        entry.nameDirty = true;
        return;
    }

    const img = new Image();
    img.onload = () => {
        if (!entry.container || entry.container.destroyed) return;
        if (entry.imageLoadId !== imageLoadId) return;

        const width = Number(img.naturalWidth || img.width);
        const height = Number(img.naturalHeight || img.height);
        if (!isValidCursorImageDimensions(width, height)) {
            console.warn(`${MODULE_ID} | Rejected shared cursor image outside 1-${MAX_CURSOR_IMAGE_DIMENSION}px bounds`);
            entry.imageDataUrl = null;
            entry.arrow.visible = true;
            entry.baseSize = CURSOR_POINTER_SIZE;
            entry.imageWidth = 0;
            entry.imageHeight = 0;
            entry.nameDirty = true;
            return;
        }

        const texture = PIXI.Texture.from(img);
        const sprite = new PIXI.Sprite(texture);

        // Align the sprite hotspot with the container origin; movement updates
        // project that origin onto the canvas cursor position.
        sprite.anchor.set(
            Math.max(0, Math.min(width - 1, hotspotX)) / width,
            Math.max(0, Math.min(height - 1, hotspotY)) / height
        );

        entry.sprite = sprite;
        entry.arrow.visible = false;
        entry.imageWidth = width;
        entry.imageHeight = height;
        entry.baseSize = Math.max(width, height) || CURSOR_POINTER_SIZE;
        entry.artContainer.addChildAt(sprite, 0);
        entry.nameDirty = true;

        debugLog("sharing", `Applied custom cursor image for user, size=${width}x${height}`);
    };
    img.onerror = () => {
        if (!entry.container || entry.container.destroyed) return;
        if (entry.imageLoadId !== imageLoadId) return;
        console.warn(`${MODULE_ID} | Failed to load shared cursor image`);
        entry.imageDataUrl = null;
        entry.arrow.visible = true;
        entry.baseSize = CURSOR_POINTER_SIZE;
        entry.imageWidth = 0;
        entry.imageHeight = 0;
        entry.nameDirty = true;
    };
    img.src = imageDataUrl;
}

// Cache native Foundry cursor visibility so the ticker does not scan or mutate
// those children every frame.
let _lastFoundryNames = null;
let _lastFoundryDots = null;
let _lastFoundryChildrenLength = -1;
let _foundryChildrenDirty = true;
let _foundryChildrenParent = null;

function _markFoundryChildrenDirty() {
    _foundryChildrenDirty = true;
}

function _detachFoundryChildrenListeners() {
    if (_foundryChildrenParent && !_foundryChildrenParent.destroyed) {
        _foundryChildrenParent.off?.("childAdded", _markFoundryChildrenDirty);
        _foundryChildrenParent.off?.("childRemoved", _markFoundryChildrenDirty);
    }
    _foundryChildrenParent = null;
}

function _attachFoundryChildrenListeners(parent) {
    if (_foundryChildrenParent === parent) return;

    _detachFoundryChildrenListeners();
    if (parent && !parent.destroyed) {
        parent.on?.("childAdded", _markFoundryChildrenDirty);
        parent.on?.("childRemoved", _markFoundryChildrenDirty);
        _foundryChildrenParent = parent;
    }
    _markFoundryChildrenDirty();
}

function _getOverlayParent() {
    const parent = canvas?.controls?.cursors;
    if (!parent || parent.destroyed) return null;
    return parent;
}

function _ensureOverlayContainer(logMissing = true) {
    const parent = _getOverlayParent();
    if (!parent) {
        if (logMissing) debugLog("sharing", "initCursorOverlay: canvas.controls.cursors unavailable");
        return false;
    }
    _attachFoundryChildrenListeners(parent);

    if (_container?.destroyed) {
        _queuePendingImagesFromEntries();
        _cursors.clear();
        _container = null;
        _markFoundryChildrenDirty();
    }

    if (!_container) {
        _container = new PIXI.Container();
        _container.name = "ttb-cursor-sharing";
        _container.eventMode = "none";
        parent.addChild(_container);
        _markFoundryChildrenDirty();
        debugLog("sharing", `initCursorOverlay: container added to canvas.controls.cursors, visible=${_container.visible}`);
    } else if (_container.parent !== parent) {
        if (_container.parent && !_container.parent.destroyed) _container.parent.removeChild(_container);
        parent.addChild(_container);
        _markFoundryChildrenDirty();
        debugLog("sharing", "initCursorOverlay: container reattached to current canvas.controls.cursors");
    }

    if (!_tickerCallback) {
        _tickerCallback = () => _tick();
        canvas.app.ticker.add(_tickerCallback);
    }

    return true;
}

function _queuePendingImagesFromEntries() {
    for (const [userId, entry] of _cursors) {
        _pendingImages.set(userId, {
            imageDataUrl: entry.imageDataUrl ?? null,
            hotspotX: entry.hotspotX ?? 0,
            hotspotY: entry.hotspotY ?? 0,
            playerName: entry.playerName,
            namePosition: entry.namePosition,
            nameOffset: entry.nameOffset
        });
    }
}

function _destroyCursorSprite(entry) {
    if (!entry?.sprite) return;
    if (!entry.sprite.destroyed) {
        if (entry.sprite.parent && !entry.sprite.parent.destroyed) entry.sprite.parent.removeChild(entry.sprite);
        entry.sprite.destroy({ texture: true, baseTexture: true });
    }
    entry.sprite = null;
    entry.imageWidth = 0;
    entry.imageHeight = 0;
}

function _destroyCursorEntry(entry) {
    if (!entry) return;
    _destroyCursorSprite(entry);
    if (entry.container && !entry.container.destroyed) entry.container.destroy({ children: true });
    entry.container = null;
}

function _destroyAllCursorEntries() {
    for (const [, entry] of _cursors) {
        _destroyCursorEntry(entry);
    }
}

function _getFoundryCursorChildren() {
    return [...(canvas.controls?.cursors?.children ?? [])].filter(child => child !== _container && child?.name !== "ttb-cursor-sharing");
}

function _projectCursorPosition(entry) {
    if (!entry?.container || entry.container.destroyed) return;
    canvas.app.stage.worldTransform.apply(
        { x: entry.currentX, y: entry.currentY },
        entry.container.position
    );
}

function _updateFoundryCursors(showFoundryNames, showFoundryDots, foundryCursorChildren = _getFoundryCursorChildren()) {
    for (const cursor of foundryCursorChildren) {
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

function _getEffectiveFoundryCursorDisplay(foundryCursorDisplay, showModuleNames) {
    if (!showModuleNames) return foundryCursorDisplay;
    if (foundryCursorDisplay === "both") return "dots-only";
    if (foundryCursorDisplay === "names-only") return "none";
    return foundryCursorDisplay;
}

function _tick() {
    if (!canvas?.ready || !canvas.app?.ticker) return;
    if (!_ensureOverlayContainer(false)) return;

    const now = Date.now();
    const { cursorSize, cursorOpacity, showNames, foundryCursorDisplay, namePosition, nameOffset } = _settings;
    const effectiveFoundryCursorDisplay = _getEffectiveFoundryCursorDisplay(foundryCursorDisplay, showNames);

    // Touch Foundry's native cursor elements only when settings or children
    // changed.
    const showFoundryNames = effectiveFoundryCursorDisplay === "both" || effectiveFoundryCursorDisplay === "names-only";
    const showFoundryDots = effectiveFoundryCursorDisplay === "both" || effectiveFoundryCursorDisplay === "dots-only";
    const foundryChildrenLength = canvas.controls?.cursors?.children?.length ?? 0;
    if (foundryChildrenLength !== _lastFoundryChildrenLength) _markFoundryChildrenDirty();

    if (
        showFoundryNames !== _lastFoundryNames ||
        showFoundryDots !== _lastFoundryDots ||
        _foundryChildrenDirty
    ) {
        const foundryCursorChildren = _getFoundryCursorChildren();
        _lastFoundryNames = showFoundryNames;
        _lastFoundryDots = showFoundryDots;
        _lastFoundryChildrenLength = foundryChildrenLength;
        _foundryChildrenDirty = false;
        _updateFoundryCursors(showFoundryNames, showFoundryDots, foundryCursorChildren);
    }

    for (const [userId, entry] of _cursors) {
        if (!entry.container || entry.container.destroyed) continue;
        const user = game.users?.get?.(userId);
        const view = { sceneId: user?.viewedScene, levelId: user?.viewedLevel };
        if (!user || !canBroadcastVisibleCursor(user) || !isSocketMessageForCurrentView(view, user, canvas)) {
            removeRemoteCursor(userId);
            continue;
        }
        const baseSize = entry.baseSize || CURSOR_POINTER_SIZE;
        const artScale = cursorSize / baseSize;

        // Recompute the module label only after image/settings changes;
        // visibility still updates every frame.
        if (showNames) {
            if (entry.nameDirty) {
                const hasSprite = !!entry.sprite;
                const placement = computeOverlayNamePlacement({
                    namePosition: entry.namePosition || namePosition,
                    nameOffset: entry.nameOffset || nameOffset,
                    // Name offsets are owner-authored in the same fixed
                    // coordinate system used by Cursor Settings. Cursor Size
                    // scales the art and center shift, not the saved offset.
                    scale: NAME_LABEL_OFFSET_SCALE,
                    hasSprite,
                    spriteWidth: hasSprite ? (entry.imageWidth || entry.sprite.texture?.width || 0) * artScale : 0,
                    spriteHeight: hasSprite ? (entry.imageHeight || entry.sprite.texture?.height || 0) * artScale : 0,
                    spriteAnchorX: hasSprite ? entry.sprite.anchor.x : 0,
                    spriteAnchorY: hasSprite ? entry.sprite.anchor.y : 0
                });
                if (placement) {
                    entry.text.anchor.set(placement.anchorX, placement.anchorY);
                    entry.text.position.set(placement.posX, placement.posY);
                }
                entry.nameDirty = false;
            }
            entry.text.visible = true;
        } else {
            entry.text.visible = false;
        }
        // Smooth interpolation toward target position, matching Foundry's native
        // cursor easing closely enough to keep both dots visually aligned.
        if (entry.initialized) {
            // Snap threshold matches Foundry's native snap behavior at the current max zoom.
            const snapThreshold = 0.5 / (CONFIG.Canvas.maxZoom || 3);
            const stepped = stepCursorLerp(entry.currentX, entry.currentY, entry.targetX, entry.targetY, snapThreshold, CURSOR_LERP_SPEED);
            entry.currentX = stepped.x;
            entry.currentY = stepped.y;
            _projectCursorPosition(entry);
        }

        // The parent is Foundry's unbound screen-space cursor container, so
        // scaling is already viewport-stable and must not be divided by zoom.
        entry.container.scale.set(1);
        entry.artContainer.scale.set(artScale);

        // Fade custom cursor art and optional idle identity separately.
        const elapsed = now - entry.lastUpdate;
        const { disableCursorFade, idleIdentityFade } = _settings;
        const isFading = !disableCursorFade && elapsed > CURSOR_FADE_TIMEOUT_MS;
        // Only show idle identity elements that the viewer normally hides.
        const shouldIdleDot = idleIdentityFade && (effectiveFoundryCursorDisplay === "none" || effectiveFoundryCursorDisplay === "names-only");
        const shouldIdleName = idleIdentityFade && (effectiveFoundryCursorDisplay === "none" || effectiveFoundryCursorDisplay === "dots-only");
        const hasIdleElements = shouldIdleDot || shouldIdleName;

        if (isFading) {
            const fadeElapsed = elapsed - CURSOR_FADE_TIMEOUT_MS;
            const fadeOutAlpha = Math.max(0, cursorOpacity * (1 - fadeElapsed / 1000));

            if (hasIdleElements) {
                // Cursor art fades out while idle identity fades in.
                const fadeInAlpha = Math.min(cursorOpacity, fadeElapsed / 1000);
                entry.container.alpha = 1;

                // Fade out cursor visuals.
                if (entry.sprite) entry.sprite.alpha = fadeOutAlpha;
                entry.arrow.alpha = fadeOutAlpha;
                if (showNames) entry.text.alpha = fadeOutAlpha;

                // Fade in idle identity elements.
                entry.idleDot.visible = shouldIdleDot;
                entry.idleDot.alpha = shouldIdleDot ? fadeInAlpha : 0;
                entry.idleText.visible = shouldIdleName;
                entry.idleText.alpha = shouldIdleName ? fadeInAlpha : 0;

                // Keep the container visible as long as idle elements are showing.
                entry.container.visible = true;
            } else {
                // Plain cursor fade when no idle identity elements are needed.
                entry.container.alpha = fadeOutAlpha;
                entry.idleDot.visible = false;
                entry.idleText.visible = false;
                if (fadeOutAlpha <= 0) {
                    entry.container.visible = false;
                }
            }
        } else {
            // Active cursor: full opacity, no idle identity, reset per-element alpha.
            entry.container.visible = true;
            entry.container.alpha = cursorOpacity;
            if (entry.sprite) entry.sprite.alpha = 1;
            entry.arrow.alpha = 1;
            if (showNames) entry.text.alpha = 1;
            entry.idleDot.visible = false;
            entry.idleText.visible = false;
        }
    }
}
