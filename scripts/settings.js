/**
 * @file settings.js
 * @description Foundry setting definitions, legacy migration helpers, and
 * per-user cursor profile normalization for Show of Hands.
 */

import { MODULE_ID, LEGACY_MODULE_ID, DEBUG_MODES, DEFAULT_CURSOR_PATH, DEFAULT_HOTSPOT, CURSOR_SIZE_MAX, CURSOR_SOURCE_HOTSPOT_MAX, CURSOR_STATE_KEYS, debugLog } from './constants.js';

const CURRENT_SETTINGS_VERSION = 5;
export const USER_CURSOR_CONFIG_FLAG = "cursorConfig";

const REMOVED_BUNDLED_CURSOR_PATHS = Object.freeze(new Set([
    `modules/${MODULE_ID}/assets/AOM_cursor_pointer.png`,
    `modules/${MODULE_ID}/assets/AOM_cursor_pointer_32x32.png`,
    `modules/${LEGACY_MODULE_ID}/assets/AOM_cursor_pointer.png`,
    `modules/${LEGACY_MODULE_ID}/assets/AOM_cursor_pointer_32x32.png`
]));

function isRemovedBundledCursorPath(value) {
    return typeof value === "string" && REMOVED_BUNDLED_CURSOR_PATHS.has(value);
}

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

export const MARQUEE_LEVEL_FILTERS = Object.freeze({
    all: "All Visible Tokens",
    viewed: "Viewed Level Only"
});

export const CURSOR_NAME_POSITION_CHOICES = Object.freeze({
    "bottom-center": "Bottom Center",
    "bottom-right": "Bottom Right",
    "top-center": "Top Center",
    "right": "Right",
    "custom": "Custom (set in Cursor Settings)"
});

function getStoredSettingData(scope, moduleId, key) {
    const storage = game.settings.storage.get(scope);
    const settingId = `${moduleId}.${key}`;
    const raw = storage?.getItem?.(settingId);
    if (raw === undefined || raw === null) return { found: false, value: undefined };

    try {
        return { found: true, value: JSON.parse(raw) };
    } catch {
        return { found: true, value: raw };
    }
}

function hasStoredClientSetting(key) {
    return getStoredSettingData("client", MODULE_ID, key).found;
}

function hasStoredChoiceSetting(key, choices) {
    const stored = getStoredSettingData("client", MODULE_ID, key);
    return stored.found && typeof stored.value === "string" && Object.prototype.hasOwnProperty.call(choices, stored.value);
}

function hasAnyStoredClientSetting(keys) {
    return keys.some(key => hasStoredClientSetting(key));
}

function getStoredSettingsVersion() {
    // Very old installs have no settings-version, so read the old keys to pick
    // the right migration path.
    if (!hasStoredClientSetting("settings-version")) {
        if (hasStoredClientSetting("cursor-states")) return 2;
        if (hasAnyStoredClientSetting([
            "use-aom-cursor",
            "cursor-hotspot-x",
            "cursor-hotspot-y",
            "use-mousewheel-targeting",
            "use-marquee-select",
            "enable-cursor-sharing",
            "hide-my-cursor-from-others"
        ])) return 1;
        return CURRENT_SETTINGS_VERSION;
    }

    const version = Number(game.settings.get(MODULE_ID, "settings-version"));
    return Number.isFinite(version) ? version : 0;
}

function migrateLegacyModulePaths(value) {
    // Cursor image paths may still point at the old module folder after a rename.
    // Scrub only bundled files known to have been removed. The legacy package
    // is a distinct install, so rewriting arbitrary user-picked paths into the
    // new package would point at files which may not exist there.
    if (typeof value === "string") {
        if (isRemovedBundledCursorPath(value)) return "";
        return value;
    }
    if (Array.isArray(value)) return value.map(migrateLegacyModulePaths);
    if (value && typeof value === "object") {
        const hasRemovedImage = isRemovedBundledCursorPath(value.image);
        const migrated = Object.fromEntries(
            Object.entries(value).map(([key, child]) => [key, migrateLegacyModulePaths(child)])
        );
        if (!hasRemovedImage) return migrated;
        return {
            ...migrated,
            image: "",
            hotspotX: DEFAULT_HOTSPOT.x,
            hotspotY: DEFAULT_HOTSPOT.y,
            rotation: 0,
            width: 0,
            height: 0
        };
    }
    return value;
}

async function migrateLegacyNamespaceSettings({ scopes = ["client", "world"] } = {}) {
    if (!game.settings?.storage?.get) return;
    const allowedScopes = new Set(scopes);
    const failures = [];
    const currentSharing = getStoredSettingData("client", MODULE_ID, "enable-cursor-sharing");
    const currentPrivate = getStoredSettingData("client", MODULE_ID, "hide-my-cursor-from-others");
    const hasCurrentLegacySharingMode = currentSharing.found || currentPrivate.found;

    // Materialize the effective legacy compact mode before copying its older
    // booleans. Otherwise those newly current booleans temporarily outrank it
    // in the early-startup privacy filter. A failed write must stop the copy.
    const currentMode = getStoredSettingData("client", MODULE_ID, "cursor-sharing-mode");
    const legacyMode = getStoredSettingData("client", LEGACY_MODULE_ID, "cursor-sharing-mode");
    if (allowedScopes.has("client") && !currentMode.found && !hasCurrentLegacySharingMode
        && legacyMode.found && typeof legacyMode.value === "string"
        && Object.prototype.hasOwnProperty.call(CURSOR_SHARING_MODES, legacyMode.value)) {
        try {
            await game.settings.set(MODULE_ID, "cursor-sharing-mode", legacyMode.value);
        } catch (error) {
            throw new AggregateError([error], `One or more ${LEGACY_MODULE_ID} namespace settings could not be migrated.`);
        }
    }

    // Copy old namespace values only when this install has not saved the new key yet.
    for (const definition of SETTING_DEFINITIONS) {
        // A partially upgraded current namespace is newer than the old package
        // namespace. Do not let a stale legacy compact mode overwrite current
        // old-format sharing/privacy booleans.
        if (definition.key === "cursor-sharing-mode" && hasCurrentLegacySharingMode) continue;
        const scope = definition.scope ?? "client";
        if (!allowedScopes.has(scope)) continue;
        const current = getStoredSettingData(scope, MODULE_ID, definition.key);
        if (current.found) continue;

        const legacy = getStoredSettingData(scope, LEGACY_MODULE_ID, definition.key);
        if (!legacy.found) continue;

        try {
            await game.settings.set(MODULE_ID, definition.key, migrateLegacyModulePaths(legacy.value));
        } catch (error) {
            console.warn(`${MODULE_ID} | Could not migrate legacy ${LEGACY_MODULE_ID}.${definition.key}.`, error);
            failures.push(error);
        }
    }

    if (failures.length) {
        throw new AggregateError(failures, `One or more ${LEGACY_MODULE_ID} namespace settings could not be migrated.`);
    }
}

async function materializeCurrentLegacyCursorSharingMode() {
    if (hasStoredChoiceSetting("cursor-sharing-mode", CURSOR_SHARING_MODES)) return;

    const currentSharing = getStoredSettingData("client", MODULE_ID, "enable-cursor-sharing");
    const currentPrivate = getStoredSettingData("client", MODULE_ID, "hide-my-cursor-from-others");
    if (!currentSharing.found && !currentPrivate.found) return;

    const legacySharing = getStoredSettingData("client", LEGACY_MODULE_ID, "enable-cursor-sharing");
    const legacyPrivate = getStoredSettingData("client", LEGACY_MODULE_ID, "hide-my-cursor-from-others");
    const sharing = currentSharing.found
        ? !!currentSharing.value
        : (legacySharing.found ? !!legacySharing.value : true);
    const privateMode = currentPrivate.found
        ? !!currentPrivate.value
        : (legacyPrivate.found ? !!legacyPrivate.value : false);
    await game.settings.set(MODULE_ID, "cursor-sharing-mode", privateMode ? "private" : (sharing ? "share" : "receive"));
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

export const SETTING_DEFINITIONS = Object.freeze([
    // Hidden legacy settings stay registered so migration/fallback reads remain
    // possible without exposing outdated controls in Foundry's settings UI.
    { key: "use-aom-cursor", scope: "client", config: false, type: Boolean, defaultValue: true },
    { key: "cursor-hotspot-x", scope: "client", config: false, type: Number, defaultValue: DEFAULT_HOTSPOT.x },
    { key: "cursor-hotspot-y", scope: "client", config: false, type: Number, defaultValue: DEFAULT_HOTSPOT.y },
    { key: "use-mousewheel-targeting", scope: "client", config: false, type: Boolean, defaultValue: true },
    { key: "use-marquee-select", scope: "client", config: false, type: Boolean, defaultValue: true },
    {
        key: "middle-mouse-actions",
        name: "Middle-Mouse Actions",
        hint: "Choose what the middle mouse button does on the canvas. Shift still adds to existing targets.",
        scope: "client",
        config: true,
        type: String,
        defaultValue: "both",
        choices: MIDDLE_MOUSE_ACTION_MODES,
        onChange: "syncMiddleMouseListener"
    },
    {
        key: "clear-targets-on-empty-click",
        name: "Clear Targets on Empty Middle-Click",
        hint: "Middle-click on empty canvas (no token under cursor) clears all of your current targets. Hold Shift to keep your targets when clicking empty space.",
        scope: "client",
        config: true,
        type: Boolean,
        defaultValue: true,
        onChange: "syncMiddleMouseListener"
    },
    {
        key: "use-custom-cursor",
        name: "Use Custom Cursor",
        hint: "Legacy local toggle. Use Cursor Settings to configure the per-player cursor profile.",
        scope: "client",
        config: false,
        type: Boolean,
        defaultValue: true
    },
    { key: "cursor-states", scope: "client", config: false, type: Object, defaultValue: getDefaultCursorStates },
    {
        key: "marquee-token-filter",
        scope: "client",
        config: false,
        type: String,
        defaultValue: "all",
        choices: MARQUEE_TOKEN_FILTERS
    },
    {
        key: "marquee-level-filter",
        scope: "client",
        config: false,
        type: String,
        defaultValue: "all",
        choices: MARQUEE_LEVEL_FILTERS
    },
    {
        key: "shared-cursor-size",
        name: "Shared Cursor Size",
        hint: "The size (in pixels) at which other players' cursors appear on your screen.",
        scope: "client",
        config: true,
        type: Number,
        defaultValue: 16,
        range: { min: 16, max: CURSOR_SIZE_MAX, step: 4 },
        onChange: "overlayCursorSize"
    },
    {
        key: "shared-cursor-opacity",
        name: "Shared Cursor Opacity",
        hint: "The opacity of other players' cursors. Foundry's default color dot uses 0.35.",
        scope: "client",
        config: false,
        type: Number,
        defaultValue: 1,
        range: { min: 0.1, max: 1, step: 0.05 },
        onChange: "overlayCursorOpacity"
    },
    {
        key: "show-cursor-names",
        name: "Show Shared Cursor Names (Overlay)",
        hint: "Display the module's movable shared-cursor name label next to remote cursors. Foundry's default white name is hidden only for peers with an active module overlay, avoiding duplicates without anonymizing native-only cursors.",
        scope: "client",
        config: true,
        type: Boolean,
        defaultValue: false,
        onChange: "overlayShowNames"
    },
    {
        key: "cursor-name-position",
        name: "Shared Cursor Name Position",
        hint: "Legacy local fallback. Use Cursor Settings to configure the per-player overlay name position.",
        scope: "client",
        config: false,
        type: String,
        defaultValue: "bottom-center",
        choices: CURSOR_NAME_POSITION_CHOICES,
        onChange: "overlayNamePosition"
    },
    {
        key: "cursor-name-offset",
        scope: "client",
        config: false,
        type: Object,
        defaultValue: () => ({ x: 0, y: 1.2 }),
        onChange: "overlayNameOffset"
    },
    {
        key: "foundry-cursor-display",
        name: "Built-In Foundry Cursor Elements",
        hint: "Control Foundry's own cursor name and color dot. Module overlay names replace the native white name only for peers with an active module overlay; native-only peers continue to follow this setting.",
        scope: "client",
        config: true,
        type: String,
        defaultValue: "both",
        choices: {
            "both": "Show Player Names & Color Dots",
            "names-only": "Show Only Player Names",
            "dots-only": "Show Only Color Dots",
            "none": "Hide Both"
        },
        onChange: "overlayFoundryCursorDisplay"
    },
    {
        key: "disable-cursor-fade",
        name: "Disable Cursor Fade Out",
        hint: "When enabled, the shared cursor and player name will remain visible at full opacity instead of fading out after the player goes idle.",
        scope: "client",
        config: false,
        type: Boolean,
        defaultValue: false,
        onChange: "overlayDisableCursorFade"
    },
    {
        key: "idle-identity-fade",
        name: "Show Identity on Idle",
        hint: "When a player's cursor goes idle, fade in the hidden Foundry elements (name/dot) so you can still see who was there. Only applies when some Foundry elements are hidden above.",
        scope: "client",
        config: false,
        type: Boolean,
        defaultValue: false,
        onChange: "overlayIdleIdentityFade"
    },
    {
        key: "enable-cursor-sharing",
        name: "Share Cursor with Other Players",
        hint: "Send your cursor position and cursor image to other connected players. Turning this off does not hide other players' shared cursors on your screen.",
        scope: "client",
        config: false,
        type: Boolean,
        defaultValue: true
    },
    {
        key: "hide-my-cursor-from-others",
        name: "Hide My Cursor From Others",
        hint: "Privacy mode. Hide your cursor from other players regardless of their viewer settings, including this module's shared cursor and Foundry's built-in cursor dot/name. Canvas pings are sent through this module so they do not reveal your cursor.",
        scope: "client",
        config: false,
        type: Boolean,
        defaultValue: false
    },
    {
        key: "cursor-sharing-mode",
        name: "Cursor Sharing Mode",
        hint: "Choose whether to share your module cursor, only receive other module cursors, or hide your cursor from everyone including Foundry's built-in cursor display.",
        scope: "client",
        config: true,
        type: String,
        defaultValue: "share",
        choices: CURSOR_SHARING_MODES,
        onChange: "syncCursorPrivacy"
    },
    {
        key: "hidden-shared-cursor-users",
        scope: "client",
        config: false,
        type: Object,
        defaultValue: () => ({}),
        onChange: "syncHiddenRemoteCursors"
    },
    {
        key: "debug-mode",
        name: "Debug Mode",
        hint: "Enable console logging for specific areas. Check browser console (F12) for output.",
        scope: "client",
        config: true,
        type: String,
        defaultValue: "off",
        choices: DEBUG_MODES
    },
    {
        key: "enableMcpDiagnostics",
        name: "Enable MCP Diagnostics",
        hint: "Advanced GM-only diagnostics for Foundry MCP Bridge workflows, including module validation, client refresh, and confirmed temporary fixture automation. Leave this disabled unless you are intentionally debugging or testing this module.",
        scope: "world",
        config: true,
        restricted: true,
        type: Boolean,
        defaultValue: false
    },
    { key: "settings-version", scope: "client", config: false, type: Number, defaultValue: 0 }
]);

export const SETTING_KEYS = Object.freeze(SETTING_DEFINITIONS.map(definition => definition.key));

export const SETTING_CHOICES = Object.freeze(Object.fromEntries(
    SETTING_DEFINITIONS
        .filter(definition => definition.choices)
        .map(definition => [definition.key, Object.freeze(Object.keys(definition.choices))])
));

export const SETTING_RANGES = Object.freeze(Object.fromEntries(
    SETTING_DEFINITIONS
        .filter(definition => definition.range)
        .map(definition => [definition.key, Object.freeze({ ...definition.range })])
));

function cloneDefaultValue(value) {
    if (!value || typeof value !== "object") return value;
    return typeof structuredClone === "function"
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
}

export function getSettingDefault(definition) {
    const value = typeof definition.defaultValue === "function"
        ? definition.defaultValue()
        : definition.defaultValue;
    return cloneDefaultValue(value);
}

export function buildSettingRegistrationOptions(definition, onChangeHandlers = {}) {
    const {
        key,
        defaultValue,
        onChange,
        ...registration
    } = definition;

    const options = {
        ...registration,
        default: getSettingDefault(definition)
    };

    if (onChange && typeof onChangeHandlers[onChange] === "function") {
        options.onChange = onChangeHandlers[onChange];
    }

    return options;
}

// Coerce a value to a finite integer in [min, max], falling back when invalid.
function clampInt(value, min, max, fallback) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

// Clamp a cursor state's numbers to the same ranges the UI uses. A width/height
// of 0 means "use the original image size"; positive sizes stay within the cap.
function clampCursorState(state, defaults) {
    if (!state || typeof state !== "object") return state;
    const clampSize = (value) => {
        const n = Math.round(Number(value));
        if (!Number.isFinite(n) || n <= 0) return 0;
        return Math.min(CURSOR_SIZE_MAX, Math.max(1, n));
    };
    state.hotspotX = clampInt(state.hotspotX, 0, CURSOR_SOURCE_HOTSPOT_MAX, defaults.hotspotX);
    state.hotspotY = clampInt(state.hotspotY, 0, CURSOR_SOURCE_HOTSPOT_MAX, defaults.hotspotY);
    state.rotation = ((clampInt(state.rotation, -3600, 3600, 0) % 360) + 360) % 360;
    state.width = clampSize(state.width);
    state.height = clampSize(state.height);
    return state;
}

export function normalizeCursorStates(states = {}) {
    states = migrateLegacyModulePaths(states ?? {});
    const defaults = getDefaultCursorStates();
    const merged = foundry.utils.mergeObject(defaults, states ?? {}, {
        inplace: false,
        insertKeys: true,
        insertValues: true,
        overwrite: true
    });

    for (const key of CURSOR_STATE_KEYS) {
        if (merged[key]) clampCursorState(merged[key], defaults[key] ?? createDefaultState(key));
    }

    return merged;
}

export function normalizeUserCursorConfig(config = {}) {
    config = migrateLegacyModulePaths(config ?? {});
    const defaults = getDefaultUserCursorConfig();
    const merged = foundry.utils.mergeObject(defaults, config ?? {}, {
        inplace: false,
        insertKeys: true,
        insertValues: true,
        overwrite: true
    });

    // Older drafts and legacy settings used "states"; the persisted flag uses
    // "cursorStates" to avoid confusion with Foundry setting names.
    merged.cursorStates = normalizeCursorStates(config.cursorStates ?? config.states ?? merged.cursorStates);
    merged.useCustomCursor = config.useCustomCursor ?? defaults.useCustomCursor;
    merged.namePosition = config.namePosition || defaults.namePosition;
    merged.nameOffset = {
        x: Number.isFinite(Number(config.nameOffset?.x)) ? Number(config.nameOffset.x) : defaults.nameOffset.x,
        y: Number.isFinite(Number(config.nameOffset?.y)) ? Number(config.nameOffset.y) : defaults.nameOffset.y
    };

    return merged;
}

function readUserCursorConfigFlag(user, scope) {
    if (!user) return undefined;
    try {
        if (typeof user.getFlag === "function") return user.getFlag(scope, USER_CURSOR_CONFIG_FLAG);
    } catch (error) {
        if (scope !== LEGACY_MODULE_ID) throw error;
        // Foundry rejects getFlag for inactive package scopes. Legacy profile
        // data can still be present on the raw flags object after a rename.
    }
    return user.flags?.[scope]?.[USER_CURSOR_CONFIG_FLAG];
}

export function getUserCursorConfig(user = game.user) {
    const stored = readUserCursorConfigFlag(user, MODULE_ID);
    const legacy = stored === undefined ? readUserCursorConfigFlag(user, LEGACY_MODULE_ID) : undefined;
    return normalizeUserCursorConfig(stored ?? legacy ?? {});
}

export async function migrateLegacyUserCursorConfig(user = game.user) {
    if (!user?.setFlag) return { migrated: false, reason: "user-flags-unavailable" };

    const stored = readUserCursorConfigFlag(user, MODULE_ID);
    if (stored !== undefined) return { migrated: false, reason: "current-profile-exists" };

    const legacy = readUserCursorConfigFlag(user, LEGACY_MODULE_ID);
    if (legacy === undefined) {
        // Versions before per-user flags stored the local profile in client
        // settings. Import it only when a cursor-states value was actually
        // persisted, so fresh installs do not materialize a redundant flag.
        const currentStates = getStoredSettingData("client", MODULE_ID, "cursor-states");
        const legacyStates = getStoredSettingData("client", LEGACY_MODULE_ID, "cursor-states");
        const storedStates = currentStates.found ? currentStates : legacyStates;
        if (!storedStates.found) return { migrated: false, reason: "legacy-profile-missing" };

        const readStoredProfileValue = (key, fallback) => {
            const current = getStoredSettingData("client", MODULE_ID, key);
            if (current.found) return current.value;
            const old = getStoredSettingData("client", LEGACY_MODULE_ID, key);
            return old.found ? old.value : fallback;
        };
        const normalized = normalizeUserCursorConfig({
            useCustomCursor: readStoredProfileValue("use-custom-cursor", true),
            cursorStates: storedStates.value,
            namePosition: readStoredProfileValue("cursor-name-position", "bottom-center"),
            nameOffset: readStoredProfileValue("cursor-name-offset", { x: 0, y: 1.2 })
        });
        await user.setFlag(MODULE_ID, USER_CURSOR_CONFIG_FLAG, normalized);
        return { migrated: true, source: "client-settings", profile: normalized };
    }

    const normalized = normalizeUserCursorConfig(legacy);
    await user.setFlag(MODULE_ID, USER_CURSOR_CONFIG_FLAG, normalized);
    return { migrated: true, source: "legacy-user-flag", profile: normalized };
}

export async function setUserCursorConfig(user, config) {
    if (!user) throw new Error("No user was provided for cursor configuration.");
    const normalized = normalizeUserCursorConfig(config);
    await user.setFlag(MODULE_ID, USER_CURSOR_CONFIG_FLAG, normalized);
    return normalized;
}

// Compact, log-safe summary of a cursor profile that omits bulky image paths/data.
export function summarizeCursorConfigForLog(config) {
    const states = config?.cursorStates ?? {};
    const enabledStates = Object.entries(states)
        .filter(([, state]) => state?.enabled !== false && state?.image)
        .map(([key]) => key);

    return {
        useCustomCursor: !!config?.useCustomCursor,
        namePosition: config?.namePosition ?? null,
        nameOffset: config?.nameOffset ?? null,
        stateCount: Object.keys(states).length,
        enabledImageStates: enabledStates
    };
}

function getChoiceSetting(key, choices, fallback) {
    try {
        const value = game.settings.get(MODULE_ID, key);
        return Object.prototype.hasOwnProperty.call(choices, value) ? value : fallback;
    } catch {
        return fallback;
    }
}

export function getMiddleMouseActionMode() {
    return getChoiceSetting("middle-mouse-actions", MIDDLE_MOUSE_ACTION_MODES, "both");
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
    // Foundry draws the initial canvas before its `ready` hook. During a
    // namespace upgrade, migration can therefore still be running when the
    // privacy wrapper asks for the effective sharing mode. Prefer explicitly
    // persisted values from either namespace so a legacy private preference
    // never falls through to the new-install "share" default.
    try {
        const currentMode = getStoredSettingData("client", MODULE_ID, "cursor-sharing-mode");
        if (currentMode.found && Object.prototype.hasOwnProperty.call(CURSOR_SHARING_MODES, currentMode.value)) {
            return currentMode.value;
        }

        const currentSharing = getStoredSettingData("client", MODULE_ID, "enable-cursor-sharing");
        const currentPrivate = getStoredSettingData("client", MODULE_ID, "hide-my-cursor-from-others");
        if (currentSharing.found || currentPrivate.found) {
            const legacySharing = getStoredSettingData("client", LEGACY_MODULE_ID, "enable-cursor-sharing");
            const legacyPrivate = getStoredSettingData("client", LEGACY_MODULE_ID, "hide-my-cursor-from-others");
            const sharing = currentSharing.found
                ? !!currentSharing.value
                : (legacySharing.found ? !!legacySharing.value : true);
            const privateMode = currentPrivate.found
                ? !!currentPrivate.value
                : (legacyPrivate.found ? !!legacyPrivate.value : false);
            return privateMode ? "private" : (sharing ? "share" : "receive");
        }

        const legacyMode = getStoredSettingData("client", LEGACY_MODULE_ID, "cursor-sharing-mode");
        if (legacyMode.found && Object.prototype.hasOwnProperty.call(CURSOR_SHARING_MODES, legacyMode.value)) {
            return legacyMode.value;
        }

        const legacySharing = getStoredSettingData("client", LEGACY_MODULE_ID, "enable-cursor-sharing");
        const legacyPrivate = getStoredSettingData("client", LEGACY_MODULE_ID, "hide-my-cursor-from-others");
        const hasLegacyBooleans = legacySharing.found || legacyPrivate.found;

        if (hasLegacyBooleans) {
            const sharing = legacySharing.found ? !!legacySharing.value : true;
            const privateMode = legacyPrivate.found ? !!legacyPrivate.value : false;
            return privateMode ? "private" : (sharing ? "share" : "receive");
        }
    } catch {
        // Settings storage may be unavailable during very early startup. The
        // registered value remains the final fallback below.
    }

    return getChoiceSetting("cursor-sharing-mode", CURSOR_SHARING_MODES, "share");
}

export function isCursorBroadcastEnabled() {
    return getCursorSharingMode() === "share";
}

export function isCursorPrivateMode() {
    return getCursorSharingMode() === "private";
}

export function getMarqueeTokenFilter() {
    return getChoiceSetting("marquee-token-filter", MARQUEE_TOKEN_FILTERS, "all");
}

export function getMarqueeLevelFilter() {
    return getChoiceSetting("marquee-level-filter", MARQUEE_LEVEL_FILTERS, "all");
}

export function tokenMatchesMarqueeFilter(token, filter = getMarqueeTokenFilter()) {
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

export async function migrateSettings({ includeWorld = true } = {}) {
    await migrateLegacyNamespaceSettings({ scopes: includeWorld ? ["client", "world"] : ["client"] });

    let version = getStoredSettingsVersion();

    if (version >= CURRENT_SETTINGS_VERSION) {
        await materializeCurrentLegacyCursorSharingMode();
        return;
    }

    const runStep = async (targetVersion, migrate) => {
        if (version >= targetVersion) return true;
        try {
            debugLog("cursor", `Migrating settings to v${targetVersion}...`);
            await migrate();
            await game.settings.set(MODULE_ID, "settings-version", targetVersion);
            version = targetVersion;
            return true;
        } catch (e) {
            console.warn(`${MODULE_ID} | Migration to v${targetVersion} failed; stopping at v${version}.`, e);
            throw e;
        }
    };

    if (version < 2) {
        await runStep(2, async () => {
            let oldEnabled = true;

            try { oldEnabled = game.settings.get(MODULE_ID, "use-aom-cursor"); } catch { /* legacy setting may not exist */ }

            // A stale marker can coexist with newer preferences after a partial
            // upgrade. Fill missing values; later steps normalize existing art.
            const enabled = getStoredSettingData("client", MODULE_ID, "use-custom-cursor");
            if (!enabled.found || typeof enabled.value !== "boolean") {
                await game.settings.set(MODULE_ID, "use-custom-cursor", oldEnabled);
            }
            const states = getStoredSettingData("client", MODULE_ID, "cursor-states");
            if (!states.found || !states.value || typeof states.value !== "object" || Array.isArray(states.value)) {
                await game.settings.set(MODULE_ID, "cursor-states", getDefaultCursorStates());
            }
        });
    }

    if (version < 3) {
        await runStep(3, async () => {
            const defaults = getDefaultCursorStates();
            const existingStates = game.settings.get(MODULE_ID, "cursor-states") ?? {};
            const mergedStates = foundry.utils.mergeObject(defaults, existingStates, {
                inplace: false,
                insertKeys: true,
                insertValues: true,
                overwrite: true
            });

            await game.settings.set(MODULE_ID, "cursor-states", mergedStates);
        });
    }

    if (version < 4) {
        await runStep(4, async () => {
            const targeting = game.settings.get(MODULE_ID, "use-mousewheel-targeting");
            const marquee = game.settings.get(MODULE_ID, "use-marquee-select");
            let middleMouseMode = "off";
            if (targeting && marquee) middleMouseMode = "both";
            else if (targeting) middleMouseMode = "target";
            else if (marquee) middleMouseMode = "marquee";

            const sharing = game.settings.get(MODULE_ID, "enable-cursor-sharing");
            const privateMode = game.settings.get(MODULE_ID, "hide-my-cursor-from-others");
            const cursorSharingMode = privateMode ? "private" : (sharing ? "share" : "receive");

            // Never replace an explicit compact preference with old booleans or
            // registered defaults, even when the migration marker is missing.
            if (!hasStoredChoiceSetting("middle-mouse-actions", MIDDLE_MOUSE_ACTION_MODES)) {
                await game.settings.set(MODULE_ID, "middle-mouse-actions", middleMouseMode);
            }
            if (!hasStoredChoiceSetting("cursor-sharing-mode", CURSOR_SHARING_MODES)) {
                await game.settings.set(MODULE_ID, "cursor-sharing-mode", cursorSharingMode);
            }
        });
    }


    if (version < 5) {
        await runStep(5, async () => {
            const existingStates = game.settings.get(MODULE_ID, "cursor-states") ?? {};
            await game.settings.set(MODULE_ID, "cursor-states", normalizeCursorStates(existingStates));
        });
    }
    await materializeCurrentLegacyCursorSharingMode();
    debugLog("cursor", `Migration complete (v${version}).`);
}

export async function migrateWorldSettings() {
    // Foundry V14 rejects world-setting writes before ready. Only a GM can
    // perform the namespace copy; another GM client can safely do it later.
    if (!game?.ready || !game.user?.isGM) return;
    await migrateLegacyNamespaceSettings({ scopes: ["world"] });
}
