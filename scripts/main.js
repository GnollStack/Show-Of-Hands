/**
 * Target the Beastie Module
 *
 * This module enables targeting using the middle mouse button (mousewheel),
 * replicating the functionality of the 'T' key for targeting in Foundry VTT.
 * Features custom cursor support with per-state configuration and user uploads.
 *
 * @module target-the-beastie
 * @version 3.0.0
 * @license MIT
 * @author Fligo11
 */

import { MODULE_ID, DEBUG_MODES, debugLog } from './constants.js';
import { getDefaultCursorStates, migrateSettings } from './settings.js';
import { applyCursorStyles } from './cursor-styles.js';
import { toggleListener } from './targeting.js';
import { setupCursorStateListeners, cleanupCursorStateListeners } from './state-detection.js';
import { CursorConfigApp } from './cursor-config-app.js';
import { initCursorOverlay, destroyCursorOverlay } from './cursor-overlay.js';
import { startCursorSharing, stopCursorSharing, refreshSharedCursorImage } from './cursor-sharing.js';

console.log("target-the-beastie | [DIAG] main.js loaded, all imports resolved OK");

Hooks.once('init', () => {
    console.log(`${MODULE_ID} | Initializing settings...`);

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
        onChange: (value) => toggleListener(value)
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
        default: 32,
        range: {
            min: 16,
            max: 128,
            step: 4
        }
    });

    game.settings.register(MODULE_ID, "show-cursor-names", {
        name: "Show Player Names on Cursors",
        hint: "Display the player's name next to their shared cursor.",
        scope: "client",
        config: true,
        type: Boolean,
        default: false
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
        name: "Configure Cursors",
        label: "Cursor Settings",
        hint: "Upload custom cursor images and configure cursors for different interaction states",
        icon: "fas fa-mouse-pointer",
        type: CursorConfigApp,
        restricted: false
    });
});

Hooks.on('canvasReady', () => {
    const isTargetingEnabled = game.settings.get(MODULE_ID, "use-mousewheel-targeting");
    toggleListener(isTargetingEnabled);

    const isCursorEnabled = game.settings.get(MODULE_ID, "use-custom-cursor");
    if (isCursorEnabled) {
        setupCursorStateListeners();
    }

    const isSharingEnabled = game.settings.get(MODULE_ID, "enable-cursor-sharing");
    console.log(`${MODULE_ID} | [DIAG] canvasReady: enable-cursor-sharing = ${isSharingEnabled}`);
    if (isSharingEnabled) {
        console.log(`${MODULE_ID} | [DIAG] canvasReady: calling initCursorOverlay + startCursorSharing`);
        initCursorOverlay();
        startCursorSharing();
    }

    console.log(`${MODULE_ID} | Module loaded successfully.`);
});

Hooks.on('canvasTearDown', () => {
    stopCursorSharing();
    destroyCursorOverlay();
});

Hooks.once('ready', async () => {
    await migrateSettings();
    const isCursorEnabled = game.settings.get(MODULE_ID, "use-custom-cursor");
    debugLog("cursor", "ready hook: use-custom-cursor =", isCursorEnabled);
    debugLog("cursor", "ready hook: current cursor-states =", JSON.stringify(game.settings.get(MODULE_ID, "cursor-states"), null, 2));
    await applyCursorStyles(isCursorEnabled);
});
