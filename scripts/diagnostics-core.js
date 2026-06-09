import { CURSOR_STATE_KEYS, DEFAULT_CURSOR_PATH } from './constants.js';

export const DIAGNOSTICS_API_VERSION = 1;

export const DIAGNOSTIC_ACTION_METADATA = Object.freeze({
    getStatus: Object.freeze({
        description: "Return a structured module/runtime diagnostics snapshot.",
        createsDocuments: false,
        sideEffects: "none"
    }),
    validateSettings: Object.freeze({
        description: "Validate registered Target The Beastie settings without saving or creating documents.",
        createsDocuments: false,
        sideEffects: "none"
    }),
    validateAssets: Object.freeze({
        description: "Run module asset validation without saving or creating documents.",
        createsDocuments: false,
        sideEffects: "client-image-load"
    }),
    validateV14Runtime: Object.freeze({
        description: "Validate the expected Foundry V14 runtime contracts without saving or creating documents.",
        createsDocuments: false,
        sideEffects: "none"
    }),
    collectClientDiagnostics: Object.freeze({
        description: "Return a compact client diagnostics snapshot through the module diagnostics API.",
        createsDocuments: false,
        sideEffects: "none"
    }),
    runSmokeTests: Object.freeze({
        description: "Run structured non-destructive diagnostics smoke checks.",
        createsDocuments: false,
        sideEffects: "none"
    }),
    refreshClient: Object.freeze({
        description: "Schedule a gated hard refresh of this Foundry client.",
        createsDocuments: false,
        sideEffects: "reloads-client"
    }),
    validateCursorConfig: Object.freeze({
        description: "Validate a cursor profile object without saving or creating documents.",
        createsDocuments: false,
        sideEffects: "none"
    }),
    validateCursorAssets: Object.freeze({
        description: "Verify configured cursor image paths can be loaded by the Foundry client without saving or creating documents.",
        createsDocuments: false,
        sideEffects: "client-image-load"
    }),
    openWindow: Object.freeze({
        description: "Open a local module configuration window for the GM.",
        createsDocuments: false,
        sideEffects: "opens-ui"
    }),
    runAutomation: Object.freeze({
        description: "Run gated MCP Diagnostics Automation with temporary module-owned fixtures.",
        createsDocuments: true,
        sideEffects: "creates-temporary-fixtures"
    }),
    cleanupFixtures: Object.freeze({
        description: "Delete only module-owned MCP diagnostics fixtures in the active scene.",
        createsDocuments: true,
        sideEffects: "deletes-temporary-fixtures"
    })
});

export const DIAGNOSTIC_ACTION_NAMES = Object.freeze(Object.keys(DIAGNOSTIC_ACTION_METADATA));

export const READ_ONLY_DIAGNOSTIC_ACTION_NAMES = Object.freeze([
    "getStatus",
    "validateSettings",
    "validateAssets",
    "validateV14Runtime",
    "collectClientDiagnostics",
    "runSmokeTests",
    "refreshClient",
    "validateCursorConfig",
    "validateCursorAssets",
    "openWindow"
]);

export const MUTATING_DIAGNOSTIC_ACTION_NAMES = Object.freeze([
    "runAutomation",
    "cleanupFixtures"
]);

export const DIAGNOSTIC_SETTING_KEYS = Object.freeze([
    "use-aom-cursor",
    "cursor-hotspot-x",
    "cursor-hotspot-y",
    "use-mousewheel-targeting",
    "use-marquee-select",
    "middle-mouse-actions",
    "clear-targets-on-empty-click",
    "use-custom-cursor",
    "cursor-states",
    "marquee-token-filter",
    "shared-cursor-size",
    "shared-cursor-opacity",
    "show-cursor-names",
    "cursor-name-position",
    "cursor-name-offset",
    "foundry-cursor-display",
    "disable-cursor-fade",
    "idle-identity-fade",
    "enable-cursor-sharing",
    "hide-my-cursor-from-others",
    "cursor-sharing-mode",
    "hidden-shared-cursor-users",
    "debug-mode",
    "enableMcpDiagnostics",
    "settings-version"
]);

const CHOICE_SETTINGS = Object.freeze({
    "middle-mouse-actions": Object.freeze(["off", "target", "marquee", "both"]),
    "marquee-token-filter": Object.freeze(["all", "hostile", "neutral", "friendly", "nonFriendly"]),
    "foundry-cursor-display": Object.freeze(["both", "names-only", "dots-only", "none"]),
    "cursor-sharing-mode": Object.freeze(["share", "receive", "private"]),
    "debug-mode": Object.freeze(["off", "all", "cursor", "states", "config", "sharing", "marquee"])
});

const NAME_POSITIONS = Object.freeze(["bottom-center", "bottom-right", "top-center", "right", "custom"]);
const CURSOR_SIZE_MAX = 128;
const HOTSPOT_MAX = 128;

function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}

function validateNumericRange(errors, path, value, min, max, { allowZero = false } = {}) {
    if (!isFiniteNumber(value)) {
        errors.push(`${path} must be a finite number.`);
        return;
    }

    const lower = allowZero && value === 0 ? 0 : min;
    if (value < lower || value > max) {
        errors.push(`${path} must be between ${lower} and ${max}.`);
    }
}

export function jsonSafeClone(value, options = {}) {
    const config = {
        maxDepth: options.maxDepth ?? 6,
        maxArrayLength: options.maxArrayLength ?? 100,
        maxStringLength: options.maxStringLength ?? 2000,
        maxObjectKeys: options.maxObjectKeys ?? 100
    };

    return cloneJsonSafeValue(value, config, 0, new WeakSet());
}

function cloneJsonSafeValue(value, options, depth, seen) {
    if (value === null || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") {
        return value.length > options.maxStringLength
            ? `${value.slice(0, options.maxStringLength)}...`
            : value;
    }
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "undefined") return null;
    if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: typeof value.stack === "string" ? value.stack.split("\n").slice(0, 8).join("\n") : null
        };
    }

    if (typeof value !== "object") return String(value);
    if (seen.has(value)) return "[Circular]";
    if (depth >= options.maxDepth) return summarizeObject(value);

    seen.add(value);

    if (Array.isArray(value)) {
        const output = value
            .slice(0, options.maxArrayLength)
            .map(item => cloneJsonSafeValue(item, options, depth + 1, seen));
        if (value.length > options.maxArrayLength) output.push(`[${value.length - options.maxArrayLength} more items]`);
        seen.delete(value);
        return output;
    }

    const output = {};
    const keys = Object.keys(value).slice(0, options.maxObjectKeys);
    for (const key of keys) {
        output[key] = cloneJsonSafeValue(value[key], options, depth + 1, seen);
    }

    const allKeys = Object.keys(value);
    if (allKeys.length > options.maxObjectKeys) output.__truncatedKeys = allKeys.length - options.maxObjectKeys;
    seen.delete(value);
    return output;
}

function summarizeObject(value) {
    const ctor = value?.constructor?.name || "Object";
    const id = value?.id ?? value?._id;
    const name = value?.name ?? value?.title;
    return `[${[ctor, id ? `id=${id}` : "", name ? `name=${name}` : ""].filter(Boolean).join(" ")}]`;
}

export function createDiagnosticActionManifest() {
    return Object.fromEntries(
        Object.entries(DIAGNOSTIC_ACTION_METADATA).map(([name, metadata]) => [
            name,
            jsonSafeClone(metadata)
        ])
    );
}

export function validateCursorConfig(config) {
    const errors = [];
    const warnings = [];

    if (!isPlainObject(config)) {
        return {
            valid: false,
            errors: ["Cursor config must be an object."],
            warnings,
            summary: { stateCount: 0, enabledStates: [] }
        };
    }

    if (typeof config.useCustomCursor !== "boolean") {
        errors.push("useCustomCursor must be a boolean.");
    }

    if (!isPlainObject(config.cursorStates)) {
        errors.push("cursorStates must be an object keyed by cursor state.");
    }

    const states = isPlainObject(config.cursorStates) ? config.cursorStates : {};
    const enabledStates = [];

    for (const key of CURSOR_STATE_KEYS) {
        const path = `cursorStates.${key}`;
        const state = states[key];
        if (!isPlainObject(state)) {
            errors.push(`${path} must be an object.`);
            continue;
        }

        if (typeof state.image !== "string") errors.push(`${path}.image must be a string.`);
        if (key === "default" && config.useCustomCursor && !state.image) {
            errors.push(`${path}.image is required when custom cursors are enabled.`);
        }

        validateNumericRange(errors, `${path}.hotspotX`, state.hotspotX, 0, HOTSPOT_MAX);
        validateNumericRange(errors, `${path}.hotspotY`, state.hotspotY, 0, HOTSPOT_MAX);
        validateNumericRange(errors, `${path}.rotation`, state.rotation, 0, 359);
        validateNumericRange(errors, `${path}.width`, state.width, 1, CURSOR_SIZE_MAX, { allowZero: true });
        validateNumericRange(errors, `${path}.height`, state.height, 1, CURSOR_SIZE_MAX, { allowZero: true });

        if (typeof state.enabled !== "boolean") errors.push(`${path}.enabled must be a boolean.`);
        if (state.enabled) enabledStates.push(key);
        if (key === "default" && state.enabled === false) {
            warnings.push("cursorStates.default.enabled is false; the UI treats default as the baseline cursor.");
        }
    }

    const unknownStates = Object.keys(states).filter(key => !CURSOR_STATE_KEYS.includes(key));
    if (unknownStates.length) warnings.push(`Unknown cursor state keys: ${unknownStates.join(", ")}.`);

    if (!NAME_POSITIONS.includes(config.namePosition)) {
        errors.push(`namePosition must be one of: ${NAME_POSITIONS.join(", ")}.`);
    }

    if (!isPlainObject(config.nameOffset)) {
        errors.push("nameOffset must be an object with x and y numbers.");
    } else {
        if (!isFiniteNumber(config.nameOffset.x)) errors.push("nameOffset.x must be a finite number.");
        if (!isFiniteNumber(config.nameOffset.y)) errors.push("nameOffset.y must be a finite number.");
    }

    const defaultImageMatches = states.default?.image === DEFAULT_CURSOR_PATH;
    return {
        valid: errors.length === 0,
        errors,
        warnings,
        summary: {
            stateCount: Object.keys(states).length,
            enabledStates,
            defaultImageMatchesBuiltIn: defaultImageMatches
        }
    };
}

function summarizeStateForComparison(state) {
    if (!isPlainObject(state)) return null;
    return {
        image: typeof state.image === "string" ? state.image : null,
        hotspotX: isFiniteNumber(state.hotspotX) ? state.hotspotX : null,
        hotspotY: isFiniteNumber(state.hotspotY) ? state.hotspotY : null,
        rotation: isFiniteNumber(state.rotation) ? state.rotation : null,
        width: isFiniteNumber(state.width) ? state.width : null,
        height: isFiniteNumber(state.height) ? state.height : null,
        enabled: typeof state.enabled === "boolean" ? state.enabled : null
    };
}

function sortUnknownStateKeys(states) {
    if (!isPlainObject(states)) return [];
    return Object.keys(states).filter(key => !CURSOR_STATE_KEYS.includes(key)).sort();
}

export function compareCursorStates(leftStates, rightStates) {
    const differingStates = [];

    for (const key of CURSOR_STATE_KEYS) {
        const left = summarizeStateForComparison(leftStates?.[key]);
        const right = summarizeStateForComparison(rightStates?.[key]);
        if (JSON.stringify(left) !== JSON.stringify(right)) differingStates.push(key);
    }

    const leftOnlyUnknownStates = sortUnknownStateKeys(leftStates).filter(key => !Object.prototype.hasOwnProperty.call(rightStates ?? {}, key));
    const rightOnlyUnknownStates = sortUnknownStateKeys(rightStates).filter(key => !Object.prototype.hasOwnProperty.call(leftStates ?? {}, key));

    return {
        equivalent: differingStates.length === 0 && leftOnlyUnknownStates.length === 0 && rightOnlyUnknownStates.length === 0,
        differingStates,
        leftOnlyUnknownStates,
        rightOnlyUnknownStates
    };
}

export function summarizeCursorConfig(config) {
    const states = isPlainObject(config?.cursorStates) ? config.cursorStates : {};
    return {
        useCustomCursor: typeof config?.useCustomCursor === "boolean" ? config.useCustomCursor : null,
        namePosition: typeof config?.namePosition === "string" ? config.namePosition : null,
        nameOffset: isPlainObject(config?.nameOffset)
            ? {
                x: isFiniteNumber(Number(config.nameOffset.x)) ? Number(config.nameOffset.x) : null,
                y: isFiniteNumber(Number(config.nameOffset.y)) ? Number(config.nameOffset.y) : null
            }
            : null,
        validation: validateCursorConfig(config),
        states: CURSOR_STATE_KEYS.map(key => {
            const state = states[key];
            return {
                key,
                enabled: typeof state?.enabled === "boolean" ? state.enabled : null,
                hasImage: typeof state?.image === "string" && state.image.length > 0,
                image: typeof state?.image === "string" ? state.image : null,
                hotspotX: isFiniteNumber(state?.hotspotX) ? state.hotspotX : null,
                hotspotY: isFiniteNumber(state?.hotspotY) ? state.hotspotY : null,
                rotation: isFiniteNumber(state?.rotation) ? state.rotation : null,
                width: isFiniteNumber(state?.width) ? state.width : null,
                height: isFiniteNumber(state?.height) ? state.height : null
            };
        })
    };
}

function isRuntimeCursorAssetActive(key, state, useCustomCursor) {
    if (!useCustomCursor) return false;
    if (!state?.image) return false;
    if (key === "default") return true;
    return state.enabled !== false;
}

function getCursorAssetSkipReason({ appliesToRuntime, useCustomCursor, key, state }) {
    if (!state?.image) return "No image path is configured; Foundry native fallback is used.";
    if (!appliesToRuntime) return "Legacy client cursor-state setting is not the canonical runtime profile.";
    if (!useCustomCursor) return "Custom cursor rendering is disabled for this profile.";
    if (key !== "default" && state.enabled === false) return "Cursor state is disabled.";
    return null;
}

export function collectCursorAssetCandidates({
    currentProfile,
    legacyCursorStates,
    legacyUseCustomCursor = false
} = {}) {
    const sources = [
        {
            source: "currentUserProfile",
            sourceLabel: "Current user cursor profile",
            cursorStates: currentProfile?.cursorStates,
            useCustomCursor: currentProfile?.useCustomCursor === true,
            appliesToRuntime: true
        },
        {
            source: "legacyClientSetting",
            sourceLabel: "Legacy client cursor-states setting",
            cursorStates: legacyCursorStates,
            useCustomCursor: legacyUseCustomCursor === true,
            appliesToRuntime: false
        }
    ];

    const candidates = [];
    for (const source of sources) {
        if (!isPlainObject(source.cursorStates)) continue;

        for (const key of CURSOR_STATE_KEYS) {
            const state = source.cursorStates[key];
            if (!isPlainObject(state)) continue;

            const image = typeof state.image === "string" ? state.image : "";
            const active = isRuntimeCursorAssetActive(key, state, source.useCustomCursor) && source.appliesToRuntime;
            candidates.push({
                source: source.source,
                sourceLabel: source.sourceLabel,
                state: key,
                image,
                hasImage: image.length > 0,
                enabledInSource: key === "default" ? state.enabled !== false : state.enabled !== false,
                active,
                appliesToRuntime: source.appliesToRuntime,
                skipReason: getCursorAssetSkipReason({
                    appliesToRuntime: source.appliesToRuntime,
                    useCustomCursor: source.useCustomCursor,
                    key,
                    state
                })
            });
        }
    }

    return candidates;
}

export function validateSettingsSnapshot(snapshot) {
    const errors = [];
    const warnings = [];

    if (!isPlainObject(snapshot)) {
        return { valid: false, errors: ["Settings snapshot must be an object."], warnings };
    }

    for (const key of DIAGNOSTIC_SETTING_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(snapshot, key)) {
            errors.push(`Missing setting: ${key}.`);
        }
    }

    for (const [key, choices] of Object.entries(CHOICE_SETTINGS)) {
        if (!Object.prototype.hasOwnProperty.call(snapshot, key)) continue;
        if (!choices.includes(snapshot[key])) {
            errors.push(`${key} has invalid value: ${String(snapshot[key])}.`);
        }
    }

    if (isFiniteNumber(snapshot["shared-cursor-size"])) {
        const size = snapshot["shared-cursor-size"];
        if (size < 16 || size > 128) errors.push("shared-cursor-size must be between 16 and 128.");
    }

    if (isFiniteNumber(snapshot["shared-cursor-opacity"])) {
        const opacity = snapshot["shared-cursor-opacity"];
        if (opacity < 0.1 || opacity > 1) errors.push("shared-cursor-opacity must be between 0.1 and 1.");
    }

    if (!isPlainObject(snapshot["hidden-shared-cursor-users"])) {
        warnings.push("hidden-shared-cursor-users is not an object; legacy values are tolerated but should migrate on save.");
    }

    for (const key of ["enableMcpDiagnostics"]) {
        if (Object.prototype.hasOwnProperty.call(snapshot, key) && typeof snapshot[key] !== "boolean") {
            errors.push(`${key} must be a boolean.`);
        }
    }

    return { valid: errors.length === 0, errors, warnings };
}

export function validateV14RuntimeSnapshot(snapshot) {
    const errors = [];
    const warnings = [];

    if (!isPlainObject(snapshot)) {
        return {
            valid: false,
            errors: ["V14 runtime snapshot must be an object."],
            warnings,
            summary: {
                foundryGeneration: null,
                canvasReady: false,
                checkedContracts: 0,
                availableContracts: 0
            }
        };
    }

    const runtimeChecks = isPlainObject(snapshot.runtimeChecks) ? snapshot.runtimeChecks : snapshot;
    const foundryGeneration = Number(runtimeChecks.foundryGeneration ?? runtimeChecks.generation);
    const canvasReady = runtimeChecks.canvasReady === true;
    const requiredContracts = Object.freeze([
        ["applicationV2", "foundry.applications.api.ApplicationV2"],
        ["handlebarsApplicationMixin", "foundry.applications.api.HandlebarsApplicationMixin"],
        ["dialogV2", "foundry.applications.api.DialogV2.confirm"],
        ["filePickerImplementation", "foundry.applications.apps.FilePicker.implementation"],
        ["formDataExtended", "foundry.applications.ux.FormDataExtended"],
        ["configureCursors", "game.configureCursors"],
        ["registerMouseMoveHandler", "canvas.registerMouseMoveHandler"]
    ]);

    if (!Number.isFinite(foundryGeneration)) {
        errors.push("Foundry generation could not be determined.");
    } else if (foundryGeneration !== 14) {
        errors.push(`Expected Foundry generation 14; found ${foundryGeneration}.`);
    }

    let availableContracts = 0;
    for (const [key, label] of requiredContracts) {
        if (runtimeChecks[key] === true) {
            availableContracts += 1;
        } else {
            errors.push(`${label} is unavailable.`);
        }
    }

    if (canvasReady) {
        if (runtimeChecks.canvasControlsCursors === true) {
            availableContracts += 1;
        } else {
            errors.push("canvas.controls.cursors is unavailable while canvas is ready.");
        }
    } else {
        warnings.push("Canvas is not ready; canvas.controls.cursors was observed but not required.");
    }

    const sceneLevelInfo = isPlainObject(runtimeChecks.sceneLevelInfo)
        ? runtimeChecks.sceneLevelInfo
        : (isPlainObject(snapshot.sceneLevelInfo) ? snapshot.sceneLevelInfo : null);
    if (sceneLevelInfo?.error) {
        warnings.push(`Scene level observation failed: ${sceneLevelInfo.error}`);
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        summary: {
            foundryGeneration: Number.isFinite(foundryGeneration) ? foundryGeneration : null,
            canvasReady,
            checkedContracts: requiredContracts.length + (canvasReady ? 1 : 0),
            availableContracts,
            hasSceneLevelInfo: !!sceneLevelInfo,
            hasAvailableLevels: sceneLevelInfo?.hasAvailableLevels === true,
            availableLevelCount: Number.isFinite(sceneLevelInfo?.availableLevelCount)
                ? sceneLevelInfo.availableLevelCount
                : null,
            hasFirstLevel: sceneLevelInfo?.hasFirstLevel === true
        }
    };
}

export function makeSmokeCheck(name, validation, details = {}) {
    if (typeof validation === "boolean") {
        return { name, status: validation ? "pass" : "fail", details: jsonSafeClone(details) };
    }

    const valid = !!validation?.valid;
    return {
        name,
        status: valid ? "pass" : "fail",
        details: jsonSafeClone({
            ...details,
            errors: validation?.errors ?? [],
            warnings: validation?.warnings ?? []
        })
    };
}

export function makeSmokeWarning(name, details = {}) {
    return { name, status: "warn", details: jsonSafeClone(details) };
}

export function buildSmokeReport(checks) {
    const safeChecks = jsonSafeClone(checks);
    const failed = safeChecks.filter(check => check.status === "fail");
    const warned = safeChecks.filter(check => check.status === "warn");
    const passed = safeChecks.filter(check => check.status === "pass");

    return {
        passed: failed.length === 0,
        createsDocuments: false,
        summary: {
            total: safeChecks.length,
            passed: passed.length,
            failed: failed.length,
            warnings: warned.length
        },
        checks: safeChecks
    };
}
