import { MODULE_ID, SOCKET_EVENT, STYLE_ID } from './constants.js';
import { applyCursorStyles } from './cursor-styles.js';
import { getCursorSharingMode } from './settings.js';
import { getCursorSharingDebugState } from './cursor-sharing.js';
import { LatestValueRateLimiter } from './latest-value-rate-limiter.js';

// A fixed live test, reachable only through confirmed runAutomation. No remote
// code, property paths, profile edits, or new socket messages are accepted.
let running = false;
const MODE_KEY = "cursor-sharing-mode";
const CURSOR_VARIABLES = [
    "--cursor-default", "--cursor-default-down", "--cursor-pointer",
    "--cursor-pointer-down", "--cursor-grab", "--cursor-grab-down",
    "--cursor-text", "--cursor-text-down"
];

function cursorDocuments() {
    const documents = new Set([document]);
    for (const descriptor of globalThis.foundry?.applications?.detached?.windows?.values?.() ?? []) {
        const win = descriptor?.window ?? descriptor;
        if (!win?.closed && win?.document) documents.add(win.document);
    }
    return [...documents];
}

function cursorValues(doc) {
    return CURSOR_VARIABLES.map(key => doc.documentElement.style.getPropertyValue(key));
}

async function waitForSharingIdle(readSharing, assertScene) {
    const deadline = Date.now() + 12_000;
    while (true) {
        assertScene();
        const state = readSharing();
        if (!state.broadcastInFlight && !state.broadcastQueued) return state;
        if (Date.now() >= deadline) throw new Error("Cursor image broadcasting did not settle within 12 seconds.");
        await new Promise(resolve => setTimeout(resolve, 25));
    }
}

async function exerciseBrowserTimers(check) {
    const delivered = [];
    let deliveredLatest;
    let deadline;
    // Freeze only the limiter's clock so the second synchronous push always
    // queues. Scheduling and cancellation use the actual browser timer APIs.
    const limiter = new LatestValueRateLimiter({
        intervalMs: 25, now: () => 0,
        deliver: value => {
            delivered.push(value);
            if (value === 'latest') deliveredLatest();
        }
    });
    try {
        await new Promise((resolve, reject) => {
            deliveredLatest = resolve;
            deadline = globalThis.setTimeout(() => reject(new Error('Browser timer delivery timed out.')), 2000);
            limiter.push('probe', 'first');
            limiter.push('probe', 'older');
            limiter.push('probe', 'latest');
        });
        check('Browser timers deliver the latest queued value', delivered.join(',') === 'first,latest');
        limiter.push('probe', 'cancelled');
        limiter.cancel('probe');
        limiter.push('probe', 'cleared');
        limiter.clear();
        await new Promise(resolve => globalThis.setTimeout(resolve, 50));
        check('Browser timers cancel pending delivery and clear cleanly',
            delivered.join(',') === 'first,latest' && limiter.pending.size === 0 && limiter.lastDelivered.size === 0);
    } finally {
        globalThis.clearTimeout(deadline);
        limiter.clear();
    }
}

export async function runCursorAutomation({
    collectClients,
    applyStyles = applyCursorStyles,
    readSharing = getCursorSharingDebugState
} = {}) {
    if (running) throw new Error("Cursor automation is already running.");
    const sceneId = globalThis.canvas?.scene?.id;
    if (!sceneId || !canvas.ready) throw new Error("Cursor automation requires a ready canvas.");
    if (typeof collectClients !== "function") throw new Error("Client diagnostics collector is unavailable.");
    const socket = game.socket;
    if (typeof socket?.emit !== "function") throw new Error("Cursor automation requires a live socket.");
    const storage = game.settings.storage.get("client");
    const storageKey = `${MODULE_ID}.${MODE_KEY}`;
    const originalRawMode = storage.getItem(storageKey);
    const originalMode = getCursorSharingMode();
    const userId = game.user.id;
    const originalEmit = socket.emit;
    const checks = [];
    const clients = [];
    const observed = { nativeCoordinates: 0, moduleImages: 0, moduleMoves: 0, hidden: 0 };
    const check = (name, passed, details = {}) => checks.push({ name, status: passed ? "pass" : "fail", ...details });
    const assertScene = () => {
        if (!canvas.ready || canvas.scene?.id !== sceneId || game.user.id !== userId) {
            throw new Error("Canvas or user changed during cursor automation; stopped and restored preferences.");
        }
    };
    function observeEmit(event, ...args) {
        if (event === "userActivity" && args[0] === userId && args[1]?.cursor != null) {
            observed.nativeCoordinates += 1;
        } else if (event === SOCKET_EVENT && args[0]?.userId === userId) {
            if (args[0].type === "cursorImage") observed.moduleImages += 1;
            if (args[0].type === "cursorMove") observed.moduleMoves += 1;
            if (args[0].type === "cursorHidden") observed.hidden += 1;
        }
        return originalEmit.call(this, event, ...args);
    }

    let primaryError;
    running = true;
    try {
        await exerciseBrowserTimers(check);
        socket.emit = observeEmit;
        await applyStyles();
        assertScene();
        const documents = cursorDocuments();
        const before = documents.map(cursorValues);
        for (let repeat = 0; repeat < 3; repeat += 1) {
            game.configureCursors();
            check(`Cursor variables survive native configuration ${repeat + 1}`,
                documents.every((doc, index) => JSON.stringify(cursorValues(doc)) === JSON.stringify(before[index])),
                { documents: documents.length });
        }
        if (documents.length === 1) {
            checks.push({ name: "Detached cursor documents", status: "skip", reason: "No detached window is open." });
        }
        await applyStyles(false);
        const nativeValues = documents.map(cursorValues);
        game.configureCursors();
        check("Disabled customization keeps native cursor variables",
            documents.every((doc, index) => !doc.getElementById(STYLE_ID)
                && JSON.stringify(cursorValues(doc)) === JSON.stringify(nativeValues[index])));
        await applyStyles();

        // A real native activity call exercises the installed privacy wrapper.
        // Use the existing canvas position and retain only packet counts.
        for (const mode of ["share", "receive", "private", "share"]) {
            assertScene();
            const start = { ...observed };
            await game.settings.set(MODULE_ID, MODE_KEY, mode);
            const state = await waitForSharingIdle(readSharing, assertScene);
            check(`${mode}: receiving and socket listeners remain active`,
                state.active && state.socketListenerActive && state.nativeUserActivityListenerActive
                && state.registeredMouseHandler);
            check(`${mode}: broadcast state matches preference`, state.broadcastEnabled === (mode === "share"));
            if (mode !== "share") {
                check(`${mode}: hidden broadcast clears module cursor`, observed.hidden > start.hidden);
                check(`${mode}: no late image or movement broadcast`,
                    observed.moduleImages === start.moduleImages && observed.moduleMoves === start.moduleMoves);
            }
            const position = canvas.mousePosition;
            if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) {
                throw new Error("Canvas mouse position is unavailable for the native privacy probe.");
            }
            const nativeBefore = observed.nativeCoordinates;
            // More than one call catches wrappers which libWrapper removes
            // after the first deliberately suppressed activity.
            for (let repeat = 0; repeat < 3; repeat += 1) {
                game.user.broadcastActivity({ cursor: { x: position.x, y: position.y } }, { volatile: false });
            }
            check(`${mode}: native cursor privacy`,
                observed.nativeCoordinates - nativeBefore === (mode === "private" ? 0 : 3));
            const report = await collectClients({ includeSelf: true, timeoutMs: 1000 });
            assertScene();
            for (const client of report.clients ?? []) {
                clients.push({
                    mode, userId: client.user?.id, isGM: client.user?.isGM,
                    sceneId: client.scene?.id, sharingMode: client.settings?.cursorSharingMode,
                    overlayCount: client.moduleState?.cursorOverlay?.cursorCount,
                    pendingImages: client.moduleState?.cursorOverlay?.pendingImageCount,
                    pendingPositions: client.moduleState?.cursorOverlay?.pendingPositionCount
                });
            }
            const peers = (report.clients ?? []).filter(client => client.user?.id !== userId);
            if (!peers.length) {
                checks.push({ name: `${mode}: peer diagnostics`, status: "skip", reason: "No peer diagnostics response." });
            } else {
                check(`${mode}: peer diagnostics returned`, true, { peerCount: peers.length });
                // Cursor counts identify this GM only in a two-user session.
                const activeUsers = [...game.users].filter(user => user.active);
                for (const peer of peers) {
                    if (activeUsers.length !== 2 || peer.scene?.id !== sceneId) continue;
                    if (mode !== "share") {
                        check(`${mode}: peer removed local module cursor`, peer.moduleState?.cursorOverlay?.cursorCount === 0);
                    }
                }
            }
        }
    } catch (error) {
        primaryError = error;
        throw error;
    } finally {
        const restoreErrors = [];
        try {
            await game.settings.set(MODULE_ID, MODE_KEY, originalMode);
            if (originalRawMode == null) storage.removeItem(storageKey);
            else storage.setItem(storageKey, originalRawMode);
        } catch (error) { restoreErrors.push(error); }
        try { await applyStyles(); } catch (error) { restoreErrors.push(error); }
        if (socket.emit === observeEmit) socket.emit = originalEmit;
        running = false;
        if (restoreErrors.length) {
            throw new AggregateError([...(primaryError ? [primaryError] : []), ...restoreErrors],
                `Cursor automation restoration failed: ${restoreErrors.map(error => error.message).join("; ")}`);
        }
    }
    check("Original sharing preference restored", getCursorSharingMode() === originalMode
        && storage.getItem(storageKey) === originalRawMode);
    return {
        success: !checks.some(entry => entry.status === "fail"), suite: "cursor", sceneId,
        originalMode, restoredMode: getCursorSharingMode(),
        passed: checks.filter(entry => entry.status === "pass").length,
        failed: checks.filter(entry => entry.status === "fail").length,
        skipped: checks.filter(entry => entry.status === "skip").length,
        checks, clients
    };
}
