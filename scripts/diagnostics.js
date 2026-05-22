import { MODULE_ID, SOCKET_EVENT } from './constants.js';
import {
    getMiddleMouseActionMode,
    getUserCursorConfig,
    isCursorBroadcastEnabled,
    isCursorPrivateMode,
    USER_CURSOR_CONFIG_FLAG
} from './settings.js';
import { loadImage } from './cursor-styles.js';
import {
    DIAGNOSTICS_API_VERSION,
    DIAGNOSTIC_ACTION_NAMES,
    DIAGNOSTIC_SETTING_KEYS,
    buildSmokeReport,
    collectCursorAssetCandidates,
    compareCursorStates,
    createDiagnosticActionManifest,
    jsonSafeClone,
    makeSmokeCheck,
    makeSmokeWarning,
    summarizeCursorConfig,
    validateCursorConfig,
    validateSettingsSnapshot
} from './diagnostics-core.js';

const DEFAULT_ASSET_LOAD_TIMEOUT_MS = 2000;

function tryGetSetting(key) {
    try {
        return game.settings.get(MODULE_ID, key);
    } catch (error) {
        return {
            unavailable: true,
            error: error?.message ?? String(error)
        };
    }
}

function collectSettingsSnapshot() {
    return Object.fromEntries(DIAGNOSTIC_SETTING_KEYS.map(key => [key, tryGetSetting(key)]));
}

function summarizeModule(moduleId) {
    const modulePackage = game.modules?.get?.(moduleId);
    if (!modulePackage) return { id: moduleId, found: false };

    const manifest = modulePackage.manifest ?? {};
    return {
        id: moduleId,
        found: true,
        active: !!modulePackage.active,
        title: modulePackage.title ?? manifest.title ?? moduleId,
        version: modulePackage.version ?? manifest.version ?? null
    };
}

function collectionSize(collection) {
    if (!collection) return 0;
    if (typeof collection.size === "number") return collection.size;
    if (typeof collection.length === "number") return collection.length;
    return 0;
}

function summarizeRuntime() {
    const scene = canvas?.scene ?? game.scenes?.active ?? null;
    return {
        foundry: {
            version: game.version ?? null,
            release: jsonSafeClone(game.release ?? null, { maxDepth: 2 })
        },
        world: {
            id: game.world?.id ?? null,
            title: game.world?.title ?? null
        },
        system: {
            id: game.system?.id ?? null,
            title: game.system?.title ?? null,
            version: game.system?.version ?? null
        },
        user: {
            id: game.user?.id ?? null,
            name: game.user?.name ?? null,
            isGM: !!game.user?.isGM
        },
        scene: scene
            ? {
                id: scene.id ?? null,
                name: scene.name ?? null,
                active: !!scene.active,
                tokenCount: collectionSize(scene.tokens)
            }
            : null,
        counts: {
            users: collectionSize(game.users),
            scenes: collectionSize(game.scenes),
            actors: collectionSize(game.actors),
            items: collectionSize(game.items),
            journals: collectionSize(game.journal),
            packs: collectionSize(game.packs)
        },
        canvasReady: !!canvas?.ready
    };
}

function getDebugMode() {
    const mode = tryGetSetting("debug-mode");
    return typeof mode === "string" ? mode : "off";
}

function getDiagnosticsGate() {
    const isGM = !!game.user?.isGM;
    const debugMode = getDebugMode();
    const debugEnabled = debugMode !== "off";
    const available = isGM && debugEnabled;

    return {
        available,
        isGM,
        debugMode,
        debugEnabled,
        reason: available
            ? null
            : (!isGM ? "Diagnostics require an active GM user." : "Diagnostics require Target The Beastie Debug Mode to be enabled.")
    };
}

function getStatusWarnings({ legacyComparison }) {
    const warnings = [];
    if (legacyComparison && !legacyComparison.equivalent) {
        warnings.push("Legacy client cursor-states differs from the active user cursor profile; the user flag profile is canonical.");
    }
    return warnings;
}

function collectProfileStatus(settingsSnapshot) {
    const currentConfig = getUserCursorConfig(game.user);
    const legacyCursorStates = settingsSnapshot["cursor-states"];
    const legacyComparison = compareCursorStates(legacyCursorStates, currentConfig.cursorStates);

    return {
        profileSnapshot: {
            canonicalSource: `flags.${MODULE_ID}.${USER_CURSOR_CONFIG_FLAG}`,
            currentUser: {
                id: game.user?.id ?? null,
                name: game.user?.name ?? null,
                config: jsonSafeClone(currentConfig),
                summary: summarizeCursorConfig(currentConfig)
            }
        },
        legacySettings: {
            canonicalProfileSource: `flags.${MODULE_ID}.${USER_CURSOR_CONFIG_FLAG}`,
            cursorStatesSettingKey: "cursor-states",
            useCustomCursorSettingKey: "use-custom-cursor",
            useCustomCursor: settingsSnapshot["use-custom-cursor"],
            cursorStates: jsonSafeClone(legacyCursorStates),
            cursorStatesDiffersFromUserProfile: !legacyComparison.equivalent,
            cursorStatesComparison: legacyComparison
        },
        statusWarnings: getStatusWarnings({ legacyComparison })
    };
}

function getCursorControlSettings(settingsSnapshot) {
    return {
        middleMouseActions: settingsSnapshot["middle-mouse-actions"],
        clearTargetsOnEmptyClick: settingsSnapshot["clear-targets-on-empty-click"],
        marqueeTokenFilter: settingsSnapshot["marquee-token-filter"],
        cursorSharingMode: settingsSnapshot["cursor-sharing-mode"],
        sharedCursorSize: settingsSnapshot["shared-cursor-size"],
        sharedCursorOpacity: settingsSnapshot["shared-cursor-opacity"],
        showCursorNames: settingsSnapshot["show-cursor-names"],
        foundryCursorDisplay: settingsSnapshot["foundry-cursor-display"],
        debugMode: settingsSnapshot["debug-mode"]
    };
}

function runGatedAction(action, args, handler) {
    const gate = getDiagnosticsGate();
    if (!gate.available) {
        return {
            success: false,
            action,
            diagnosticsAvailable: false,
            gate,
            error: gate.reason
        };
    }

    try {
        return jsonSafeClone({
            success: true,
            action,
            diagnosticsAvailable: true,
            gate,
            ...handler(args ?? {}, gate)
        });
    } catch (error) {
        return jsonSafeClone({
            success: false,
            action,
            diagnosticsAvailable: true,
            gate,
            error: error?.message ?? String(error)
        });
    }
}

async function runGatedActionAsync(action, args, handler) {
    const gate = getDiagnosticsGate();
    if (!gate.available) {
        return {
            success: false,
            action,
            diagnosticsAvailable: false,
            gate,
            error: gate.reason
        };
    }

    try {
        const payload = await handler(args ?? {}, gate);
        return jsonSafeClone({
            success: true,
            action,
            diagnosticsAvailable: true,
            gate,
            ...payload
        });
    } catch (error) {
        return jsonSafeClone({
            success: false,
            action,
            diagnosticsAvailable: true,
            gate,
            error: error?.message ?? String(error)
        });
    }
}

function getAssetTimeoutMs(args = {}) {
    const requested = Number(args.timeoutMs);
    if (!Number.isFinite(requested)) return DEFAULT_ASSET_LOAD_TIMEOUT_MS;
    return Math.min(10000, Math.max(250, Math.round(requested)));
}

async function loadImageForDiagnostics(src, timeoutMs) {
    if (typeof Image !== "function") {
        return {
            status: "skipped",
            reason: "The Image constructor is not available in this runtime."
        };
    }

    let timer = null;
    try {
        const img = await Promise.race([
            loadImage(src),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms.`)), timeoutMs);
            })
        ]);

        return {
            status: "ok",
            width: img.naturalWidth || img.width || null,
            height: img.naturalHeight || img.height || null
        };
    } catch (error) {
        const message = error?.message ?? String(error);
        return {
            status: message.startsWith("Timed out") ? "error" : "missing",
            error: message || "Image failed to load."
        };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function validateCursorAssetsForDiagnostics(args = {}) {
    const settingsSnapshot = collectSettingsSnapshot();
    const currentConfig = getUserCursorConfig(game.user);
    const legacyCursorStates = settingsSnapshot["cursor-states"];
    const legacyComparison = compareCursorStates(legacyCursorStates, currentConfig.cursorStates);
    const timeoutMs = getAssetTimeoutMs(args);

    const candidates = collectCursorAssetCandidates({
        currentProfile: currentConfig,
        legacyCursorStates,
        legacyUseCustomCursor: settingsSnapshot["use-custom-cursor"] === true
    });

    const results = await Promise.all(candidates.map(async candidate => {
        if (!candidate.hasImage) {
            return {
                ...candidate,
                status: "skipped",
                reason: candidate.skipReason
            };
        }

        const loadResult = await loadImageForDiagnostics(candidate.image, timeoutMs);
        return {
            ...candidate,
            ...loadResult,
            reason: loadResult.status === "ok" ? null : candidate.skipReason
        };
    }));

    const activeFailures = results.filter(result => result.active && ["missing", "error"].includes(result.status));
    const inactiveIssues = results.filter(result => !result.active && ["missing", "error"].includes(result.status));
    const statusCounts = results.reduce((counts, result) => {
        counts[result.status] = (counts[result.status] ?? 0) + 1;
        return counts;
    }, {});

    return {
        source: "currentUserAndLegacySettings",
        timeoutMs,
        createsDocuments: false,
        currentUser: {
            id: game.user?.id ?? null,
            name: game.user?.name ?? null,
            profileValidation: validateCursorConfig(currentConfig),
            profileSummary: summarizeCursorConfig(currentConfig)
        },
        legacy: {
            cursorStatesDiffersFromUserProfile: !legacyComparison.equivalent,
            cursorStatesComparison: legacyComparison
        },
        summary: {
            total: results.length,
            ok: statusCounts.ok ?? 0,
            skipped: statusCounts.skipped ?? 0,
            missing: statusCounts.missing ?? 0,
            error: statusCounts.error ?? 0,
            activeFailures: activeFailures.length,
            inactiveIssues: inactiveIssues.length
        },
        activeFailures: jsonSafeClone(activeFailures),
        inactiveIssues: jsonSafeClone(inactiveIssues),
        results: jsonSafeClone(results)
    };
}

export function createDiagnostics({
    getDebugState,
    openAdvancedSettings,
    openCursorConfig
} = {}) {
    const actions = {
        getStatus(args = {}) {
            return runGatedAction("getStatus", args, () => {
                const settingsSnapshot = collectSettingsSnapshot();
                const profileStatus = collectProfileStatus(settingsSnapshot);
                return {
                    apiVersion: DIAGNOSTICS_API_VERSION,
                    module: summarizeModule(MODULE_ID),
                    runtime: summarizeRuntime(),
                    settingsSnapshot,
                    settings: {
                        currentControls: getCursorControlSettings(settingsSnapshot),
                        legacyProfileStorage: profileStatus.legacySettings
                    },
                    profileSnapshot: profileStatus.profileSnapshot,
                    legacySettings: profileStatus.legacySettings,
                    warnings: profileStatus.statusWarnings,
                    integrations: {
                        socketNamespace: SOCKET_EVENT,
                        foundryMcpBridge: summarizeModule("foundry-mcp-bridge"),
                        cursorSharingMode: tryGetSetting("cursor-sharing-mode"),
                        cursorBroadcastEnabled: isCursorBroadcastEnabled(),
                        cursorPrivateMode: isCursorPrivateMode()
                    },
                    diagnostics: {
                        actionMetadata: createDiagnosticActionManifest(),
                        availableActions: [...DIAGNOSTIC_ACTION_NAMES],
                        allowlisted: true,
                        arbitraryEval: false,
                        arbitraryPropertyWalking: false,
                        createsDocumentsByDefault: false
                    },
                    debugState: jsonSafeClone(getDebugState?.() ?? null, { maxDepth: 5 })
                };
            });
        },

        validateCursorConfig(args = {}) {
            return runGatedAction("validateCursorConfig", args, () => {
                const hasProvidedConfig = Object.prototype.hasOwnProperty.call(args, "config");
                const config = hasProvidedConfig ? args.config : getUserCursorConfig(game.user);
                return {
                    source: hasProvidedConfig ? "args.config" : "currentUser",
                    validation: validateCursorConfig(config),
                    createsDocuments: false
                };
            });
        },

        validateCursorAssets(args = {}) {
            return runGatedActionAsync("validateCursorAssets", args, () => validateCursorAssetsForDiagnostics(args));
        },

        openWindow(args = {}) {
            return runGatedAction("openWindow", args, () => {
                const windowName = String(args.window ?? "advanced");
                if (windowName === "advanced") {
                    openAdvancedSettings?.();
                    return { opened: "advanced", createsDocuments: false };
                }
                if (windowName === "cursor") {
                    openCursorConfig?.({ targetUserId: args.targetUserId });
                    return { opened: "cursor", createsDocuments: false };
                }
                return {
                    opened: null,
                    createsDocuments: false,
                    error: "Unknown diagnostics window.",
                    allowedWindows: ["advanced", "cursor"]
                };
            });
        },

        runSmokeTests(args = {}) {
            return runGatedActionAsync("runSmokeTests", args, async () => {
                const settingsSnapshot = collectSettingsSnapshot();
                const settingsValidation = validateSettingsSnapshot(settingsSnapshot);
                const currentConfig = getUserCursorConfig(game.user);
                const cursorValidation = validateCursorConfig(currentConfig);
                const assetValidation = await validateCursorAssetsForDiagnostics(args);
                const actionNames = Object.keys(actions).sort();
                const expectedActions = [...DIAGNOSTIC_ACTION_NAMES].sort();
                const debugState = getDebugState?.() ?? null;
                const cursorSharing = debugState?.cursorSharing ?? null;

                const checks = [
                    makeSmokeCheck(
                        "diagnostics action allowlist",
                        JSON.stringify(actionNames) === JSON.stringify(expectedActions),
                        { actionNames, expectedActions }
                    ),
                    makeSmokeCheck(
                        "diagnostics actions do not create documents",
                        Object.values(createDiagnosticActionManifest()).every(metadata => metadata.createsDocuments === false),
                        { actionMetadata: createDiagnosticActionManifest() }
                    ),
                    makeSmokeCheck("settings snapshot validates", settingsValidation),
                    makeSmokeCheck("current cursor profile validates", cursorValidation),
                    makeSmokeCheck(
                        "active cursor assets load",
                        assetValidation.summary.activeFailures === 0,
                        { activeFailures: assetValidation.activeFailures }
                    ),
                    makeSmokeCheck(
                        "debug state is JSON-safe",
                        !!jsonSafeClone(debugState),
                        { hasDebugState: !!debugState }
                    ),
                    makeSmokeCheck(
                        "middle mouse mode resolves",
                        ["off", "target", "marquee", "both"].includes(getMiddleMouseActionMode()),
                        { middleMouseMode: getMiddleMouseActionMode() }
                    )
                ];

                if (assetValidation.summary.inactiveIssues > 0) {
                    checks.push(makeSmokeWarning("inactive or legacy cursor asset paths have issues", {
                        inactiveIssues: assetValidation.inactiveIssues
                    }));
                }

                if (settingsSnapshot["cursor-sharing-mode"] === "share" && canvas?.ready) {
                    checks.push(makeSmokeCheck(
                        "cursor sharing is active in share mode",
                        cursorSharing?.active === true && cursorSharing?.broadcastEnabled === true,
                        { cursorSharing }
                    ));
                    checks.push(makeSmokeCheck(
                        "cursor sharing mouse handler is registered",
                        cursorSharing?.registeredMouseHandler === true,
                        { cursorSharing }
                    ));

                    const defaultState = currentConfig.cursorStates?.default;
                    const shouldHaveCachedImage = currentConfig.useCustomCursor && !!defaultState?.image;
                    if (shouldHaveCachedImage && cursorSharing?.broadcastInFlight) {
                        checks.push(makeSmokeWarning("shared cursor image cache is still building", { cursorSharing }));
                    } else if (shouldHaveCachedImage) {
                        checks.push(makeSmokeCheck(
                            "shared cursor image cache is populated",
                            cursorSharing?.hasCachedCursorImage === true,
                            { cursorSharing }
                        ));
                    }
                }

                if (!canvas?.ready) {
                    checks.push(makeSmokeWarning("canvas is not ready", { canvasReady: false }));
                }

                return {
                    smokeTestArgs: jsonSafeClone(args),
                    cursorAssetValidation: {
                        summary: assetValidation.summary,
                        createsDocuments: assetValidation.createsDocuments
                    },
                    report: buildSmokeReport(checks)
                };
            });
        }
    };

    return Object.freeze({
        version: DIAGNOSTICS_API_VERSION,
        getGate: () => getDiagnosticsGate(),
        actionMetadata: createDiagnosticActionManifest(),
        actions
    });
}
