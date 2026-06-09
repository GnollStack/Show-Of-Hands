import { MODULE_ID, DEFAULT_CURSOR_PATH, DEFAULT_HOTSPOT, CURSOR_STATE_KEYS, CURSOR_STATE_DETAILS, NAME_POSITION_PRESETS, debugLog } from './constants.js';
import { getDefaultCursorStates, getDefaultUserCursorConfig, getUserCursorConfig, setUserCursorConfig } from './settings.js';
import { applyCursorStyles } from './cursor-styles.js';
import { refreshSharedCursorImage } from './cursor-sharing.js';

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, match => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[match]));
}

async function confirmCursorProfileAction({ title, content, fallback }) {
    const DialogV2 = foundry.applications.api?.DialogV2;
    if (DialogV2?.confirm) {
        try {
            return !!(await DialogV2.confirm({
                window: { title },
                content,
                yes: { label: "Confirm" },
                no: { label: "Cancel" },
                rejectClose: false,
                modal: true
            }));
        } catch (error) {
            console.warn(`${MODULE_ID} | DialogV2 confirmation failed; falling back to browser confirmation.`, error);
        }
    }

    return window.confirm(fallback);
}

export class CursorConfigApp extends foundry.applications.api.HandlebarsApplicationMixin(
    foundry.applications.api.ApplicationV2
) {
    static DEFAULT_OPTIONS = {
        id: "cursor-config-app",
        tag: "form",
        form: {
            handler: CursorConfigApp.#onSubmit,
            closeOnSubmit: true
        },
        actions: {
            browseCursorImage: CursorConfigApp.#onBrowseCursorImage,
            clearCursorImage: CursorConfigApp.#onClearCursorImage,
            copyProfile: CursorConfigApp.#onCopyProfile,
            resetAll: CursorConfigApp.#onResetAll,
            resetProfile: CursorConfigApp.#onResetProfile,
            selectCursorTab: CursorConfigApp.#onSelectCursorTab,
            setNamePreset: CursorConfigApp.#onSetNamePreset,
            useAomDefault: CursorConfigApp.#onUseAomDefault
        },
        window: {
            title: "Cursor Configuration",
            icon: "fas fa-mouse-pointer",
            resizable: false
        },
        position: {
            width: 760,
            height: 720
        },
        classes: ["target-the-beastie", "cursor-config"]
    };

    static PARTS = {
        form: {
            template: `modules/${MODULE_ID}/templates/cursor-config.html`
        }
    };

    constructor(options = {}) {
        super(options);
        this.targetUserId = options.targetUserId ?? game.user.id;
    }

    async _prepareContext(options) {
        const targetUser = game.users.get(this.targetUserId) ?? game.user;
        const config = getUserCursorConfig(targetUser);
        const states = foundry.utils.deepClone(config.cursorStates);
        const statesArray = CURSOR_STATE_KEYS.map(key => {
            const details = CURSOR_STATE_DETAILS[key];
            return {
                key,
                isDefault: key === "default",
                ...details,
                disabledFallbackLabel: details.disabledFallbackKey ? CURSOR_STATE_DETAILS[details.disabledFallbackKey]?.label ?? "Default" : null,
                ...states[key]
            };
        });
        const namePosition = config.namePosition;
        const nameOffset = config.nameOffset;
        return {
            states: statesArray,
            defaultCursorPath: DEFAULT_CURSOR_PATH,
            cursorImage: states.default?.image || DEFAULT_CURSOR_PATH,
            canConfigureUsers: game.user.isGM,
            users: game.users.map(user => ({
                id: user.id,
                name: user.name,
                selected: user.id === targetUser.id
            })),
            copyUsers: game.users.map(user => ({
                id: user.id,
                name: user.name
            })),
            targetUserId: targetUser.id,
            playerName: targetUser.name,
            useCustomCursor: config.useCustomCursor,
            namePosition,
            nameOffsetX: nameOffset?.x ?? 0,
            nameOffsetY: nameOffset?.y ?? 1.2
        };
    }

    static #getStateSection(target) {
        return target?.closest?.('.ttb-tab-content') ?? null;
    }

    static #updateStatePreview(section) {
        if (!section) return;

        const stateKey = section.dataset.tab;
        const previewImg = section.querySelector('.ttb-preview-img');
        const hotspotDot = section.querySelector('.ttb-hotspot-dot');
        const xSlider = section.querySelector(`input[name="states.${stateKey}.hotspotX"]`);
        const ySlider = section.querySelector(`input[name="states.${stateKey}.hotspotY"]`);
        const rotSlider = section.querySelector(`input[name="states.${stateKey}.rotation"]`);
        const xValue = section.querySelector('.ttb-hotspot-x-value');
        const yValue = section.querySelector('.ttb-hotspot-y-value');
        const rotValue = section.querySelector('.ttb-rotation-value');
        const wInput = section.querySelector(`input[name="states.${stateKey}.width"]`);
        const hInput = section.querySelector(`input[name="states.${stateKey}.height"]`);
        if (!xSlider || !ySlider) return;

        const x = parseInt(xSlider.value);
        const y = parseInt(ySlider.value);
        const rot = rotSlider ? parseInt(rotSlider.value) : 0;
        if (xValue) xValue.textContent = x;
        if (yValue) yValue.textContent = y;
        if (rotValue) rotValue.textContent = rot;

        if (previewImg) {
            const w = parseInt(wInput?.value) || 0;
            const h = parseInt(hInput?.value) || 0;
            previewImg.style.width = w > 0 ? `${w}px` : '';
            previewImg.style.height = h > 0 ? `${h}px` : '';
            previewImg.style.transform = rot ? `rotate(${rot}deg)` : '';
        }

        if (hotspotDot && previewImg) {
            const displayW = previewImg.offsetWidth || previewImg.naturalWidth || 64;
            const displayH = previewImg.offsetHeight || previewImg.naturalHeight || 64;
            if (rot === 0) {
                hotspotDot.style.left = `${x - 3}px`;
                hotspotDot.style.top = `${y - 3}px`;
            } else {
                const cx = displayW / 2;
                const cy = displayH / 2;
                const rad = (rot * Math.PI) / 180;
                const dx = x - cx;
                const dy = y - cy;
                const rx = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
                const ry = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
                hotspotDot.style.left = `${rx - 3}px`;
                hotspotDot.style.top = `${ry - 3}px`;
            }
        }
    }

    static #validateCursorImageDimensions(path) {
        if (!path) return;
        const img = new Image();
        img.onload = () => {
            if (img.width > 128 || img.height > 128) {
                ui.notifications.warn(`Cursor image is ${img.width}x${img.height}px. Browser cursors should be 128x128 or smaller for best results.`);
            }
        };
        img.onerror = () => {
            debugLog("config", `Failed to load cursor image for validation: ${path}`);
        };
        img.src = path;
    }

    static #updateStateImage(section, path) {
        if (!section) return;
        const stateKey = section.dataset.tab;
        const imageInput = section.querySelector(`input[name="states.${stateKey}.image"]`);
        const previewImg = section.querySelector('.ttb-preview-img');
        const trimmedPath = path?.trim?.() ?? path ?? "";
        if (imageInput) imageInput.value = trimmedPath;
        if (previewImg) {
            previewImg.src = trimmedPath || '';
            previewImg.style.display = trimmedPath ? 'block' : 'none';
        }
        CursorConfigApp.#validateCursorImageDimensions(trimmedPath);
    }

    static #resetStateSection(section, state) {
        if (!section || !state) return;
        const key = section.dataset.tab;
        const img = section.querySelector(`input[name="states.${key}.image"]`);
        const xS = section.querySelector(`input[name="states.${key}.hotspotX"]`);
        const yS = section.querySelector(`input[name="states.${key}.hotspotY"]`);
        const rS = section.querySelector(`input[name="states.${key}.rotation"]`);
        const wS = section.querySelector(`input[name="states.${key}.width"]`);
        const hS = section.querySelector(`input[name="states.${key}.height"]`);
        const en = section.querySelector(`input[name="states.${key}.enabled"]`);
        const preview = section.querySelector('.ttb-preview-img');

        if (img) img.value = state.image;
        if (xS) xS.value = state.hotspotX;
        if (yS) yS.value = state.hotspotY;
        if (rS) rS.value = state.rotation || 0;
        if (wS) wS.value = state.width || '';
        if (hS) hS.value = state.height || '';
        if (en) {
            en.checked = state.enabled;
            en.dispatchEvent(new Event('change'));
        }
        if (preview) {
            preview.src = state.image || '';
            preview.style.display = state.image ? 'block' : 'none';
            preview.style.width = '';
            preview.style.height = '';
        }
        CursorConfigApp.#updateStatePreview(section);
    }

    static #setActiveNamePreset(previewContainer, presetName) {
        previewContainer?.querySelectorAll('.ttb-name-preset').forEach(button => {
            button.classList.toggle('active', button.dataset.preset === presetName);
        });
    }

    static #positionNameLabel(defaultSection, positionName, offsetX, offsetY) {
        const previewWrapper = defaultSection?.querySelector('.ttb-preview-wrapper');
        const dragLabel = defaultSection?.querySelector('.ttb-name-drag-label');
        const previewImg = defaultSection?.querySelector('.ttb-preview-img');
        if (!previewWrapper || !dragLabel) return;

        const imgW = previewImg?.offsetWidth || 64;
        const imgH = previewImg?.offsetHeight || 64;
        const anchor = positionName === "custom"
            ? { anchorX: 0.5, anchorY: 0 }
            : (NAME_POSITION_PRESETS[positionName] || { anchorX: 0.5, anchorY: 0 });
        const scale = 16;
        const anchorX = (imgW / 2) + (offsetX * scale);
        const anchorY = (imgH / 2) + (offsetY * scale);
        const px = anchorX - (dragLabel.offsetWidth * anchor.anchorX);
        const py = anchorY - (dragLabel.offsetHeight * anchor.anchorY);
        dragLabel.style.left = `${px}px`;
        dragLabel.style.top = `${py}px`;
    }

    static #applyNamePreset(defaultSection, presetName) {
        const previewContainer = defaultSection?.querySelector('.ttb-preview-container');
        const hiddenX = previewContainer?.querySelector('input[name="nameOffsetX"]');
        const hiddenY = previewContainer?.querySelector('input[name="nameOffsetY"]');
        const hiddenPos = previewContainer?.querySelector('input[name="namePosition"]');
        const preset = NAME_POSITION_PRESETS[presetName];
        if (!previewContainer || !hiddenX || !hiddenY || !hiddenPos || !preset) return;

        hiddenPos.value = presetName;
        hiddenX.value = preset.offsetX;
        hiddenY.value = preset.offsetY;
        CursorConfigApp.#setActiveNamePreset(previewContainer, presetName);
        CursorConfigApp.#positionNameLabel(defaultSection, presetName, preset.offsetX, preset.offsetY);
    }

    static #onSelectCursorTab(event, target) {
        event.preventDefault();
        const tab = target.dataset.tab;
        const html = this.element;
        html.querySelectorAll('.ttb-tab-btn').forEach(button => {
            button.classList.toggle('active', button.dataset.tab === tab);
        });
        html.querySelectorAll('.ttb-tab-content').forEach(content => {
            content.classList.toggle('active', content.dataset.tab === tab);
        });
    }

    static async #onResetProfile(event) {
        event.preventDefault();
        const targetUser = game.users.get(this.targetUserId) ?? game.user;
        const confirmed = await confirmCursorProfileAction({
            title: "Reset Cursor Profile",
            content: `<p>Reset <strong>${escapeHtml(targetUser.name)}</strong>'s cursor profile to defaults?</p>`,
            fallback: `Reset ${targetUser.name}'s cursor profile to defaults?`
        });
        if (!confirmed) return;

        try {
            const saved = await setUserCursorConfig(targetUser, getDefaultUserCursorConfig());
            if (targetUser.id === game.user.id) {
                await applyCursorStyles(saved.useCustomCursor);
                refreshSharedCursorImage();
            }
            ui.notifications.info(`Reset cursor profile for ${targetUser.name}.`);
            this.render({ force: true });
        } catch (err) {
            console.warn(`${MODULE_ID} | Failed to reset cursor profile for ${targetUser.name}:`, err);
            ui.notifications.error(`Could not reset cursor profile for ${targetUser.name}.`);
        }
    }

    static async #onCopyProfile(event) {
        event.preventDefault();
        const sourceUserId = this.element.querySelector('.ttb-copy-profile-select')?.value;
        const sourceUser = game.users.get(sourceUserId);
        const targetUser = game.users.get(this.targetUserId) ?? game.user;
        if (!sourceUser || !targetUser) return;
        if (sourceUser.id === targetUser.id) {
            ui.notifications.warn("Choose a different player to copy from.");
            return;
        }
        const confirmed = await confirmCursorProfileAction({
            title: "Copy Cursor Profile",
            content: `<p>Copy <strong>${escapeHtml(sourceUser.name)}</strong>'s cursor profile to <strong>${escapeHtml(targetUser.name)}</strong>?</p>`,
            fallback: `Copy ${sourceUser.name}'s cursor profile to ${targetUser.name}?`
        });
        if (!confirmed) return;

        try {
            const sourceConfig = getUserCursorConfig(sourceUser);
            const saved = await setUserCursorConfig(targetUser, foundry.utils.deepClone(sourceConfig));
            if (targetUser.id === game.user.id) {
                await applyCursorStyles(saved.useCustomCursor);
                refreshSharedCursorImage();
            }
            ui.notifications.info(`Copied cursor profile from ${sourceUser.name} to ${targetUser.name}.`);
            this.render({ force: true });
        } catch (err) {
            console.warn(`${MODULE_ID} | Failed to copy cursor profile:`, err);
            ui.notifications.error("Could not copy that cursor profile.");
        }
    }

    static #onBrowseCursorImage(event, target) {
        event.preventDefault();
        const section = CursorConfigApp.#getStateSection(target);
        const stateKey = section?.dataset.tab;
        const imageInput = section?.querySelector(`input[name="states.${stateKey}.image"]`);
        const FilePickerImplementation = foundry.applications.apps.FilePicker?.implementation;
        if (typeof FilePickerImplementation !== "function") {
            ui.notifications.error("Foundry V14 FilePicker implementation is unavailable.");
            return;
        }

        const fp = new FilePickerImplementation({
            type: "image",
            current: imageInput?.value || "",
            callback: (path) => {
                debugLog("config", `FilePicker callback: selected path="${path}"`);
                CursorConfigApp.#updateStateImage(section, path);
            }
        });
        fp.browse();
    }

    static #onUseAomDefault(event, target) {
        event.preventDefault();
        const section = CursorConfigApp.#getStateSection(target);
        const stateKey = section?.dataset.tab;
        CursorConfigApp.#updateStateImage(section, DEFAULT_CURSOR_PATH);
        const xSlider = section?.querySelector(`input[name="states.${stateKey}.hotspotX"]`);
        const ySlider = section?.querySelector(`input[name="states.${stateKey}.hotspotY"]`);
        const rotSlider = section?.querySelector(`input[name="states.${stateKey}.rotation"]`);
        const wInput = section?.querySelector(`input[name="states.${stateKey}.width"]`);
        const hInput = section?.querySelector(`input[name="states.${stateKey}.height"]`);
        if (xSlider) xSlider.value = DEFAULT_HOTSPOT.x;
        if (ySlider) ySlider.value = DEFAULT_HOTSPOT.y;
        if (rotSlider) rotSlider.value = 0;
        if (wInput) wInput.value = '';
        if (hInput) hInput.value = '';
        CursorConfigApp.#updateStatePreview(section);
    }

    static #onClearCursorImage(event, target) {
        event.preventDefault();
        const section = CursorConfigApp.#getStateSection(target);
        const stateKey = section?.dataset.tab;
        CursorConfigApp.#updateStateImage(section, "");
        const xSlider = section?.querySelector(`input[name="states.${stateKey}.hotspotX"]`);
        const ySlider = section?.querySelector(`input[name="states.${stateKey}.hotspotY"]`);
        const rotSlider = section?.querySelector(`input[name="states.${stateKey}.rotation"]`);
        const wInput = section?.querySelector(`input[name="states.${stateKey}.width"]`);
        const hInput = section?.querySelector(`input[name="states.${stateKey}.height"]`);
        if (xSlider) xSlider.value = 0;
        if (ySlider) ySlider.value = 0;
        if (rotSlider) rotSlider.value = 0;
        if (wInput) wInput.value = '';
        if (hInput) hInput.value = '';
        CursorConfigApp.#updateStatePreview(section);
    }

    static #onResetAll(event) {
        event.preventDefault();
        const defaults = getDefaultCursorStates();
        CURSOR_STATE_KEYS.forEach(key => {
            const section = this.element.querySelector(`.ttb-tab-content[data-tab="${key}"]`);
            CursorConfigApp.#resetStateSection(section, defaults[key]);
        });
        ui.notifications.info("Reset to defaults.");
    }

    static #onSetNamePreset(event, target) {
        event.preventDefault();
        const defaultSection = target.closest('.ttb-tab-content[data-tab="default"]');
        CursorConfigApp.#applyNamePreset(defaultSection, target.dataset.preset);
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;

        const userSelect = html.querySelector('.ttb-user-select');
        if (userSelect) {
            userSelect.addEventListener('change', (e) => {
                e.preventDefault();
                this.targetUserId = userSelect.value || game.user.id;
                this.render({ force: true });
            });
        }

        // Per-state controls
        CURSOR_STATE_KEYS.forEach(stateKey => {
            const section = html.querySelector(`.ttb-tab-content[data-tab="${stateKey}"]`);
            if (!section) return;

            const imageInput = section.querySelector(`input[name="states.${stateKey}.image"]`);
            const previewImg = section.querySelector('.ttb-preview-img');
            const xSlider = section.querySelector(`input[name="states.${stateKey}.hotspotX"]`);
            const ySlider = section.querySelector(`input[name="states.${stateKey}.hotspotY"]`);
            const rotSlider = section.querySelector(`input[name="states.${stateKey}.rotation"]`);
            const enableCheckbox = section.querySelector(`input[name="states.${stateKey}.enabled"]`);
            const wInput = section.querySelector(`input[name="states.${stateKey}.width"]`);
            const hInput = section.querySelector(`input[name="states.${stateKey}.height"]`);
            const ratioBtn = section.querySelector('.ttb-ratio-btn');

            // Ratio lock state (per-tab, not persisted)
            let ratioLocked = false;
            let lockedRatio = 1; // width / height

            const updatePreview = () => CursorConfigApp.#updateStatePreview(section);

            // Ratio lock button
            if (ratioBtn) {
                ratioBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    ratioLocked = !ratioLocked;
                    ratioBtn.classList.toggle('locked', ratioLocked);
                    if (ratioLocked) {
                        // Capture ratio from current inputs, fall back to natural image size
                        const w = parseInt(wInput?.value) || previewImg?.naturalWidth || 1;
                        const h = parseInt(hInput?.value) || previewImg?.naturalHeight || 1;
                        lockedRatio = w / h;
                    }
                });
            }

            // Width input — update height when ratio locked
            if (wInput) {
                wInput.addEventListener('input', () => {
                    if (ratioLocked && hInput) {
                        const w = parseInt(wInput.value);
                        if (w > 0) hInput.value = Math.round(w / lockedRatio);
                    }
                    updatePreview();
                });
            }

            // Height input — update width when ratio locked
            if (hInput) {
                hInput.addEventListener('input', () => {
                    if (ratioLocked && wInput) {
                        const h = parseInt(hInput.value);
                        if (h > 0) wInput.value = Math.round(h * lockedRatio);
                    }
                    updatePreview();
                });
            }

            if (imageInput) {
                imageInput.addEventListener('change', () => CursorConfigApp.#updateStateImage(section, imageInput.value));
            }
            if (xSlider) xSlider.addEventListener('input', updatePreview);
            if (ySlider) ySlider.addEventListener('input', updatePreview);
            if (rotSlider) rotSlider.addEventListener('input', updatePreview);

            // Enable/disable toggle - show/hide fields
            if (enableCheckbox) {
                const fields = section.querySelector('.ttb-state-fields');
                const toggle = () => {
                    if (fields) fields.style.display = enableCheckbox.checked ? 'block' : 'none';
                };
                enableCheckbox.addEventListener('change', toggle);
                toggle();
            }

            updatePreview();
        });

        // --- Name Label Position (inside Default tab's preview) ---
        const defaultSection = html.querySelector('.ttb-tab-content[data-tab="default"]');
        const dragLabel = defaultSection?.querySelector('.ttb-name-drag-label');
        if (defaultSection && dragLabel) {
            const previewContainer = defaultSection.querySelector('.ttb-preview-container');
            const hiddenX = previewContainer.querySelector('input[name="nameOffsetX"]');
            const hiddenY = previewContainer.querySelector('input[name="nameOffsetY"]');
            const hiddenPos = previewContainer.querySelector('input[name="namePosition"]');
            const previewImg = defaultSection.querySelector('.ttb-preview-img');

            // Init from current values
            CursorConfigApp.#setActiveNamePreset(previewContainer, hiddenPos.value);
            requestAnimationFrame(() => {
                CursorConfigApp.#positionNameLabel(defaultSection, hiddenPos.value, parseFloat(hiddenX.value), parseFloat(hiddenY.value));
            });

            // Drag logic
            let dragging = false;
            let dragStartX = 0, dragStartY = 0, labelStartX = 0, labelStartY = 0;

            dragLabel.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this._cleanupDragListeners();
                dragging = true;
                dragStartX = e.clientX;
                dragStartY = e.clientY;
                labelStartX = dragLabel.offsetLeft;
                labelStartY = dragLabel.offsetTop;

                const listenerDocument = dragLabel.ownerDocument ?? this.element?.ownerDocument ?? document;
                this._dragListenerDocument = listenerDocument;
                this._boundDocMouseMove = (moveEvent) => {
                    if (!dragging) return;
                    const dx = moveEvent.clientX - dragStartX;
                    const dy = moveEvent.clientY - dragStartY;
                    const newX = labelStartX + dx;
                    const newY = labelStartY + dy;
                    dragLabel.style.left = `${newX}px`;
                    dragLabel.style.top = `${newY}px`;

                    // Convert back to offset multipliers relative to image center
                    const imgW = previewImg?.offsetWidth || 64;
                    const imgH = previewImg?.offsetHeight || 64;
                    const scale = 16;
                    const offsetX = ((newX + dragLabel.offsetWidth / 2) - imgW / 2) / scale;
                    const offsetY = (newY - imgH / 2) / scale;
                    hiddenX.value = Math.round(offsetX * 100) / 100;
                    hiddenY.value = Math.round(offsetY * 100) / 100;
                    hiddenPos.value = "custom";
                    CursorConfigApp.#setActiveNamePreset(previewContainer, "custom");
                };
                this._boundDocMouseUp = () => {
                    dragging = false;
                    this._cleanupDragListeners();
                };

                listenerDocument.addEventListener('mousemove', this._boundDocMouseMove);
                listenerDocument.addEventListener('mouseup', this._boundDocMouseUp, { once: true });
            });

            // Re-position label when image size/rotation changes
            const reposOnChange = () => {
                requestAnimationFrame(() => {
                    CursorConfigApp.#positionNameLabel(defaultSection, hiddenPos.value, parseFloat(hiddenX.value), parseFloat(hiddenY.value));
                });
            };
            const wInput = defaultSection.querySelector('input[name="states.default.width"]');
            const hInput = defaultSection.querySelector('input[name="states.default.height"]');
            if (wInput) wInput.addEventListener('input', reposOnChange);
            if (hInput) hInput.addEventListener('input', reposOnChange);
            if (previewImg) previewImg.addEventListener('load', reposOnChange);
        }
    }

    _cleanupDragListeners() {
        const listenerDocument = this._dragListenerDocument ?? document;
        if (this._boundDocMouseMove) {
            listenerDocument.removeEventListener('mousemove', this._boundDocMouseMove);
            this._boundDocMouseMove = null;
        }
        if (this._boundDocMouseUp) {
            listenerDocument.removeEventListener('mouseup', this._boundDocMouseUp);
            this._boundDocMouseUp = null;
        }
        this._dragListenerDocument = null;
    }

    _onAttach(...args) {
        this._cleanupDragListeners();
        return super._onAttach?.(...args);
    }

    _onDetach(...args) {
        this._cleanupDragListeners();
        return super._onDetach?.(...args);
    }

    _onClose(options) {
        this._cleanupDragListeners();
        super._onClose(options);
    }

    static async #onSubmit(event, form, formData) {
        const data = formData?.object ?? new foundry.applications.ux.FormDataExtended(form).object;
        debugLog("config", "onSubmit: raw FormDataExtended:", JSON.stringify(data, null, 2));
        const targetUserId = game.user.isGM ? (data.targetUserId || game.user.id) : game.user.id;
        const targetUser = game.users.get(targetUserId);
        if (!targetUser) {
            ui.notifications.error("Could not find that player to save cursor settings.");
            return;
        }
        const parseNumber = (value, fallback) => {
            const parsed = Number.parseFloat(value);
            return Number.isFinite(parsed) ? parsed : fallback;
        };

        const states = {};

        CURSOR_STATE_KEYS.forEach(key => {
            states[key] = {
                image: data[`states.${key}.image`] ?? "",
                hotspotX: parseInt(data[`states.${key}.hotspotX`]) || 0,
                hotspotY: parseInt(data[`states.${key}.hotspotY`]) || 0,
                rotation: parseInt(data[`states.${key}.rotation`]) || 0,
                width: parseInt(data[`states.${key}.width`]) || 0,
                height: parseInt(data[`states.${key}.height`]) || 0,
                enabled: key === "default" ? true : !!data[`states.${key}.enabled`]
            };
            debugLog("config", `onSubmit: parsed state "${key}":`, JSON.stringify(states[key]));
        });

        // Save name label position
        const namePos = data.namePosition || "bottom-center";
        const nameOffsetX = parseNumber(data.nameOffsetX, 0);
        const nameOffsetY = parseNumber(data.nameOffsetY, 1.2);
        const useCustomCursor = !!data.useCustomCursor;
        let saved;
        try {
            saved = await setUserCursorConfig(targetUser, {
                useCustomCursor,
                cursorStates: states,
                namePosition: namePos,
                nameOffset: { x: nameOffsetX, y: nameOffsetY }
            });
        } catch (e) {
            console.warn(`${MODULE_ID} | Failed to save cursor configuration for ${targetUser.name}:`, e);
            ui.notifications.error(`Could not save cursor configuration for ${targetUser.name}.`);
            return;
        }
        debugLog("config", `onSubmit: saved cursor config for ${targetUser.name}:`, JSON.stringify(saved, null, 2));

        if (targetUser.id === game.user.id) {
            await applyCursorStyles(saved.useCustomCursor);
            refreshSharedCursorImage();
        }

        ui.notifications.info(`Cursor configuration saved for ${targetUser.name}!`);
    }
}
