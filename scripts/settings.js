import { MODULE_ID, DEFAULT_CURSOR_PATH, DEFAULT_HOTSPOT, CURSOR_STATE_KEYS, debugLog } from './constants.js';

const CURRENT_SETTINGS_VERSION = 3;

function hasStoredClientSetting(key) {
    const storage = game.settings.storage.get("client");
    const settingId = `${MODULE_ID}.${key}`;
    return storage ? storage.getItem(settingId) !== null : false;
}

function getStoredSettingsVersion() {
    if (!hasStoredClientSetting("settings-version")) {
        return hasStoredClientSetting("cursor-states") ? 2 : 0;
    }

    const version = Number(game.settings.get(MODULE_ID, "settings-version"));
    return Number.isFinite(version) ? version : 0;
}

function createDefaultState(key) {
    return {
        image: key === "default" ? DEFAULT_CURSOR_PATH : "",
        hotspotX: key === "default" ? DEFAULT_HOTSPOT.x : 0,
        hotspotY: key === "default" ? DEFAULT_HOTSPOT.y : 0,
        rotation: 0,
        width: 0,
        height: 0,
        enabled: key === "default"
    };
}

export function getDefaultCursorStates() {
    return Object.fromEntries(CURSOR_STATE_KEYS.map(key => [key, createDefaultState(key)]));
}

export async function migrateSettings() {
    let version = getStoredSettingsVersion();

    if (version >= CURRENT_SETTINGS_VERSION) return;

    try {
        if (version < 2) {
            debugLog("cursor", "Migrating settings to v2...");

            let oldEnabled = true;
            let oldHotspotX = DEFAULT_HOTSPOT.x;
            let oldHotspotY = DEFAULT_HOTSPOT.y;

            try { oldEnabled = game.settings.get(MODULE_ID, "use-aom-cursor"); } catch { /* legacy setting may not exist */ }
            try { oldHotspotX = game.settings.get(MODULE_ID, "cursor-hotspot-x"); } catch { /* legacy setting may not exist */ }
            try { oldHotspotY = game.settings.get(MODULE_ID, "cursor-hotspot-y"); } catch { /* legacy setting may not exist */ }

            const states = getDefaultCursorStates();
            states.default.hotspotX = oldHotspotX;
            states.default.hotspotY = oldHotspotY;

            await game.settings.set(MODULE_ID, "use-custom-cursor", oldEnabled);
            await game.settings.set(MODULE_ID, "cursor-states", states);
            version = 2;
        }

        if (version < CURRENT_SETTINGS_VERSION) {
            debugLog("cursor", `Migrating settings to v${CURRENT_SETTINGS_VERSION}...`);
            const defaults = getDefaultCursorStates();
            const existingStates = game.settings.get(MODULE_ID, "cursor-states") ?? {};
            const mergedStates = foundry.utils.mergeObject(defaults, existingStates, {
                inplace: false,
                insertKeys: true,
                insertValues: true,
                overwrite: true
            });

            await game.settings.set(MODULE_ID, "cursor-states", mergedStates);
            version = CURRENT_SETTINGS_VERSION;
        }

        await game.settings.set(MODULE_ID, "settings-version", version);
        debugLog("cursor", `Migration complete (v${version}).`);
    } catch (e) {
        console.warn(`${MODULE_ID} | Migration failed, using defaults.`, e);
    }
}
