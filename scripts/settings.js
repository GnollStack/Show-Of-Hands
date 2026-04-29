import { MODULE_ID, DEFAULT_CURSOR_PATH, DEFAULT_HOTSPOT, CURSOR_STATE_KEYS, debugLog } from './constants.js';

const CURRENT_SETTINGS_VERSION = 4;
export const USER_CURSOR_CONFIG_FLAG = "cursorConfig";

export const MIDDLE_MOUSE_ACTION_MODES = Object.freeze({
    off: "Off",
    target: "Click to Target",
    marquee: "Drag Marquee",
    both: "Click + Drag"
});

export const CURSOR_SHARING_MODES = Object.freeze({
    share: "Share My Cursor",
    receive: "Receive Only",
    private: "Private"
});

export const MARQUEE_TOKEN_FILTERS = Object.freeze({
    all: "All Visible Tokens",
    hostile: "Hostile Tokens",
    neutral: "Neutral Tokens",
    friendly: "Friendly Tokens",
    nonFriendly: "Hostile + Neutral Tokens"
});

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

export function getDefaultUserCursorConfig() {
    return {
        version: 1,
        useCustomCursor: true,
        cursorStates: getDefaultCursorStates(),
        namePosition: "bottom-center",
        nameOffset: { x: 0, y: 1.2 }
    };
}

export function normalizeCursorStates(states = {}) {
    const defaults = getDefaultCursorStates();
    return foundry.utils.mergeObject(defaults, states ?? {}, {
        inplace: false,
        insertKeys: true,
        insertValues: true,
        overwrite: true
    });
}

export function normalizeUserCursorConfig(config = {}) {
    const defaults = getDefaultUserCursorConfig();
    const merged = foundry.utils.mergeObject(defaults, config ?? {}, {
        inplace: false,
        insertKeys: true,
        insertValues: true,
        overwrite: true
    });

    // Older drafts and legacy settings used "states"; the persisted flag uses
    // "cursorStates" to avoid confusion with other module settings.
    merged.cursorStates = normalizeCursorStates(config.cursorStates ?? config.states ?? merged.cursorStates);
    merged.useCustomCursor = config.useCustomCursor ?? defaults.useCustomCursor;
    merged.namePosition = config.namePosition || defaults.namePosition;
    merged.nameOffset = {
        x: Number.isFinite(Number(config.nameOffset?.x)) ? Number(config.nameOffset.x) : defaults.nameOffset.x,
        y: Number.isFinite(Number(config.nameOffset?.y)) ? Number(config.nameOffset.y) : defaults.nameOffset.y
    };

    return merged;
}

export function getUserCursorConfig(user = game.user) {
    const stored = user?.getFlag?.(MODULE_ID, USER_CURSOR_CONFIG_FLAG);
    return normalizeUserCursorConfig(stored ?? {});
}

export async function setUserCursorConfig(user, config) {
    if (!user) throw new Error("No user was provided for cursor configuration.");
    const normalized = normalizeUserCursorConfig(config);
    await user.setFlag(MODULE_ID, USER_CURSOR_CONFIG_FLAG, normalized);
    return normalized;
}

export function getMiddleMouseActionMode() {
    try {
        const mode = game.settings.get(MODULE_ID, "middle-mouse-actions");
        return Object.prototype.hasOwnProperty.call(MIDDLE_MOUSE_ACTION_MODES, mode) ? mode : "both";
    } catch {
        return "both";
    }
}

export function isMiddleMouseTargetingEnabled() {
    const mode = getMiddleMouseActionMode();
    return mode === "target" || mode === "both";
}

export function isMiddleMouseMarqueeEnabled() {
    const mode = getMiddleMouseActionMode();
    return mode === "marquee" || mode === "both";
}

export function getCursorSharingMode() {
    try {
        const mode = game.settings.get(MODULE_ID, "cursor-sharing-mode");
        return Object.prototype.hasOwnProperty.call(CURSOR_SHARING_MODES, mode) ? mode : "share";
    } catch {
        return "share";
    }
}

export function isCursorBroadcastEnabled() {
    return getCursorSharingMode() === "share";
}

export function isCursorPrivateMode() {
    return getCursorSharingMode() === "private";
}

export function getMarqueeTokenFilter() {
    try {
        const filter = game.settings.get(MODULE_ID, "marquee-token-filter");
        return Object.prototype.hasOwnProperty.call(MARQUEE_TOKEN_FILTERS, filter) ? filter : "all";
    } catch {
        return "all";
    }
}

export function tokenMatchesMarqueeFilter(token) {
    const filter = getMarqueeTokenFilter();
    if (filter === "all") return true;

    const disposition = Number(token?.document?.disposition ?? token?.disposition ?? 0);
    const dispositions = CONST.TOKEN_DISPOSITIONS ?? {};
    const hostile = dispositions.HOSTILE ?? -1;
    const neutral = dispositions.NEUTRAL ?? 0;
    const friendly = dispositions.FRIENDLY ?? 1;

    if (filter === "hostile") return disposition === hostile;
    if (filter === "neutral") return disposition === neutral;
    if (filter === "friendly") return disposition === friendly;
    if (filter === "nonFriendly") return disposition === hostile || disposition === neutral;
    return true;
}

export function getHiddenSharedCursorUserIds() {
    try {
        const hidden = game.settings.get(MODULE_ID, "hidden-shared-cursor-users") ?? {};
        if (Array.isArray(hidden)) return new Set(hidden.filter(Boolean));
        if (hidden && typeof hidden === "object") {
            return new Set(Object.entries(hidden).filter(([, v]) => !!v).map(([id]) => id));
        }
    } catch { /* settings may not be ready */ }
    return new Set();
}

export function isSharedCursorUserVisible(userId) {
    if (!userId || userId === game.user?.id) return false;
    return !getHiddenSharedCursorUserIds().has(userId);
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

        if (version < 3) {
            debugLog("cursor", "Migrating settings to v3...");
            const defaults = getDefaultCursorStates();
            const existingStates = game.settings.get(MODULE_ID, "cursor-states") ?? {};
            const mergedStates = foundry.utils.mergeObject(defaults, existingStates, {
                inplace: false,
                insertKeys: true,
                insertValues: true,
                overwrite: true
            });

            await game.settings.set(MODULE_ID, "cursor-states", mergedStates);
            version = 3;
        }

        if (version < 4) {
            debugLog("cursor", "Migrating settings to v4...");

            const targeting = game.settings.get(MODULE_ID, "use-mousewheel-targeting");
            const marquee = game.settings.get(MODULE_ID, "use-marquee-select");
            let middleMouseMode = "off";
            if (targeting && marquee) middleMouseMode = "both";
            else if (targeting) middleMouseMode = "target";
            else if (marquee) middleMouseMode = "marquee";

            const sharing = game.settings.get(MODULE_ID, "enable-cursor-sharing");
            const privateMode = game.settings.get(MODULE_ID, "hide-my-cursor-from-others");
            const cursorSharingMode = privateMode ? "private" : (sharing ? "share" : "receive");

            await game.settings.set(MODULE_ID, "middle-mouse-actions", middleMouseMode);
            await game.settings.set(MODULE_ID, "cursor-sharing-mode", cursorSharingMode);
            version = 4;
        }

        await game.settings.set(MODULE_ID, "settings-version", version);
        debugLog("cursor", `Migration complete (v${version}).`);
    } catch (e) {
        console.warn(`${MODULE_ID} | Migration failed, using defaults.`, e);
    }
}
