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

import { MODULE_ID, debugLog } from './constants.js';
import {
    SETTING_DEFINITIONS,
    USER_CURSOR_CONFIG_FLAG,
    buildSettingRegistrationOptions,
    getMarqueeLevelFilter,
    getMiddleMouseActionMode,
    getUserCursorConfig,
    isCursorBroadcastEnabled,
    isCursorPrivateMode,
    migrateSettings,
    summarizeCursorConfigForLog
} from './settings.js';
import { applyCursorStyles } from './cursor-styles.js';
import { toggleMarqueeListener, cleanupMarqueeListener } from './marquee-select.js';
import { setupCursorStateListeners, cleanupCursorStateListeners } from './state-detection.js';
import { CursorConfigApp } from './cursor-config-app.js';
import { AdvancedSettingsApp } from './advanced-settings-app.js';
import { initCursorOverlay, destroyCursorOverlay, getCursorOverlayDebugState, updateOverlaySetting } from './cursor-overlay.js';
import { startCursorSharing, stopCursorSharing, refreshSharedCursorImage, setCursorBroadcastEnabled, broadcastHiddenPing, syncHiddenRemoteCursors, getCursorSharingDebugState } from './cursor-sharing.js';
import { createDiagnostics } from './diagnostics.js';
import { getShowCursorPermissionState } from './foundry-permissions.js';
import { getMarqueeLevelFilterStatus } from './scene-levels.js';
import {
    broadcastNativeActivity,
    getCursorPrivacyBroadcastDebugState,
    installCursorPrivacyBroadcastWrapper
} from './privacy-broadcast.js';

debugLog("cursor", "main.js loaded, all imports resolved OK");

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

function syncCursorPrivacy() {
    const hidden = isLocalCursorHidden();
    setCursorBroadcastEnabled(isCursorBroadcastEnabled());
    if (hidden) {
        broadcastNativeActivity({ cursor: null }, { volatile: false });
    }
}

// Maps client setting keys to the overlay setting names they drive. Used to
// push current values into the overlay cache on canvasReady.
const OVERLAY_SETTING_KEYS = Object.freeze({
    "shared-cursor-size": "cursorSize",
    "shared-cursor-opacity": "cursorOpacity",
    "show-cursor-names": "showNames",
    "foundry-cursor-display": "foundryCursorDisplay",
    "idle-identity-fade": "idleIdentityFade",
    "disable-cursor-fade": "disableCursorFade",
    "cursor-name-position": "namePosition",
    "cursor-name-offset": "nameOffset"
});

function syncOverlaySettingsFromStore() {
    for (const [settingKey, overlayKey] of Object.entries(OVERLAY_SETTING_KEYS)) {
        updateOverlaySetting(overlayKey, game.settings.get(MODULE_ID, settingKey));
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
        showCursorPermission: getShowCursorPermissionState(game.user),
        middleMouseMode: getMiddleMouseActionMode(),
        clearTargetsOnEmptyClick: game.settings.get(MODULE_ID, "clear-targets-on-empty-click"),
        cursorSharingMode: game.settings.get(MODULE_ID, "cursor-sharing-mode"),
        cursorBroadcastEnabled: isCursorBroadcastEnabled(),
        cursorPrivateMode: isCursorPrivateMode(),
        marqueeTokenFilter: game.settings.get(MODULE_ID, "marquee-token-filter"),
        marqueeLevelFilter: getMarqueeLevelFilter(),
        marqueeLevelFilterStatus: getMarqueeLevelFilterStatus(),
        hiddenSharedCursorUsers: game.settings.get(MODULE_ID, "hidden-shared-cursor-users"),
        cursorPrivacyBroadcast: getCursorPrivacyBroadcastDebugState(),
        cursorSharing: getCursorSharingDebugState(),
        cursorOverlay: getCursorOverlayDebugState(),
        userCursorConfig: getUserCursorConfig(game.user)
    };
}

function installApi() {
    const openAdvancedSettings = () => new AdvancedSettingsApp().render({ force: true });
    const openCursorConfig = ({ targetUserId } = {}) => new CursorConfigApp({ targetUserId }).render({ force: true });
    const api = {
        getDebugState,
        refreshSharedCursorImage,
        syncHiddenRemoteCursors,
        diagnostics: createDiagnostics({
            getDebugState,
            openAdvancedSettings,
            openCursorConfig
        })
    };
    const module = game.modules.get(MODULE_ID);
    if (module) module.api = api;
    globalThis.TargetTheBeastie = api;
}

function getSettingOnChangeHandlers() {
    return {
        syncMiddleMouseListener,
        overlayCursorSize: (v) => updateOverlaySetting("cursorSize", v),
        overlayCursorOpacity: (v) => updateOverlaySetting("cursorOpacity", v),
        overlayShowNames: (v) => updateOverlaySetting("showNames", v),
        overlayFoundryCursorDisplay: (v) => updateOverlaySetting("foundryCursorDisplay", v),
        overlayDisableCursorFade: (v) => updateOverlaySetting("disableCursorFade", v),
        overlayIdleIdentityFade: (v) => updateOverlaySetting("idleIdentityFade", v),
        overlayNamePosition: (v) => {
            updateOverlaySetting("namePosition", v);
            refreshSharedCursorImage();
        },
        overlayNameOffset: (v) => {
            updateOverlaySetting("nameOffset", v);
            refreshSharedCursorImage();
        },
        syncCursorPrivacy: () => {
            if (canvas?.ready) initCursorOverlay();
            syncCursorPrivacy();
        },
        syncHiddenRemoteCursors: () => syncHiddenRemoteCursors()
    };
}

function registerRuntimeSettings() {
    const onChangeHandlers = getSettingOnChangeHandlers();
    // Maintenance scanner anchors for metadata-registered MCP gates:
    // game.settings.register(MODULE_ID, "debug-mode")
    // game.settings.register(MODULE_ID, "enableMcpDiagnostics")
    for (const definition of SETTING_DEFINITIONS) {
        game.settings.register(
            MODULE_ID,
            definition.key,
            buildSettingRegistrationOptions(definition, onChangeHandlers)
        );
    }
}

Hooks.once('init', () => {
    try {
        debugLog("cursor", "Initializing settings...");
        registerRuntimeSettings();

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
    } catch (e) {
        console.error(`${MODULE_ID} | init hook failed:`, e);
    }
});

Hooks.on('canvasReady', () => {
    syncOverlaySettingsFromStore();

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
    const safely = (label, fn) => {
        try {
            fn();
        } catch (e) {
            console.error(`${MODULE_ID} | ${label} failed during canvas teardown:`, e);
        }
    };

    safely("cleanupMarqueeListener", cleanupMarqueeListener);
    safely("cleanupCursorStateListeners", cleanupCursorStateListeners);
    safely("stopCursorSharing", stopCursorSharing);
    safely("destroyCursorOverlay", destroyCursorOverlay);
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
    broadcastNativeActivity({ cursor: null }, { volatile: false });
});

Hooks.once('ready', async () => {
    try {
        try {
            await migrateSettings();
        } catch (e) {
            console.error(`${MODULE_ID} | Settings migration failed:`, e);
        }

        try {
            installCursorPrivacyBroadcastWrapper({
                isPrivateMode: isCursorPrivateMode,
                emitHiddenPing: broadcastHiddenPing
            });
        } catch (e) {
            console.error(`${MODULE_ID} | Cursor privacy broadcast wrapper install failed:`, e);
        }

        try {
            installApi();
        } catch (e) {
            console.error(`${MODULE_ID} | API install failed:`, e);
        }

        syncCursorPrivacy();
        const cursorConfig = getUserCursorConfig(game.user);
        debugLog("cursor", "ready hook: user cursor profile summary =", summarizeCursorConfigForLog(cursorConfig));
        await applyCursorStyles(cursorConfig.useCustomCursor);
    } catch (e) {
        console.error(`${MODULE_ID} | ready hook failed:`, e);
    }
});
