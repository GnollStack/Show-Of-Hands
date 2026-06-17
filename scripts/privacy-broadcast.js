/**
 * @file privacy-broadcast.js
 * @description Filters the local user's native Foundry cursor activity while
 * Show of Hands private cursor mode is active.
 */

import { MODULE_ID } from './constants.js';

export const PRIVATE_BROADCAST_WRAPPER_TARGET = "foundry.documents.User.prototype.broadcastActivity";

const BYPASS_PRIVACY_FILTER = Symbol("show-of-hands-bypass-privacy-filter");

let _state = {
    installed: false,
    mode: "none",
    target: PRIVATE_BROADCAST_WRAPPER_TARGET,
    originalMethodPresent: false,
    libWrapperAvailable: false,
    fallbackReason: null,
    privateModeActive: false
};

let _isPrivateMode = () => false;
let _emitHiddenPing = () => {};
let _originalBroadcastActivity = null;

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value ?? {}, key);
}

function withoutBypassOption(options = {}) {
    if (!options || typeof options !== "object") return options;
    const cleaned = { ...options };
    Reflect.deleteProperty(cleaned, BYPASS_PRIVACY_FILTER);
    return cleaned;
}

function callOriginal(original, user, activityData, options) {
    if (typeof original !== "function") return undefined;
    return original.call(user, activityData, options);
}

export function filterPrivateBroadcastActivity(activityData = {}, { privateMode = false } = {}) {
    // Only native activity that includes cursor coordinates can reveal private
    // mode position. Other activity is forwarded untouched.
    if (!privateMode || !activityData || typeof activityData !== "object") {
        return {
            action: "forward",
            activityData,
            hiddenPing: null,
            removedCursor: false,
            removedPing: false
        };
    }

    const hasCursor = hasOwn(activityData, "cursor");
    if (!hasCursor) {
        return {
            action: "forward",
            activityData,
            hiddenPing: null,
            removedCursor: false,
            removedPing: false
        };
    }

    const hasPing = hasOwn(activityData, "ping");
    const filtered = { ...activityData };
    delete filtered.cursor;

    let hiddenPing = null;
    if (hasPing) {
        // Preserve Foundry's ping payload, but send it through the module socket
        // so the cursor coordinate is not broadcast as native user activity.
        hiddenPing = {
            position: activityData.cursor,
            ping: activityData.ping
        };
        delete filtered.ping;
    }

    return {
        action: Object.keys(filtered).length ? "forward" : "drop",
        activityData: Object.keys(filtered).length ? filtered : null,
        hiddenPing,
        removedCursor: true,
        removedPing: hasPing
    };
}

function handleBroadcastActivity(user, original, activityData = {}, options = {}) {
    // The module sometimes needs to emit non-private native activity itself
    // (for example, clearing cursor state). The symbol avoids re-filtering that.
    if (options?.[BYPASS_PRIVACY_FILTER]) {
        return callOriginal(original, user, activityData, withoutBypassOption(options));
    }

    const privateMode = !!(user?.isSelf && _isPrivateMode());
    _state.privateModeActive = privateMode;

    const result = filterPrivateBroadcastActivity(activityData, { privateMode });
    if (result.hiddenPing) _emitHiddenPing(result.hiddenPing.position, result.hiddenPing.ping);
    if (result.action === "drop") return undefined;
    return callOriginal(original, user, result.activityData, options);
}

function installDirectPatch(proto, fallbackReason) {
    // Worlds without libWrapper still need privacy mode, so keep a small direct
    // patch that preserves the original method and reports the fallback reason.
    proto.broadcastActivity = function(activityData = {}, options = {}) {
        return handleBroadcastActivity(this, _originalBroadcastActivity, activityData, options);
    };

    _state = {
        ..._state,
        installed: true,
        mode: "direct",
        fallbackReason
    };
}

export function installCursorPrivacyBroadcastWrapper({
    isPrivateMode,
    emitHiddenPing
} = {}) {
    const proto = globalThis.game?.user?.constructor?.prototype;
    const libWrapper = globalThis.libWrapper;

    _isPrivateMode = typeof isPrivateMode === "function" ? isPrivateMode : _isPrivateMode;
    _emitHiddenPing = typeof emitHiddenPing === "function" ? emitHiddenPing : _emitHiddenPing;

    _state = {
        ..._state,
        libWrapperAvailable: typeof libWrapper?.register === "function",
        originalMethodPresent: typeof proto?.broadcastActivity === "function"
    };

    if (_state.installed) return getCursorPrivacyBroadcastDebugState();

    if (!proto || typeof proto.broadcastActivity !== "function") {
        _state = {
            ..._state,
            installed: false,
            mode: "unavailable",
            fallbackReason: "User.prototype.broadcastActivity is unavailable."
        };
        return getCursorPrivacyBroadcastDebugState();
    }

    _originalBroadcastActivity = proto.broadcastActivity;

    if (typeof libWrapper?.register === "function") {
        try {
            libWrapper.register(
                MODULE_ID,
                "foundry.documents.User.prototype.broadcastActivity",
                function(wrapped, activityData = {}, options = {}) {
                    return handleBroadcastActivity(this, wrapped, activityData, options);
                },
                "WRAPPER"
            );

            _state = {
                ..._state,
                installed: true,
                mode: "libWrapper",
                fallbackReason: null
            };
            return getCursorPrivacyBroadcastDebugState();
        } catch (error) {
            installDirectPatch(proto, error?.message ?? String(error));
            return getCursorPrivacyBroadcastDebugState();
        }
    }

    installDirectPatch(proto, "libWrapper is unavailable.");
    return getCursorPrivacyBroadcastDebugState();
}

export function broadcastNativeActivity(activityData = {}, options = {}) {
    const user = globalThis.game?.user;
    if (!user || typeof user.broadcastActivity !== "function") return undefined;
    return user.broadcastActivity(activityData, {
        ...options,
        [BYPASS_PRIVACY_FILTER]: true
    });
}

export function getCursorPrivacyBroadcastDebugState() {
    return {
        ..._state,
        libWrapperAvailable: typeof globalThis.libWrapper?.register === "function",
        privateModeActive: !!_isPrivateMode?.()
    };
}
