import { MODULE_ID, DEFAULT_CURSOR_PATH, DEFAULT_HOTSPOT, debugLog } from './constants.js';

export function getDefaultCursorStates() {
    return {
        default: { image: DEFAULT_CURSOR_PATH, hotspotX: DEFAULT_HOTSPOT.x, hotspotY: DEFAULT_HOTSPOT.y, rotation: 0, width: 0, height: 0, enabled: true },
        hover: { image: "", hotspotX: 0, hotspotY: 0, rotation: 0, width: 0, height: 0, enabled: false },
        targeting: { image: "", hotspotX: 0, hotspotY: 0, rotation: 0, width: 0, height: 0, enabled: false },
        panning: { image: "", hotspotX: 0, hotspotY: 0, rotation: 0, width: 0, height: 0, enabled: false }
    };
}

export async function migrateSettings() {
    try {
        const version = game.settings.get(MODULE_ID, "settings-version");
        if (version >= 2) return;
    } catch {
        // Setting doesn't exist yet, proceed with migration
    }

    console.log(`${MODULE_ID} | Migrating settings to v2...`);

    try {
        let oldEnabled = true;
        let oldHotspotX = DEFAULT_HOTSPOT.x;
        let oldHotspotY = DEFAULT_HOTSPOT.y;

        try { oldEnabled = game.settings.get(MODULE_ID, "use-aom-cursor"); } catch {}
        try { oldHotspotX = game.settings.get(MODULE_ID, "cursor-hotspot-x"); } catch {}
        try { oldHotspotY = game.settings.get(MODULE_ID, "cursor-hotspot-y"); } catch {}

        const states = getDefaultCursorStates();
        states.default.hotspotX = oldHotspotX;
        states.default.hotspotY = oldHotspotY;

        await game.settings.set(MODULE_ID, "use-custom-cursor", oldEnabled);
        await game.settings.set(MODULE_ID, "cursor-states", states);
        await game.settings.set(MODULE_ID, "settings-version", 2);

        console.log(`${MODULE_ID} | Migration complete.`);
    } catch (e) {
        console.warn(`${MODULE_ID} | Migration failed, using defaults.`, e);
    }
}
