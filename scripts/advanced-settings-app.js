/**
 * @file advanced-settings-app.js
 * @description ApplicationV2 sheet for Show of Hands advanced cursor,
 * marquee, visibility, and diagnostics settings.
 */

import { MODULE_ID, MODULE_TITLE } from './constants.js';
import { getHiddenSharedCursorUserIds, MARQUEE_LEVEL_FILTERS, MARQUEE_TOKEN_FILTERS } from './settings.js';
import { parseAdvancedSettingsForm } from './advanced-settings-core.js';

function choiceEntries(choices, selected) {
    return Object.entries(choices).map(([value, label]) => ({
        value,
        label,
        selected: value === selected
    }));
}

function getDiagnosticsText() {
    try {
        const api = game.modules.get(MODULE_ID)?.api;
        const state = api?.diagnostics?.actions?.getStatus?.() ?? api?.getDebugState?.() ?? {};
        return JSON.stringify(state, null, 2);
    } catch (e) {
        return JSON.stringify({ error: e.message }, null, 2);
    }
}

export class AdvancedSettingsApp extends foundry.applications.api.HandlebarsApplicationMixin(
    foundry.applications.api.ApplicationV2
) {
    static DEFAULT_OPTIONS = {
        id: "ttb-advanced-settings",
        tag: "form",
        form: {
            handler: AdvancedSettingsApp.#onSubmit,
            closeOnSubmit: true
        },
        actions: {
            copyDiagnostics: AdvancedSettingsApp.#onCopyDiagnostics,
            refreshDiagnostics: AdvancedSettingsApp.#onRefreshDiagnostics
        },
        window: {
            title: `${MODULE_TITLE} Advanced Settings`,
            icon: "fas fa-sliders",
            resizable: true
        },
        position: {
            width: 640,
            height: 720
        },
        classes: ["show-of-hands", "ttb-advanced-settings"]
    };

    static PARTS = {
        form: {
            template: `modules/${MODULE_ID}/templates/advanced-settings.html`
        }
    };

    async _prepareContext(options) {
        const hiddenUsers = getHiddenSharedCursorUserIds();
        const users = game.users
            .filter(user => user.id !== game.user.id)
            .map(user => ({
                id: user.id,
                name: user.name,
                active: user.active,
                hidden: hiddenUsers.has(user.id)
            }));

        return {
            sharedCursorOpacity: game.settings.get(MODULE_ID, "shared-cursor-opacity"),
            disableCursorFade: game.settings.get(MODULE_ID, "disable-cursor-fade"),
            idleIdentityFade: game.settings.get(MODULE_ID, "idle-identity-fade"),
            marqueeTokenFilter: game.settings.get(MODULE_ID, "marquee-token-filter"),
            marqueeTokenFilters: choiceEntries(MARQUEE_TOKEN_FILTERS, game.settings.get(MODULE_ID, "marquee-token-filter")),
            marqueeLevelFilter: game.settings.get(MODULE_ID, "marquee-level-filter"),
            marqueeLevelFilters: choiceEntries(MARQUEE_LEVEL_FILTERS, game.settings.get(MODULE_ID, "marquee-level-filter")),
            users,
            hasUsers: users.length > 0,
            diagnostics: getDiagnosticsText()
        };
    }

    static async #onCopyDiagnostics(event) {
        event.preventDefault();
        const diagnostics = this.element.querySelector('.ttb-diagnostics-output')?.value ?? getDiagnosticsText();
        try {
            await navigator.clipboard.writeText(diagnostics);
            ui.notifications.info("Diagnostics copied.");
        } catch {
            ui.notifications.warn("Could not copy diagnostics from this browser context.");
        }
    }

    static #onRefreshDiagnostics(event) {
        event.preventDefault();
        const output = this.element.querySelector('.ttb-diagnostics-output');
        if (output) output.value = getDiagnosticsText();
    }

    static async #onSubmit(event, form, formData) {
        const formObject = formData?.object ?? new foundry.applications.ux.FormDataExtended(form).object;
        const otherUserIds = game.users
            .filter(user => user.id !== game.user.id)
            .map(user => user.id);
        const values = parseAdvancedSettingsForm(formObject, otherUserIds);

        await game.settings.set(MODULE_ID, "shared-cursor-opacity", values.sharedCursorOpacity);
        await game.settings.set(MODULE_ID, "disable-cursor-fade", values.disableCursorFade);
        await game.settings.set(MODULE_ID, "idle-identity-fade", values.idleIdentityFade);
        await game.settings.set(MODULE_ID, "marquee-token-filter", values.marqueeTokenFilter);
        await game.settings.set(MODULE_ID, "marquee-level-filter", values.marqueeLevelFilter);
        await game.settings.set(MODULE_ID, "hidden-shared-cursor-users", values.hiddenUsers);

        ui.notifications.info(`${MODULE_TITLE} advanced settings saved.`);
    }
}
