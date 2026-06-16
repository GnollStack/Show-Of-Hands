import { getMarqueeLevelFilter } from './settings.js';

export function getCurrentLevelId(canvasRef = globalThis.canvas) {
    const levelId = canvasRef?.level?.id;
    return typeof levelId === "string" && levelId.length ? levelId : null;
}

function getTokenDocument(tokenOrDocument) {
    return tokenOrDocument?.document ?? tokenOrDocument;
}

export function isTokenIncludedInLevel(tokenOrDocument, levelId) {
    if (!levelId) return true;

    const document = getTokenDocument(tokenOrDocument);
    if (!document) return false;

    if (typeof document.includedInLevel === "function") {
        try {
            return document.includedInLevel(levelId) === true;
        } catch {
            // Fall back to the source level comparison below.
        }
    }

    const tokenLevel = document.level ?? document._source?.level;
    return tokenLevel === levelId;
}

export function tokenMatchesMarqueeLevelFilter(token, {
    filter = getMarqueeLevelFilter(),
    canvasRef = globalThis.canvas
} = {}) {
    if (filter !== "viewed") return true;
    const levelId = getCurrentLevelId(canvasRef);
    if (!levelId) return true;
    return isTokenIncludedInLevel(token, levelId);
}

export function getMarqueeLevelFilterStatus({
    filter = getMarqueeLevelFilter(),
    canvasRef = globalThis.canvas
} = {}) {
    const levelId = getCurrentLevelId(canvasRef);
    return {
        filter,
        currentLevelId: levelId,
        available: !!levelId,
        active: filter === "viewed" && !!levelId
    };
}
