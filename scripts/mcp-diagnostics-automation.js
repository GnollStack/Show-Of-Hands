import { MODULE_ID, LEGACY_MODULE_ID } from './constants.js';
import { tokenMatchesMarqueeFilter } from './settings.js';

// Live-world automation for MCP diagnostics only. It never reads the test
// suite; when explicitly confirmed, it creates flagged temporary tokens and
// cleans up only tokens that still carry those module-owned markers.
export const FIXTURE_PREFIX = "SOH-MCP-FIXTURE";
export const LEGACY_FIXTURE_PREFIX = "TTB-MCP-FIXTURE";
export const FIXTURE_FLAG = "mcpAutomationFixture";

const MARQUEE_FILTER_SAMPLES = Object.freeze(["all", "hostile", "neutral", "friendly", "nonFriendly"]);

function collectionSize(collection) {
    if (!collection) return 0;
    if (typeof collection.size === "number") return collection.size;
    if (typeof collection.length === "number") return collection.length;
    return 0;
}

function collectionToArray(collection) {
    if (!collection) return [];
    if (Array.isArray(collection)) return collection;
    if (Array.isArray(collection.contents)) return collection.contents;
    try {
        return [...collection];
    } catch {
        return [];
    }
}

function getActiveScene() {
    return canvas?.scene ?? game.scenes?.active ?? null;
}

function getWorldId() {
    return game.world?.id ?? null;
}

function normalizeRunId(runId) {
    if (runId === undefined || runId === null || runId === "") {
        return `run-${Date.now().toString(36)}`;
    }

    const normalized = String(runId);
    if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
        throw new Error("runId may contain only letters, numbers, underscores, and hyphens.");
    }
    return normalized;
}

function getSceneCounts(scene = getActiveScene()) {
    return {
        worldId: getWorldId(),
        sceneId: scene?.id ?? null,
        tokens: collectionSize(scene?.tokens),
        actors: collectionSize(game.actors),
        scenes: collectionSize(game.scenes),
        items: collectionSize(game.items),
        journals: collectionSize(game.journal)
    };
}

function getDispositions() {
    const dispositions = CONST.TOKEN_DISPOSITIONS ?? {};
    return {
        hostile: dispositions.HOSTILE ?? -1,
        neutral: dispositions.NEUTRAL ?? 0,
        friendly: dispositions.FRIENDLY ?? 1
    };
}

function makeFixtureMarker({ runId, fixtureName, scene }) {
    return {
        runId,
        fixtureName,
        worldId: getWorldId(),
        sceneId: scene?.id ?? null,
        createdAt: new Date().toISOString()
    };
}

function readDocumentFlag(document, scope, key) {
    try {
        if (typeof document?.getFlag === "function") return document.getFlag(scope, key);
    } catch (error) {
        if (scope !== LEGACY_MODULE_ID) throw error;
        // Foundry rejects inactive old package scopes; raw flags may still hold
        // cleanup markers from pre-rename diagnostics runs.
    }
    return document?.flags?.[scope]?.[key];
}

function isFixtureToken(document, { runId } = {}) {
    const name = String(document?.name ?? "");
    if (!name.startsWith(FIXTURE_PREFIX) && !name.startsWith(LEGACY_FIXTURE_PREFIX)) return false;

    // Name plus marker keeps cleanup narrow: old fixtures can be removed after
    // the rename, but unrelated tokens with similar names are left alone.
    const marker = readDocumentFlag(document, MODULE_ID, FIXTURE_FLAG) ?? readDocumentFlag(document, LEGACY_MODULE_ID, FIXTURE_FLAG);
    if (!marker || typeof marker !== "object") return false;
    if (marker.worldId !== getWorldId()) return false;
    if (marker.sceneId !== getActiveScene()?.id) return false;
    if (runId && marker.runId !== runId) return false;
    return true;
}

function findFixtureTokens({ runId } = {}) {
    return collectionToArray(getActiveScene()?.tokens).filter(document => isFixtureToken(document, { runId }));
}

function getTokenDocument(tokenOrDocument) {
    return tokenOrDocument?.document ?? tokenOrDocument;
}

function makeFilterToken(document) {
    return {
        visible: !document.hidden,
        document,
        disposition: document.disposition
    };
}

async function createTokenFixtures(scene, runId) {
    // Use Foundry's built-in mystery-man icon so release zips do not need any
    // bundled test art or generated assets for diagnostics.
    const dispositions = getDispositions();
    const baseX = Math.max(0, Math.round((canvas?.dimensions?.sceneX ?? 100) + 100));
    const baseY = Math.max(0, Math.round((canvas?.dimensions?.sceneY ?? 100) + 100));
    const gridSize = Math.max(50, Number(canvas?.grid?.size ?? scene.grid?.size ?? 100) || 100);

    const specs = [
        { key: "hostile", label: "Hostile", disposition: dispositions.hostile, x: baseX, y: baseY },
        { key: "neutral", label: "Neutral", disposition: dispositions.neutral, x: baseX + gridSize, y: baseY },
        { key: "friendly", label: "Friendly", disposition: dispositions.friendly, x: baseX + (gridSize * 2), y: baseY }
    ];

    const data = specs.map(spec => {
        const fixtureName = `${FIXTURE_PREFIX}-${runId}-${spec.label}`;
        return {
            name: fixtureName,
            x: spec.x,
            y: spec.y,
            width: 1,
            height: 1,
            hidden: false,
            disposition: spec.disposition,
            actorLink: false,
            texture: {
                src: "icons/svg/mystery-man.svg"
            },
            flags: {
                [MODULE_ID]: {
                    [FIXTURE_FLAG]: makeFixtureMarker({ runId, fixtureName, scene })
                }
            }
        };
    });

    const created = await scene.createEmbeddedDocuments("Token", data);
    return created.map(getTokenDocument).map(document => ({
        id: document.id,
        name: document.name,
        disposition: document.disposition,
        marker: document.getFlag?.(MODULE_ID, FIXTURE_FLAG) ?? null
    }));
}

async function exerciseMarqueeFilters(createdTokens) {
    const originalFilter = game.settings.get(MODULE_ID, "marquee-token-filter");
    const tokenDocs = createdTokens
        .map(token => getActiveScene()?.tokens?.get?.(token.id))
        .filter(Boolean);

    const results = [];
    try {
        for (const filter of MARQUEE_FILTER_SAMPLES) {
            await game.settings.set(MODULE_ID, "marquee-token-filter", filter);
            results.push({
                filter,
                matched: tokenDocs
                    .filter(document => tokenMatchesMarqueeFilter(makeFilterToken(document)))
                    .map(document => document.name)
            });
        }
    } finally {
        await game.settings.set(MODULE_ID, "marquee-token-filter", originalFilter);
    }

    return {
        restoredSetting: "marquee-token-filter",
        originalFilter,
        results
    };
}

export async function cleanupFixtures({ runId } = {}) {
    const scene = getActiveScene();
    if (!scene) throw new Error("MCP Diagnostics Automation requires an active scene.");

    const before = getSceneCounts(scene);
    const fixtures = findFixtureTokens({ runId });
    const tokenIds = fixtures.map(document => document.id).filter(Boolean);

    if (tokenIds.length) {
        await scene.deleteEmbeddedDocuments("Token", tokenIds);
    }

    const remainingFixtures = findFixtureTokens({ runId });
    return {
        success: true,
        runId: runId ?? null,
        fixturePrefix: FIXTURE_PREFIX,
        fixtureFlag: FIXTURE_FLAG,
        before,
        after: getSceneCounts(scene),
        deletedCount: tokenIds.length,
        deletedIds: tokenIds,
        remainingFixtures: remainingFixtures.length
    };
}

export async function runAutomation({
    cleanupBefore = true,
    cleanupAfter = true,
    runId
} = {}) {
    const scene = getActiveScene();
    if (!scene) throw new Error("MCP Diagnostics Automation requires an active scene.");

    const normalizedRunId = normalizeRunId(runId);
    const cleanupBeforeRunId = runId ? normalizedRunId : null;
    const before = getSceneCounts(scene);
    const steps = [];

    if (cleanupBefore !== false) {
        steps.push({
            step: "cleanupBefore",
            result: await cleanupFixtures({ runId: cleanupBeforeRunId })
        });
    }

    const createdTokens = await createTokenFixtures(scene, normalizedRunId);
    steps.push({
        step: "createFixtures",
        createdCount: createdTokens.length,
        createdTokens
    });

    steps.push({
        step: "exerciseMarqueeFilters",
        result: await exerciseMarqueeFilters(createdTokens)
    });

    let cleanupResult = null;
    if (cleanupAfter !== false) {
        cleanupResult = await cleanupFixtures({ runId: normalizedRunId });
        steps.push({
            step: "cleanupAfter",
            result: cleanupResult
        });
    }

    const remainingFixtures = findFixtureTokens({ runId: normalizedRunId }).length;
    return {
        success: true,
        runId: normalizedRunId,
        fixturePrefix: FIXTURE_PREFIX,
        fixtureFlag: FIXTURE_FLAG,
        before,
        after: getSceneCounts(scene),
        cleanupBefore: cleanupBefore !== false,
        cleanupAfter: cleanupAfter !== false,
        cleanupResult,
        remainingFixtures,
        steps
    };
}

export function getFixtureStatus({ runId } = {}) {
    const scene = getActiveScene();
    const fixtures = scene ? findFixtureTokens({ runId }) : [];
    return {
        fixturePrefix: FIXTURE_PREFIX,
        fixtureFlag: FIXTURE_FLAG,
        worldId: getWorldId(),
        sceneId: scene?.id ?? null,
        activeSceneOnly: true,
        count: fixtures.length,
        fixtures: fixtures.map(document => ({
            id: document.id,
            name: document.name,
            marker: typeof document.getFlag === "function" ? document.getFlag(MODULE_ID, FIXTURE_FLAG) : null
        }))
    };
}
