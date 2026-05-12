/**
 * Target the Beastie Module
 *
 * This module enables targeting using the middle mouse button (mousewheel),
 * replicating the functionality of the 'T' key for targeting in Foundry VTT.
 * Features custom cursor support with per-state configuration and user uploads.
 *
 * @module target-the-beastie
 * @author GnollStack
 */

import { MODULE_ID, DEBUG_MODES, debugLog } from './constants.js';
import {
    CURSOR_SHARING_MODES,
    MARQUEE_TOKEN_FILTERS,
    MIDDLE_MOUSE_ACTION_MODES,
    getDefaultCursorStates,
    getMiddleMouseActionMode,
    getUserCursorConfig,
    isCursorBroadcastEnabled,
    isCursorPrivateMode,
    migrateSettings,
    USER_CURSOR_CONFIG_FLAG
} from './settings.js';
import { applyCursorStyles } from './cursor-styles.js';
import { toggleMarqueeListener, cleanupMarqueeListener } from './marquee-select.js';
import { setupCursorStateListeners, cleanupCursorStateListeners } from './state-detection.js';
import { CursorConfigApp } from './cursor-config-app.js';
import { AdvancedSettingsApp } from './advanced-settings-app.js';
import { initCursorOverlay, destroyCursorOverlay, updateOverlaySetting } from './cursor-overlay.js';
import { startCursorSharing, stopCursorSharing, refreshSharedCursorImage, setCursorBroadcastEnabled, broadcastHiddenPing, syncHiddenRemoteCursors, getCursorSharingDebugState } from './cursor-sharing.js';

debugLog("cursor", "main.js loaded, all imports resolved OK");

let _originalBroadcastActivity = null;

function syncMiddleMouseListener() {
    const hasMiddleMouseAction = getMiddleMouseActionMode() !== "off";
    const isClearOnEmptyEnabled = game.settings.get(MODULE_ID, "clear-targets-on-empty-click");
    toggleMarqueeListener(hasMiddleMouseAction || isClearOnEmptyEnabled);
}

function isLocalCursorHidden() {
    return isCursorPrivateMode();
}

async function syncLocalCursorProfile() {
    const config = getUserCursorConfig(game.user);
    await applyCursorStyles(config.useCustomCursor);
    if (config.useCustomCursor) setupCursorStateListeners();
    else cleanupCursorStateListeners();
    refreshSharedCursorImage();
}

function installCursorPrivacyPatch() {
    const proto = game.user?.constructor?.prototype;
    if (!proto || _originalBroadcastActivity) return;

    _originalBroadcastActivity = proto.broadcastActivity;
    proto.broadcastActivity = function(activityData = {}, options = {}) {
        if (this.isSelf && isCursorPrivateMode()) {
            const hasCursor = Object.prototype.hasOwnProperty.call(activityData, "cursor");
            const isPing = Object.prototype.hasOwnProperty.call(activityData, "ping");
            if (hasCursor && isPing) {
                broadcastHiddenPing(activityData.cursor, activityData.ping);
                return;
            }
            if (hasCursor) {
                const filtered = { ...activityData };
                delete filtered.cursor;
                if (!Object.keys(filtered).length) return;
                return _originalBroadcastActivity.call(this, filtered, options);
            }
        }

        return _originalBroadcastActivity.call(this, activityData, options);
    };
}

function syncCursorPrivacy() {
    const hidden = isLocalCursorHidden();
    setCursorBroadcastEnabled(isCursorBroadcastEnabled());
    if (hidden) {
        _originalBroadcastActivity?.call(game.user, { cursor: null }, { volatile: false });
    }
}

function getDebugState() {
    return {
        moduleVersion: game.modules.get(MODULE_ID)?.version ?? game.modules.get(MODULE_ID)?.data?.version ?? "unknown",
        foundryVersion: game.version ?? "unknown",
        canvasReady: !!canvas?.ready,
        sceneId: canvas?.scene?.id ?? null,
        userId: game.user?.id ?? null,
        userName: game.user?.name ?? null,
        middleMouseMode: getMiddleMouseActionMode(),
        clearTargetsOnEmptyClick: game.settings.get(MODULE_ID, "clear-targets-on-empty-click"),
        cursorSharingMode: game.settings.get(MODULE_ID, "cursor-sharing-mode"),
        cursorBroadcastEnabled: isCursorBroadcastEnabled(),
        cursorPrivateMode: isCursorPrivateMode(),
        marqueeTokenFilter: game.settings.get(MODULE_ID, "marquee-token-filter"),
        hiddenSharedCursorUsers: game.settings.get(MODULE_ID, "hidden-shared-cursor-users"),
        cursorSharing: getCursorSharingDebugState(),
        userCursorConfig: getUserCursorConfig(game.user)
    };
}

function installApi() {
    const api = {
        getDebugState,
        refreshSharedCursorImage,
        syncHiddenRemoteCursors
    };
    const module = game.modules.get(MODULE_ID);
    if (module) module.api = api;
    globalThis.TargetTheBeastie = api;
}

Hooks.once('init', () => {
    debugLog("cursor", "Initializing settings...");

    // --- Legacy settings (hidden, kept for migration) ---
    game.settings.register(MODULE_ID, "use-aom-cursor", {
        scope: "client", config: false, type: Boolean, default: true
    });
    game.settings.register(MODULE_ID, "cursor-hotspot-x", {
        scope: "client", config: false, type: Number, default: 4
    });
    game.settings.register(MODULE_ID, "cursor-hotspot-y", {
        scope: "client", config: false, type: Number, default: 4
    });

    game.settings.register(MODULE_ID, "use-mousewheel-targeting", {
        scope: "client",
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, "use-marquee-select", {
        scope: "client",
        config: false,
        type: Boolean,
        default: true
    });

    // --- New settings ---
    game.settings.register(MODULE_ID, "middle-mouse-actions", {
        name: "Middle-Mouse Actions",
        hint: "Choose what the middle mouse button does on the canvas. Shift still adds to existing targets.",
        scope: "client",
        config: true,
        type: String,
        default: "both",
        choices: MIDDLE_MOUSE_ACTION_MODES,
        onChange: () => syncMiddleMouseListener()
    });

    game.settings.register(MODULE_ID, "clear-targets-on-empty-click", {
        name: "Clear Targets on Empty Middle-Click",
        hint: "Middle-click on empty canvas (no token under cursor) clears all of your current targets. Hold Shift to keep your targets when clicking empty space.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: () => syncMiddleMouseListener()
    });

    game.settings.register(MODULE_ID, "use-custom-cursor", {
        name: "Use Custom Cursor",
        hint: "Legacy local toggle. Use Cursor Settings to configure the per-player cursor profile.",
        scope: "client",
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, "cursor-states", {
        scope: "client",
        config: false,
        type: Object,
        default: getDefaultCursorStates()
    });

    game.settings.register(MODULE_ID, "marquee-token-filter", {
        scope: "client",
        config: false,
        type: String,
        default: "all",
        choices: MARQUEE_TOKEN_FILTERS
    });

    game.settings.register(MODULE_ID, "shared-cursor-size", {
        name: "Shared Cursor Size",
        hint: "The size (in pixels) at which other players' cursors appear on your screen.",
        scope: "client",
        config: true,
        type: Number,
        default: 16,
        range: {
            min: 16,
            max: 128,
            step: 4
        },
        onChange: (v) => updateOverlaySetting("cursorSize", v)
    });

    game.settings.register(MODULE_ID, "shared-cursor-opacity", {
        name: "Shared Cursor Opacity",
        hint: "The opacity of other players' cursors. Foundry's default color dot uses 0.35.",
        scope: "client",
        config: false,
        type: Number,
        default: 1,
        range: {
            min: 0.1,
            max: 1,
            step: 0.05
        },
        onChange: (v) => updateOverlaySetting("cursorOpacity", v)
    });

    game.settings.register(MODULE_ID, "show-cursor-names", {
        name: "Show Shared Cursor Names (Overlay)",
        hint: "Display the module's movable shared-cursor name label next to remote cursors. When enabled, Foundry's default white cursor name is automatically hidden to avoid duplicate names.",
        scope: "client",
        config: true,
        type: Boolean,
        default: false,
        onChange: (v) => updateOverlaySetting("showNames", v)
    });

    game.settings.register(MODULE_ID, "cursor-name-position", {
        name: "Shared Cursor Name Position",
        hint: "Legacy local fallback. Use Cursor Settings to configure the per-player overlay name position.",
        scope: "client",
        config: false,
        type: String,
        default: "bottom-center",
        choices: {
            "bottom-center": "Bottom Center",
            "bottom-right": "Bottom Right",
            "top-center": "Top Center",
            "right": "Right",
            "custom": "Custom (set in Cursor Settings)"
        },
        onChange: (v) => {
            updateOverlaySetting("namePosition", v);
            refreshSharedCursorImage();
        }
    });

    game.settings.register(MODULE_ID, "cursor-name-offset", {
        scope: "client",
        config: false,
        type: Object,
        default: { x: 0, y: 1.2 },
        onChange: (v) => {
            updateOverlaySetting("nameOffset", v);
            refreshSharedCursorImage();
        }
    });

    game.settings.register(MODULE_ID, "foundry-cursor-display", {
        name: "Built-In Foundry Cursor Elements",
        hint: "Control Foundry's own cursor name and color dot. If module overlay names are enabled, Foundry's default white name is suppressed automatically and this setting applies to the remaining native elements.",
        scope: "client",
        config: true,
        type: String,
        default: "both",
        choices: {
            "both": "Show Player Names & Color Dots",
            "names-only": "Show Only Player Names",
            "dots-only": "Show Only Color Dots",
            "none": "Hide Both"
        },
        onChange: (v) => updateOverlaySetting("foundryCursorDisplay", v)
    });

    game.settings.register(MODULE_ID, "disable-cursor-fade", {
        name: "Disable Cursor Fade Out",
        hint: "When enabled, the shared cursor and player name will remain visible at full opacity instead of fading out after the player goes idle.",
        scope: "client",
        config: false,
        type: Boolean,
        default: false,
        onChange: (v) => updateOverlaySetting("disableCursorFade", v)
    });

    game.settings.register(MODULE_ID, "idle-identity-fade", {
        name: "Show Identity on Idle",
        hint: "When a player's cursor goes idle, fade in the hidden Foundry elements (name/dot) so you can still see who was there. Only applies when some Foundry elements are hidden above.",
        scope: "client",
        config: false,
        type: Boolean,
        default: false,
        onChange: (v) => updateOverlaySetting("idleIdentityFade", v)
    });

    game.settings.register(MODULE_ID, "enable-cursor-sharing", {
        name: "Share Cursor with Other Players",
        hint: "Send your cursor position and cursor image to other connected players. Turning this off does not hide other players' shared cursors on your screen.",
        scope: "client",
        config: false,
        type: Boolean,
        default: true,
    });

    game.settings.register(MODULE_ID, "hide-my-cursor-from-others", {
        name: "Hide My Cursor From Others",
        hint: "Privacy mode. Hide your cursor from other players regardless of their viewer settings, including this module's shared cursor and Foundry's built-in cursor dot/name. Canvas pings are sent through this module so they do not reveal your cursor.",
        scope: "client",
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, "cursor-sharing-mode", {
        name: "Cursor Sharing Mode",
        hint: "Choose whether to share your module cursor, only receive other module cursors, or hide your cursor from everyone including Foundry's built-in cursor display.",
        scope: "client",
        config: true,
        type: String,
        default: "share",
        choices: CURSOR_SHARING_MODES,
        onChange: () => {
            if (canvas?.ready) initCursorOverlay();
            syncCursorPrivacy();
        }
    });

    game.settings.register(MODULE_ID, "hidden-shared-cursor-users", {
        scope: "client",
        config: false,
        type: Object,
        default: {},
        onChange: () => syncHiddenRemoteCursors()
    });

    game.settings.register(MODULE_ID, "debug-mode", {
        name: "Debug Mode",
        hint: "Enable console logging for specific areas. Check browser console (F12) for output.",
        scope: "client",
        config: true,
        type: String,
        default: "off",
        choices: DEBUG_MODES
    });

    game.settings.register(MODULE_ID, "settings-version", {
        scope: "client",
        config: false,
        type: Number,
        default: 0
    });

    // Settings menu
    game.settings.registerMenu(MODULE_ID, "cursor-config-menu", {
        name: "Configure Cursors & Overlay Name",
        label: "Cursor Settings",
        hint: "Upload custom cursor images for each state and position the module's shared overlay name label",
        icon: "fas fa-mouse-pointer",
        type: CursorConfigApp,
        restricted: false
    });

    game.settings.registerMenu(MODULE_ID, "advanced-settings-menu", {
        name: "Advanced Settings & Diagnostics",
        label: "Advanced Settings",
        hint: "Tune advanced cursor behavior, marquee filters, per-player cursor visibility, and view diagnostics.",
        icon: "fas fa-sliders",
        type: AdvancedSettingsApp,
        restricted: false
    });
});

Hooks.on('canvasReady', () => {
    // Sync cached overlay settings on canvas load
    updateOverlaySetting("cursorSize", game.settings.get(MODULE_ID, "shared-cursor-size"));
    updateOverlaySetting("cursorOpacity", game.settings.get(MODULE_ID, "shared-cursor-opacity"));
    updateOverlaySetting("showNames", game.settings.get(MODULE_ID, "show-cursor-names"));
    updateOverlaySetting("foundryCursorDisplay", game.settings.get(MODULE_ID, "foundry-cursor-display"));
    updateOverlaySetting("idleIdentityFade", game.settings.get(MODULE_ID, "idle-identity-fade"));
    updateOverlaySetting("disableCursorFade", game.settings.get(MODULE_ID, "disable-cursor-fade"));
    updateOverlaySetting("namePosition", game.settings.get(MODULE_ID, "cursor-name-position"));
    updateOverlaySetting("nameOffset", game.settings.get(MODULE_ID, "cursor-name-offset"));

    syncMiddleMouseListener();

    const cursorConfig = getUserCursorConfig(game.user);
    if (cursorConfig.useCustomCursor) {
        setupCursorStateListeners();
    }

    const isSharingEnabled = isCursorBroadcastEnabled();
    debugLog("sharing", "canvasReady: cursor-sharing-mode =", game.settings.get(MODULE_ID, "cursor-sharing-mode"));
    debugLog("sharing", "canvasReady: calling initCursorOverlay + startCursorSharing");
    initCursorOverlay();
    startCursorSharing(isSharingEnabled && !isLocalCursorHidden());
    syncCursorPrivacy();

    debugLog("cursor", "Module loaded successfully.");
});

Hooks.on('canvasTearDown', () => {
    cleanupMarqueeListener();
    cleanupCursorStateListeners();
    stopCursorSharing();
    destroyCursorOverlay();
});

Hooks.on('updateUser', (user, change) => {
    if (user.id !== game.user.id) return;
    const cursorConfigChanged = Object.prototype.hasOwnProperty.call(change.flags?.[MODULE_ID] ?? {}, USER_CURSOR_CONFIG_FLAG);
    const nameChanged = Object.prototype.hasOwnProperty.call(change, "name");
    if (cursorConfigChanged) syncLocalCursorProfile().catch(e => console.warn(`${MODULE_ID} | Failed to sync cursor profile after user update:`, e));
    else if (nameChanged) refreshSharedCursorImage();
});

Hooks.on('userConnected', (user, connected) => {
    if (!connected || user.id === game.user.id || !isLocalCursorHidden()) return;
    _originalBroadcastActivity?.call(game.user, { cursor: null }, { volatile: false });
});

Hooks.once('ready', async () => {
    await migrateSettings();
    installCursorPrivacyPatch();
    installApi();
    syncCursorPrivacy();
    const cursorConfig = getUserCursorConfig(game.user);
    debugLog("cursor", "ready hook: user cursor profile =", JSON.stringify(cursorConfig, null, 2));
    await applyCursorStyles(cursorConfig.useCustomCursor);
});
