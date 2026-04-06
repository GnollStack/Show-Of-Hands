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
import { getDefaultCursorStates, migrateSettings } from './settings.js';
import { applyCursorStyles } from './cursor-styles.js';
import { toggleMarqueeListener, cleanupMarqueeListener } from './marquee-select.js';
import { setupCursorStateListeners, cleanupCursorStateListeners } from './state-detection.js';
import { CursorConfigApp } from './cursor-config-app.js';
import { initCursorOverlay, destroyCursorOverlay, updateOverlaySetting } from './cursor-overlay.js';
import { startCursorSharing, stopCursorSharing, refreshSharedCursorImage } from './cursor-sharing.js';

debugLog("cursor", "main.js loaded, all imports resolved OK");

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

    // --- New settings ---
    game.settings.register(MODULE_ID, "use-mousewheel-targeting", {
        name: "Use Mousewheel for Targeting",
        hint: "Enable or disable targeting using the middle mouse button (mousewheel) over a token. Hold Shift to multi-target.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: (value) => toggleMarqueeListener(value)
    });

    game.settings.register(MODULE_ID, "use-marquee-select", {
        name: "Use Marquee Box Select",
        hint: "Hold middle mouse button and drag to draw a selection rectangle. All tokens within the rectangle will be targeted on release.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: () => {}
    });

    game.settings.register(MODULE_ID, "use-custom-cursor", {
        name: "Use Custom Cursor",
        hint: "Replace the default cursor with a custom cursor throughout Foundry VTT. Configure cursor images and states in the menu below.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: (value) => {
            applyCursorStyles(value);
            if (value) setupCursorStateListeners();
            else cleanupCursorStateListeners();
            refreshSharedCursorImage();
        }
    });

    game.settings.register(MODULE_ID, "cursor-states", {
        scope: "client",
        config: false,
        type: Object,
        default: getDefaultCursorStates()
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
        config: true,
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
        hint: "Display the module's shared-cursor name label next to remote cursors. This is the movable overlay label, not Foundry's built-in cursor name. To avoid duplicate names, set Built-In Foundry Cursor Elements to Dots Only or None.",
        scope: "client",
        config: true,
        type: Boolean,
        default: false,
        onChange: (v) => updateOverlaySetting("showNames", v)
    });

    game.settings.register(MODULE_ID, "cursor-name-position", {
        name: "Shared Cursor Name Position",
        hint: "Choose where the module overlay name appears relative to the shared cursor. Applies only when 'Show Shared Cursor Names (Overlay)' is enabled. Set to 'Custom' to use the dragged position from Cursor Settings.",
        scope: "client",
        config: true,
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
        hint: "Control Foundry's own cursor name and color dot separately from the module overlay. Use Dots Only or None if you only want the movable shared overlay name.",
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
        config: true,
        type: Boolean,
        default: false,
        onChange: (v) => updateOverlaySetting("disableCursorFade", v)
    });

    game.settings.register(MODULE_ID, "idle-identity-fade", {
        name: "Show Identity on Idle",
        hint: "When a player's cursor goes idle, fade in the hidden Foundry elements (name/dot) so you can still see who was there. Only applies when some Foundry elements are hidden above.",
        scope: "client",
        config: true,
        type: Boolean,
        default: false,
        onChange: (v) => updateOverlaySetting("idleIdentityFade", v)
    });

    game.settings.register(MODULE_ID, "enable-cursor-sharing", {
        name: "Share Cursor with Other Players",
        hint: "Show your cursor position to other connected players and see theirs on the canvas.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: (value) => {
            if (value) { initCursorOverlay(); startCursorSharing(); }
            else { stopCursorSharing(); destroyCursorOverlay(); }
        }
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
        default: 2
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

    const isTargetingEnabled = game.settings.get(MODULE_ID, "use-mousewheel-targeting");
    toggleMarqueeListener(isTargetingEnabled);

    const isCursorEnabled = game.settings.get(MODULE_ID, "use-custom-cursor");
    if (isCursorEnabled) {
        setupCursorStateListeners();
    }

    const isSharingEnabled = game.settings.get(MODULE_ID, "enable-cursor-sharing");
    debugLog("sharing", "canvasReady: enable-cursor-sharing =", isSharingEnabled);
    if (isSharingEnabled) {
        debugLog("sharing", "canvasReady: calling initCursorOverlay + startCursorSharing");
        initCursorOverlay();
        startCursorSharing();
    }

    debugLog("cursor", "Module loaded successfully.");
});

Hooks.on('canvasTearDown', () => {
    cleanupMarqueeListener();
    stopCursorSharing();
    destroyCursorOverlay();
});

Hooks.on('updateUser', (user, change) => {
    if (user.id !== game.user.id) return;
    if (!Object.prototype.hasOwnProperty.call(change, "name")) return;
    refreshSharedCursorImage();
});

Hooks.once('ready', async () => {
    await migrateSettings();
    const isCursorEnabled = game.settings.get(MODULE_ID, "use-custom-cursor");
    debugLog("cursor", "ready hook: use-custom-cursor =", isCursorEnabled);
    debugLog("cursor", "ready hook: current cursor-states =", JSON.stringify(game.settings.get(MODULE_ID, "cursor-states"), null, 2));
    await applyCursorStyles(isCursorEnabled);
});
