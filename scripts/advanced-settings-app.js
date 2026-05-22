import { MODULE_ID } from './constants.js';
import { getHiddenSharedCursorUserIds, MARQUEE_TOKEN_FILTERS } from './settings.js';

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
        window: {
            title: "Target The Beastie Advanced Settings",
            icon: "fas fa-sliders",
            resizable: true
        },
        position: {
            width: 640,
            height: 720
        },
        classes: ["target-the-beastie", "ttb-advanced-settings"]
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
            users,
            hasUsers: users.length > 0,
            diagnostics: getDiagnosticsText()
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const copyButton = this.element.querySelector('.ttb-copy-diagnostics');
        if (copyButton) {
            copyButton.addEventListener('click', async (event) => {
                event.preventDefault();
                const diagnostics = this.element.querySelector('.ttb-diagnostics-output')?.value ?? getDiagnosticsText();
                try {
                    await navigator.clipboard.writeText(diagnostics);
                    ui.notifications.info("Diagnostics copied.");
                } catch {
                    ui.notifications.warn("Could not copy diagnostics from this browser context.");
                }
            });
        }

        const refreshButton = this.element.querySelector('.ttb-refresh-diagnostics');
        if (refreshButton) {
            refreshButton.addEventListener('click', (event) => {
                event.preventDefault();
                const output = this.element.querySelector('.ttb-diagnostics-output');
                if (output) output.value = getDiagnosticsText();
            });
        }
    }

    static async #onSubmit(event, form, formData) {
        const data = new FormData(form);
        const opacity = Number.parseFloat(data.get("sharedCursorOpacity"));
        const hiddenUsers = {};

        for (const user of game.users) {
            if (user.id === game.user.id) continue;
            if (data.get(`hiddenUsers.${user.id}`)) hiddenUsers[user.id] = true;
        }

        await game.settings.set(MODULE_ID, "shared-cursor-opacity", Number.isFinite(opacity) ? opacity : 1);
        await game.settings.set(MODULE_ID, "disable-cursor-fade", !!data.get("disableCursorFade"));
        await game.settings.set(MODULE_ID, "idle-identity-fade", !!data.get("idleIdentityFade"));
        await game.settings.set(MODULE_ID, "marquee-token-filter", data.get("marqueeTokenFilter") || "all");
        await game.settings.set(MODULE_ID, "hidden-shared-cursor-users", hiddenUsers);

        ui.notifications.info("Advanced Target The Beastie settings saved.");
    }
}
