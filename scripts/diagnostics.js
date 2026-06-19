import { MODULE_ID, LEGACY_MODULE_ID, SOCKET_EVENT } from './constants.js';
import {
    getMiddleMouseActionMode,
    getMarqueeLevelFilter,
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
    MUTATING_DIAGNOSTIC_ACTION_NAMES,
    READ_ONLY_DIAGNOSTIC_ACTION_NAMES,
    buildSmokeReport,
    collectCursorAssetCandidates,
    compareCursorStates,
    createDiagnosticActionManifest,
    jsonSafeClone,
    makeSmokeCheck,
    makeSmokeWarning,
    runCoreSelfChecks,
    summarizeCursorConfig,
    validateCursorConfig,
    validateV14RuntimeSnapshot,
    validateSettingsSnapshot
} from './diagnostics-core.js';
import {
    FIXTURE_FLAG,
    FIXTURE_PREFIX,
    cleanupFixtures as cleanupAutomationFixtures,
    getFixtureStatus,
    runAutomation as runDiagnosticsAutomation
} from './mcp-diagnostics-automation.js';
import { getShowCursorPermissionState } from './foundry-permissions.js';
import { getMarqueeLevelFilterStatus } from './scene-levels.js';
import { getCursorPrivacyBroadcastDebugState } from './privacy-broadcast.js';

const DEFAULT_ASSET_LOAD_TIMEOUT_MS = 2000;
const DEFAULT_CLIENT_DIAGNOSTICS_TIMEOUT_MS = 1000;
const CLIENT_DIAGNOSTICS_REQUEST = "mcpDiagnosticsClientRequest";
const CLIENT_DIAGNOSTICS_RESPONSE = "mcpDiagnosticsClientResponse";

let diagnosticsSocketResponderInstalled = false;

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

function collectionValues(collection, limit = 25) {
    if (!collection) return [];
    if (Array.isArray(collection)) return collection.slice(0, limit);
    if (Array.isArray(collection.contents)) return collection.contents.slice(0, limit);
    if (typeof collection.values === "function") {
        try {
            return [...collection.values()].slice(0, limit);
        } catch (error) {
            return [];
        }
    }
    if (typeof collection[Symbol.iterator] === "function") {
        try {
            return [...collection].slice(0, limit);
        } catch (error) {
            return [];
        }
    }
    return [];
}

function getActiveScene() {
    return canvas?.scene ?? game.scenes?.active ?? null;
}

function getWorldDataCounts() {
    const scene = getActiveScene();
    return {
        users: collectionSize(game.users),
        scenes: collectionSize(game.scenes),
        actors: collectionSize(game.actors),
        items: collectionSize(game.items),
        journals: collectionSize(game.journal),
        packs: collectionSize(game.packs),
        activeSceneTokens: collectionSize(scene?.tokens)
    };
}

function summarizeRuntime() {
    const scene = getActiveScene();
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
            isGM: !!game.user?.isGM,
            active: !!game.user?.active,
            showCursorPermission: getShowCursorPermissionState(game.user)
        },
        scene: scene
            ? {
                id: scene.id ?? null,
                name: scene.name ?? null,
                active: !!scene.active,
                tokenCount: collectionSize(scene.tokens)
            }
            : null,
        counts: getWorldDataCounts(),
        canvasReady: !!canvas?.ready
    };
}

function getDebugMode() {
    const mode = tryGetSetting("debug-mode");
    return typeof mode === "string" ? mode : "off";
}

function getGateReason(gates) {
    if (!gates.activeGMUser) return "Diagnostics require an active GM user.";
    if (!gates.debugLogging) return "Diagnostics require Show of Hands Debug Mode to be enabled.";
    if (!gates.enableMcpDiagnostics) return "Diagnostics require Enable MCP Diagnostics to be enabled.";
    return null;
}

function getDiagnosticsGate() {
    const activeGMUser = !!game.user?.isGM;
    const debugMode = getDebugMode();
    const debugLogging = debugMode !== "off";
    const enableMcpDiagnostics = tryGetSetting("enableMcpDiagnostics") === true;
    const gates = {
        activeGMUser,
        debugLogging,
        enableMcpDiagnostics
    };
    const available = Object.values(gates).every(Boolean);

    return {
        available,
        isGM: activeGMUser,
        activeGMUser,
        debugMode,
        debugEnabled: debugLogging,
        debugLogging,
        enableMcpDiagnostics,
        gates,
        reason: available ? null : getGateReason(gates)
    };
}

function getMutationAvailability(args = {}) {
    const diagnostics = getDiagnosticsGate();
    // Fixture automation needs both the diagnostics gate and a per-call opt-in.
    // That keeps normal status checks and smoke checks read-only by default.
    const confirmMutation = args.confirmMutation === true;
    const gates = {
        ...diagnostics.gates,
        confirmMutation
    };
    const available = diagnostics.available && confirmMutation;

    return {
        available,
        diagnosticsAvailable: diagnostics.available,
        mutationEnabled: diagnostics.available,
        confirmMutation,
        gates,
        reason: available
            ? null
            : (
                diagnostics.reason ??
                "MCP Diagnostics Automation requires confirmMutation: true."
            )
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
            legacySource: `flags.${LEGACY_MODULE_ID}.${USER_CURSOR_CONFIG_FLAG}`,
            currentUser: {
                id: game.user?.id ?? null,
                name: game.user?.name ?? null,
                config: jsonSafeClone(currentConfig),
                summary: summarizeCursorConfig(currentConfig)
            }
        },
        legacySettings: {
            canonicalProfileSource: `flags.${MODULE_ID}.${USER_CURSOR_CONFIG_FLAG}`,
            legacyProfileSource: `flags.${LEGACY_MODULE_ID}.${USER_CURSOR_CONFIG_FLAG}`,
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
        marqueeLevelFilter: settingsSnapshot["marquee-level-filter"],
        cursorSharingMode: settingsSnapshot["cursor-sharing-mode"],
        sharedCursorSize: settingsSnapshot["shared-cursor-size"],
        sharedCursorOpacity: settingsSnapshot["shared-cursor-opacity"],
        showCursorNames: settingsSnapshot["show-cursor-names"],
        foundryCursorDisplay: settingsSnapshot["foundry-cursor-display"],
        debugMode: settingsSnapshot["debug-mode"],
        enableMcpDiagnostics: settingsSnapshot.enableMcpDiagnostics
    };
}

function runGatedAction(action, args, handler) {
    // The diagnostics API is for GM troubleshooting and review. It stays closed
    // unless debug logging and the explicit diagnostics setting are both on.
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

async function runGatedMutationActionAsync(action, args, handler) {
    // Mutating actions are intentionally separate from the read-only gate so
    // callers must acknowledge temporary fixture work on each request.
    const gate = getMutationAvailability(args ?? {});
    if (!gate.available) {
        return {
            success: false,
            action,
            diagnosticsAvailable: gate.diagnosticsAvailable,
            mutationAvailable: false,
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
            mutationAvailable: true,
            gate,
            ...payload
        });
    } catch (error) {
        return jsonSafeClone({
            success: false,
            action,
            diagnosticsAvailable: true,
            mutationAvailable: true,
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

function getClientDiagnosticsTimeoutMs(args = {}) {
    const requested = Number(args.timeoutMs);
    if (!Number.isFinite(requested)) return DEFAULT_CLIENT_DIAGNOSTICS_TIMEOUT_MS;
    return Math.min(5000, Math.max(250, Math.round(requested)));
}

function getRefreshDelayMs(args = {}) {
    const requested = Number(args.delayMs);
    if (!Number.isFinite(requested)) return 250;
    return Math.min(5000, Math.max(0, Math.round(requested)));
}

function getFoundryGeneration() {
    const releaseGeneration = Number(game.release?.generation);
    if (Number.isFinite(releaseGeneration)) return releaseGeneration;

    const versionGeneration = Number(String(game.version ?? "").split(".")[0]);
    return Number.isFinite(versionGeneration) ? versionGeneration : null;
}

function summarizeSceneLevel(level) {
    if (!level || typeof level !== "object") return null;
    const rawElevation = Number(level.elevation ?? level.level ?? level.value);
    return {
        id: level.id ?? level._id ?? null,
        name: level.name ?? level.label ?? null,
        elevation: Number.isFinite(rawElevation) ? rawElevation : null
    };
}

function getSceneLevelInfo(scene = getActiveScene()) {
    const info = {
        sceneId: scene?.id ?? null,
        sceneName: scene?.name ?? null,
        currentLevelId: canvas?.level?.id ?? null,
        currentLevelName: canvas?.level?.name ?? null,
        hasAvailableLevels: false,
        availableLevelCount: 0,
        availableLevelIds: [],
        availableLevels: [],
        hasFirstLevel: false,
        firstLevelId: null,
        firstLevel: null
    };

    if (!scene) return info;

    try {
        const availableLevels = scene.availableLevels;
        info.hasAvailableLevels = availableLevels !== undefined && availableLevels !== null;
        info.availableLevelCount = collectionSize(availableLevels);
        info.availableLevels = collectionValues(availableLevels)
            .map(summarizeSceneLevel)
            .filter(Boolean);
        info.availableLevelIds = info.availableLevels
            .map(level => level.id)
            .filter(id => id !== null && id !== undefined);

        const firstLevel = scene.firstLevel;
        info.hasFirstLevel = firstLevel !== undefined && firstLevel !== null;
        info.firstLevel = summarizeSceneLevel(firstLevel);
        info.firstLevelId = info.firstLevel?.id ?? null;
    } catch (error) {
        info.error = error?.message ?? String(error);
    }

    return jsonSafeClone(info, { maxDepth: 4, maxArrayLength: 25, maxStringLength: 500 });
}

function collectV14RuntimeChecks() {
    const applications = foundry.applications ?? {};
    const api = applications.api ?? {};
    const apps = applications.apps ?? {};
    const ux = applications.ux ?? {};
    const FilePickerClass = apps.FilePicker;
    const FormDataExtendedClass = ux.FormDataExtended;
    const scene = getActiveScene();

    return {
        foundryVersion: game.version ?? null,
        foundryGeneration: getFoundryGeneration(),
        canvasReady: !!canvas?.ready,
        applicationV2: typeof api.ApplicationV2 === "function",
        handlebarsApplicationMixin: typeof api.HandlebarsApplicationMixin === "function",
        dialogV2: typeof api.DialogV2?.confirm === "function",
        filePickerImplementation: typeof FilePickerClass?.implementation === "function",
        formDataExtended: typeof FormDataExtendedClass === "function",
        v14NamespacedApis: {
            filePicker: typeof FilePickerClass === "function",
            filePickerImplementation: typeof FilePickerClass?.implementation === "function",
            formDataExtended: typeof FormDataExtendedClass === "function"
        },
        configureCursors: typeof game.configureCursors === "function",
        registerMouseMoveHandler: typeof canvas?.registerMouseMoveHandler === "function",
        canvasControlsCursors: !!canvas?.controls?.cursors,
        sceneLevelInfo: getSceneLevelInfo(scene)
    };
}

function validateV14RuntimeForDiagnostics() {
    const runtimeChecks = collectV14RuntimeChecks();
    return {
        createsDocuments: false,
        runtimeChecks,
        sceneLevelInfo: runtimeChecks.sceneLevelInfo,
        validation: validateV14RuntimeSnapshot(runtimeChecks)
    };
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

function getClientDiagnosticsSnapshot({ getDebugState } = {}) {
    const settingsSnapshot = collectSettingsSnapshot();
    const scene = getActiveScene();
    return jsonSafeClone({
        user: {
            id: game.user?.id ?? null,
            name: game.user?.name ?? null,
            isGM: !!game.user?.isGM,
            active: !!game.user?.active,
            showCursorPermission: getShowCursorPermissionState(game.user)
        },
        scene: scene
            ? {
                id: scene.id ?? null,
                name: scene.name ?? null,
                active: !!scene.active
            }
            : null,
        runtime: {
            foundryVersion: game.version ?? null,
            canvasReady: !!canvas?.ready,
            worldId: game.world?.id ?? null,
            systemId: game.system?.id ?? null
        },
        settings: getCursorControlSettings(settingsSnapshot),
        marqueeLevelFilter: getMarqueeLevelFilterStatus(),
        moduleState: jsonSafeClone(getDebugState?.() ?? null, { maxDepth: 4 })
    }, {
        maxDepth: 5,
        maxStringLength: 1000,
        maxArrayLength: 50
    });
}

function installDiagnosticsSocketResponder({ getDebugState } = {}) {
    if (diagnosticsSocketResponderInstalled || !game.socket?.on || !game.socket?.emit) return;
    diagnosticsSocketResponderInstalled = true;

    game.socket.on(SOCKET_EVENT, data => {
        if (data?.type !== CLIENT_DIAGNOSTICS_REQUEST) return;
        if (!data.requestId || data.requesterId === game.user?.id) return;

        const requester = game.users?.get?.(data.requesterId);
        const gate = getDiagnosticsGate();
        if (!requester?.isGM || !gate.debugLogging || !gate.enableMcpDiagnostics) return;

        game.socket.emit(SOCKET_EVENT, {
            type: CLIENT_DIAGNOSTICS_RESPONSE,
            requestId: data.requestId,
            responderId: game.user?.id ?? null,
            snapshot: getClientDiagnosticsSnapshot({ getDebugState })
        });
    });
}

async function collectClientDiagnosticsForDiagnostics(args = {}, { getDebugState } = {}) {
    const timeoutMs = getClientDiagnosticsTimeoutMs(args);
    const includeSelf = args.includeSelf !== false;
    const requestId = `diag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const responses = new Map();

    if (includeSelf) {
        responses.set(game.user?.id ?? "self", getClientDiagnosticsSnapshot({ getDebugState }));
    }

    if (!game.socket?.on || !game.socket?.off || !game.socket?.emit) {
        return {
            socketChannel: SOCKET_EVENT,
            requestId,
            timeoutMs,
            clients: [...responses.values()],
            skipped: true,
            reason: "game.socket is unavailable."
        };
    }

    await new Promise(resolve => {
        const onResponse = data => {
            if (data?.type !== CLIENT_DIAGNOSTICS_RESPONSE) return;
            if (data.requestId !== requestId) return;
            responses.set(data.responderId ?? `unknown-${responses.size}`, data.snapshot ?? {});
        };

        const timer = setTimeout(() => {
            game.socket.off(SOCKET_EVENT, onResponse);
            resolve();
        }, timeoutMs);

        game.socket.on(SOCKET_EVENT, onResponse);
        game.socket.emit(SOCKET_EVENT, {
            type: CLIENT_DIAGNOSTICS_REQUEST,
            requestId,
            requesterId: game.user?.id ?? null
        });

        if (timeoutMs === 0) {
            clearTimeout(timer);
            game.socket.off(SOCKET_EVENT, onResponse);
            resolve();
        }
    });

    return {
        socketChannel: SOCKET_EVENT,
        requestId,
        timeoutMs,
        clients: [...responses.values()],
        clientCount: responses.size
    };
}

function buildStatusPayload({ getDebugState } = {}) {
    const settingsSnapshot = collectSettingsSnapshot();
    const profileStatus = collectProfileStatus(settingsSnapshot);
    const availability = getDiagnosticsGate();
    const mutationAvailability = getMutationAvailability({});
    const actionMetadata = createDiagnosticActionManifest();
    const debugState = getDebugState?.() ?? null;

    return {
        module: summarizeModule(MODULE_ID),
        diagnostics: {
            version: DIAGNOSTICS_API_VERSION,
            available: availability.available,
            gates: availability.gates,
            availableActions: [...DIAGNOSTIC_ACTION_NAMES],
            readOnlyActions: [...READ_ONLY_DIAGNOSTIC_ACTION_NAMES],
            mutatingActions: [...MUTATING_DIAGNOSTIC_ACTION_NAMES],
            actionMetadata,
            bridge: "call-module-debug-action",
            fixturePrefix: FIXTURE_PREFIX,
            fixtureFlag: FIXTURE_FLAG,
            mutation: {
                confirmMutationRequired: true,
                setting: "enableMcpDiagnostics",
                gates: mutationAvailability.gates
            },
            refresh: {
                moduleAction: "refreshClient",
                bridgeTool: "reload-foundry-client",
                gatedByDiagnostics: true
            },
            allowlisted: true,
            arbitraryEval: false,
            arbitraryPropertyWalking: false,
            createsDocumentsByDefault: false
        },
        runtime: summarizeRuntime(),
        settingsSnapshot,
        settings: {
            currentControls: getCursorControlSettings(settingsSnapshot),
            legacyProfileStorage: profileStatus.legacySettings
        },
        worldData: getWorldDataCounts(),
        fixtures: getFixtureStatus(),
        publicApiKeys: Object.keys(game.modules.get(MODULE_ID)?.api ?? {}).sort(),
        profileSnapshot: profileStatus.profileSnapshot,
        legacySettings: profileStatus.legacySettings,
        warnings: profileStatus.statusWarnings,
        integrations: {
            socketNamespace: SOCKET_EVENT,
            foundryMcpBridge: summarizeModule("foundry-mcp-bridge"),
            cursorSharingMode: tryGetSetting("cursor-sharing-mode"),
            cursorBroadcastEnabled: isCursorBroadcastEnabled(),
            cursorPrivateMode: isCursorPrivateMode(),
            showCursorPermission: getShowCursorPermissionState(game.user),
            cursorSharingPermissionBlocked: debugState?.cursorSharing?.permissionBlocked ?? null
        },
        hardening: {
            cursorPrivacyBroadcast: getCursorPrivacyBroadcastDebugState(),
            marqueeLevelFilter: getMarqueeLevelFilterStatus({ filter: getMarqueeLevelFilter() }),
            cursorSharingSocketListenerActive: debugState?.cursorSharing?.socketListenerActive ?? null,
            nativeUserActivityListenerActive: debugState?.cursorSharing?.nativeUserActivityListenerActive ?? null,
            cursorOverlayParentAvailable: debugState?.cursorOverlay?.parentAvailable ?? null
        },
        debugState: jsonSafeClone(debugState, { maxDepth: 5 })
    };
}

export function createDiagnostics({
    getDebugState,
    openAdvancedSettings,
    openCursorConfig
} = {}) {
    installDiagnosticsSocketResponder({ getDebugState });

    const actions = {
        getStatus(args = {}) {
            return runGatedAction("getStatus", args, () => buildStatusPayload({ getDebugState }));
        },

        validateSettings(args = {}) {
            return runGatedAction("validateSettings", args, () => {
                const settingsSnapshot = collectSettingsSnapshot();
                return {
                    settingsSnapshot,
                    validation: validateSettingsSnapshot(settingsSnapshot),
                    createsDocuments: false
                };
            });
        },

        validateAssets(args = {}) {
            return runGatedActionAsync("validateAssets", args, () => validateCursorAssetsForDiagnostics(args));
        },

        validateV14Runtime(args = {}) {
            return runGatedAction("validateV14Runtime", args, () => validateV14RuntimeForDiagnostics());
        },

        collectClientDiagnostics(args = {}) {
            return runGatedActionAsync("collectClientDiagnostics", args, () => (
                collectClientDiagnosticsForDiagnostics(args, { getDebugState })
            ));
        },

        runSmokeTests(args = {}) {
            return runGatedActionAsync("runSmokeTests", args, async () => {
                // These are runtime self-checks. They use the shared core helpers
                // directly and never import or read files from the tests folder.
                const beforeCounts = getWorldDataCounts();
                const settingsSnapshot = collectSettingsSnapshot();
                const settingsValidation = validateSettingsSnapshot(settingsSnapshot);
                const currentConfig = getUserCursorConfig(game.user);
                const cursorValidation = validateCursorConfig(currentConfig);
                const assetValidation = await validateCursorAssetsForDiagnostics(args);
                const v14RuntimeValidation = validateV14RuntimeForDiagnostics();
                const actionNames = Object.keys(actions).sort();
                const expectedActions = [...DIAGNOSTIC_ACTION_NAMES].sort();
                const debugState = getDebugState?.() ?? null;
                const cursorSharing = debugState?.cursorSharing ?? null;
                const metadata = createDiagnosticActionManifest();

                const checks = [
                    makeSmokeCheck(
                        "diagnostics action allowlist",
                        JSON.stringify(actionNames) === JSON.stringify(expectedActions),
                        { actionNames, expectedActions }
                    ),
                    makeSmokeCheck(
                        "read-only diagnostics actions do not create documents",
                        READ_ONLY_DIAGNOSTIC_ACTION_NAMES.every(name => metadata[name]?.createsDocuments === false),
                        { readOnlyActions: READ_ONLY_DIAGNOSTIC_ACTION_NAMES }
                    ),
                    makeSmokeCheck(
                        "mutating diagnostics actions are marked as creating fixtures",
                        MUTATING_DIAGNOSTIC_ACTION_NAMES.every(name => metadata[name]?.createsDocuments === true),
                        { mutatingActions: MUTATING_DIAGNOSTIC_ACTION_NAMES }
                    ),
                    makeSmokeCheck("settings snapshot validates", settingsValidation),
                    makeSmokeCheck("current cursor profile validates", cursorValidation),
                    makeSmokeCheck(
                        "active cursor assets load",
                        assetValidation.summary.activeFailures === 0,
                        { activeFailures: assetValidation.activeFailures }
                    ),
                    makeSmokeCheck(
                        "V14 runtime contracts validate",
                        v14RuntimeValidation.validation,
                        {
                            runtimeChecks: v14RuntimeValidation.runtimeChecks,
                            sceneLevelInfo: v14RuntimeValidation.sceneLevelInfo
                        }
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
                    ),
                    // Pure marquee/cursor-geometry self-checks: confirm the deployed
                    // build's selection and geometry math matches expected output.
                    ...runCoreSelfChecks()
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

                const afterCounts = getWorldDataCounts();
                checks.push(makeSmokeCheck(
                    "smoke tests do not change world document counts",
                    JSON.stringify(beforeCounts) === JSON.stringify(afterCounts),
                    { beforeCounts, afterCounts }
                ));

                return {
                    smokeTestArgs: jsonSafeClone(args),
                    worldCounts: {
                        before: beforeCounts,
                        after: afterCounts
                    },
                    cursorAssetValidation: {
                        summary: assetValidation.summary,
                        createsDocuments: assetValidation.createsDocuments
                    },
                    report: buildSmokeReport(checks)
                };
            });
        },

        refreshClient(args = {}) {
            return runGatedAction("refreshClient", args, () => {
                const delayMs = getRefreshDelayMs(args);
                window.setTimeout(() => window.location.reload(), delayMs);
                return {
                    initiated: true,
                    delayMs,
                    createsDocuments: false
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

        runAutomation(args = {}) {
            return runGatedMutationActionAsync("runAutomation", args, () => runDiagnosticsAutomation(args));
        },

        cleanupFixtures(args = {}) {
            return runGatedMutationActionAsync("cleanupFixtures", args, () => cleanupAutomationFixtures(args));
        }
    };

    return Object.freeze({
        version: DIAGNOSTICS_API_VERSION,
        socketChannel: SOCKET_EVENT,
        getGate: () => getDiagnosticsGate(),
        getAvailability: () => getDiagnosticsGate(),
        getMutationAvailability,
        actionMetadata: createDiagnosticActionManifest(),
        actions
    });
}
