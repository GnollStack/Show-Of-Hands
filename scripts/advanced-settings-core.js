/**
 * Convert the typed object produced by Foundry's FormDataExtended into the
 * values persisted by Advanced Settings.
 *
 * Checkbox values are deliberately compared with true. Treating FormData
 * strings such as "false" as booleans would turn unchecked controls on.
 */
export function parseAdvancedSettingsForm(formObject = {}, otherUserIds = []) {
    const opacity = Number.parseFloat(formObject.sharedCursorOpacity);
    const normalizedOpacity = Number.isFinite(opacity)
        ? Math.min(1, Math.max(0.1, opacity))
        : 1;
    const tokenFilters = new Set(["all", "hostile", "neutral", "friendly", "nonFriendly"]);
    const levelFilters = new Set(["all", "viewed"]);
    const hiddenUsers = {};

    for (const userId of otherUserIds) {
        // FormDataExtended.object preserves dotted field names. Accept an
        // expanded object too so this helper remains safe for direct callers.
        const value = formObject[`hiddenUsers.${userId}`] ?? formObject.hiddenUsers?.[userId];
        if (value === true) hiddenUsers[userId] = true;
    }

    return {
        sharedCursorOpacity: normalizedOpacity,
        disableCursorFade: formObject.disableCursorFade === true,
        idleIdentityFade: formObject.idleIdentityFade === true,
        marqueeTokenFilter: tokenFilters.has(formObject.marqueeTokenFilter)
            ? formObject.marqueeTokenFilter
            : "all",
        marqueeLevelFilter: levelFilters.has(formObject.marqueeLevelFilter)
            ? formObject.marqueeLevelFilter
            : "all",
        hiddenUsers
    };
}
