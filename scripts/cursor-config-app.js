/**
 * @file cursor-config-app.js
 * @description ApplicationV2 sheet for editing Show of Hands per-user cursor
 * images, hotspots, size, rotation, and overlay name placement.
 */

import { MODULE_ID, CURSOR_POINTER_SIZE, CURSOR_SIZE_MAX, CURSOR_SOURCE_HOTSPOT_MAX, CURSOR_STATE_KEYS, CURSOR_STATE_DETAILS, NAME_POSITION_PRESETS, NAME_LABEL_OFFSET_SCALE, debugLog } from './constants.js';
import { getDefaultUserCursorConfig, getUserCursorConfig, setUserCursorConfig, summarizeCursorConfigForLog } from './settings.js';
import { applyCursorStyles } from './cursor-styles.js';
import { refreshSharedCursorImage } from './cursor-sharing.js';
import { computeCursorPreviewGeometry, computeCursorSourceHotspotBounds } from './cursor-geometry-core.js';

function escapeHtml(value) {
    // Use Foundry's escaper when it exists; keep a tiny fallback for tests and
    // early-load paths.
    const foundryEscape = foundry.utils?.escapeHTML;
    if (typeof foundryEscape === "function") return foundryEscape(value ?? "");
    return String(value ?? "").replace(/[&<>"']/g, match => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[match]));
}

async function confirmCursorProfileAction({
    title,
    content,
    fallback,
    yesLabel = "Confirm",
    noLabel = "Cancel"
}) {
    const DialogV2 = foundry.applications.api?.DialogV2;
    if (DialogV2?.confirm) {
        try {
            return !!(await DialogV2.confirm({
                window: { title },
                content,
                yes: { label: yesLabel },
                no: { label: noLabel },
                rejectClose: false,
                modal: true
            }));
        } catch (error) {
            console.warn(`${MODULE_ID} | DialogV2 confirmation failed; falling back to browser confirmation.`, error);
        }
    }

    return window.confirm(fallback);
}

function clampCursorDimension(value, min = 1, max = CURSOR_SIZE_MAX) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
}

/**
 * Resolve the width/height pair produced by an aspect-ratio-locked edit.
 *
 * Keep both controls valid while preserving the requested ratio as closely as
 * integer dimensions inside the UI bounds allow. For ratios wider or taller
 * than the complete range can express, clamp to the closest valid edge pair
 * instead of leaving either form control invalid.
 */
export function computeRatioLockedDimensions({
    driver = "width",
    value,
    ratio,
    min = 1,
    max = CURSOR_SIZE_MAX
} = {}) {
    const safeMin = Math.max(1, Math.round(Number(min)) || 1);
    const safeMax = Math.max(safeMin, Math.round(Number(max)) || CURSOR_SIZE_MAX);
    const safeRatio = Number.isFinite(Number(ratio)) && Number(ratio) > 0
        ? Number(ratio)
        : 1;
    const driven = clampCursorDimension(value, safeMin, safeMax);
    let width = driver === "height" ? driven * safeRatio : driven;
    let height = driver === "height" ? driven : driven / safeRatio;

    const downScale = Math.min(1, safeMax / width, safeMax / height);
    width *= downScale;
    height *= downScale;

    const upScale = Math.max(1, safeMin / width, safeMin / height);
    if (width * upScale <= safeMax && height * upScale <= safeMax) {
        width *= upScale;
        height *= upScale;
    }

    return {
        width: clampCursorDimension(width, safeMin, safeMax),
        height: clampCursorDimension(height, safeMin, safeMax)
    };
}

/** Resolve the ratio represented by the current preview geometry. */
export function getCursorAspectRatio({ width, height, naturalWidth, naturalHeight } = {}) {
    const configuredWidth = Number(width);
    const configuredHeight = Number(height);
    const sourceWidth = Number(naturalWidth);
    const sourceHeight = Number(naturalHeight);

    if (configuredWidth > 0 && configuredHeight > 0) return configuredWidth / configuredHeight;
    if (sourceWidth > 0 && sourceHeight > 0) return sourceWidth / sourceHeight;
    return 1;
}

export class CursorConfigApp extends foundry.applications.api.HandlebarsApplicationMixin(
    foundry.applications.api.ApplicationV2
) {
    static DEFAULT_OPTIONS = {
        id: "cursor-config-app",
        tag: "form",
        form: {
            handler: CursorConfigApp.#onSubmit,
            // Close explicitly only after persistence and local refresh succeed.
            // ApplicationV2 otherwise closes after any normally resolved handler,
            // including a caught flag-write failure.
            closeOnSubmit: false
        },
        actions: {
            browseCursorImage: CursorConfigApp.#onBrowseCursorImage,
            clearCursorImage: CursorConfigApp.#onClearCursorImage,
            copyProfile: CursorConfigApp.#onCopyProfile,
            resetAll: CursorConfigApp.#onResetAll,
            resetProfile: CursorConfigApp.#onResetProfile,
            selectCursorTab: CursorConfigApp.#onSelectCursorTab,
            setNamePreset: CursorConfigApp.#onSetNamePreset
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
        classes: ["show-of-hands", "cursor-config"]
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
                ...states[key],
                hotspotMax: CURSOR_SOURCE_HOTSPOT_MAX
            };
        });
        const namePosition = config.namePosition;
        const nameOffset = config.nameOffset;
        return {
            states: statesArray,
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

    // Keep the noisy per-state selectors in one place.
    static #getStateInputs(section) {
        if (!section) return null;
        const key = section.dataset.tab;
        const input = (field) => section.querySelector(`input[name="states.${key}.${field}"]`);
        return {
            key,
            image: input("image"),
            hotspotX: input("hotspotX"),
            hotspotY: input("hotspotY"),
            rotation: input("rotation"),
            width: input("width"),
            height: input("height"),
            enabled: input("enabled"),
            previewImg: section.querySelector('.ttb-preview-img'),
            hotspotDot: section.querySelector('.ttb-hotspot-dot'),
            ratioBtn: section.querySelector('.ttb-ratio-btn'),
            xValue: section.querySelector('.ttb-hotspot-x-value'),
            yValue: section.querySelector('.ttb-hotspot-y-value'),
            rotValue: section.querySelector('.ttb-rotation-value')
        };
    }

    static #syncHotspotSliderBounds(inputs) {
        const { image, previewImg, hotspotX: xSlider, hotspotY: ySlider } = inputs;
        const hasConfiguredImage = typeof image?.value === 'string' && image.value.trim().length > 0;
        const hasLoadedImage = hasConfiguredImage && previewImg?.complete !== false
            && previewImg?.naturalWidth > 0 && previewImg?.naturalHeight > 0;
        const { maxX, maxY } = computeCursorSourceHotspotBounds(
            hasLoadedImage ? previewImg.naturalWidth : 0,
            hasLoadedImage ? previewImg.naturalHeight : 0
        );
        const syncSlider = (slider, max) => {
            if (!slider) return 0;
            slider.max = String(max);
            const value = Number.parseInt(slider.value, 10);
            const clamped = Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : 0;
            slider.value = String(clamped);
            return clamped;
        };
        return {
            hasLoadedImage,
            x: syncSlider(xSlider, maxX),
            y: syncSlider(ySlider, maxY)
        };
    }

    static #updateStatePreview(section) {
        const inputs = CursorConfigApp.#getStateInputs(section);
        if (!inputs) return;
        const { previewImg, hotspotDot, hotspotX: xSlider, hotspotY: ySlider, rotation: rotSlider, xValue, yValue, rotValue, width: wInput, height: hInput } = inputs;
        if (!xSlider || !ySlider) return;

        const { hasLoadedImage, x, y } = CursorConfigApp.#syncHotspotSliderBounds(inputs);
        const rot = rotSlider ? parseInt(rotSlider.value) : 0;
        if (xValue) xValue.textContent = x;
        if (yValue) yValue.textContent = y;
        if (rotValue) rotValue.textContent = rot;

        if (!previewImg) return;

        const wrapper = previewImg.closest?.('.ttb-preview-wrapper');
        if (!hasLoadedImage) {
            // Keep a small anchor for the overlay-name preview, but do not show
            // fabricated cursor geometry or a stale hotspot for empty/broken art.
            if (wrapper) {
                wrapper.style.width = `${CURSOR_POINTER_SIZE}px`;
                wrapper.style.height = `${CURSOR_POINTER_SIZE}px`;
            }
            previewImg.style.visibility = 'hidden';
            if (hotspotDot) hotspotDot.style.display = 'none';
            CursorConfigApp.#queueNameLabelPosition(section);
            return;
        }

        const naturalW = previewImg.naturalWidth;
        const naturalH = previewImg.naturalHeight;
        const w = parseInt(wInput?.value) || 0;
        const h = parseInt(hInput?.value) || 0;
        const preview = computeCursorPreviewGeometry(
            naturalW,
            naturalH,
            w,
            h,
            x,
            y,
            rot,
            CURSOR_SIZE_MAX
        );
        if (wrapper) {
            wrapper.style.width = `${preview.width}px`;
            wrapper.style.height = `${preview.height}px`;
        }
        previewImg.style.visibility = 'visible';
        previewImg.style.position = 'absolute';
        previewImg.style.left = `${preview.imageLeft}px`;
        previewImg.style.top = `${preview.imageTop}px`;
        previewImg.style.width = `${preview.imageWidth}px`;
        previewImg.style.height = `${preview.imageHeight}px`;
        previewImg.style.transformOrigin = 'center';
        previewImg.style.transform = rot ? `rotate(${rot}deg)` : '';

        if (hotspotDot) {
            hotspotDot.style.display = 'block';
            hotspotDot.style.left = `${preview.hotspotX - 3}px`;
            hotspotDot.style.top = `${preview.hotspotY - 3}px`;
        }
        CursorConfigApp.#queueNameLabelPosition(section);
    }

    static #queueNameLabelPosition(section) {
        if (section?.dataset?.tab !== 'default') return;
        const previewContainer = section.querySelector('.ttb-preview-container');
        const hiddenX = previewContainer?.querySelector('input[name="nameOffsetX"]');
        const hiddenY = previewContainer?.querySelector('input[name="nameOffsetY"]');
        const hiddenPos = previewContainer?.querySelector('input[name="namePosition"]');
        if (!hiddenX || !hiddenY || !hiddenPos) return;
        requestAnimationFrame(() => {
            const x = Number.parseFloat(hiddenX.value);
            const y = Number.parseFloat(hiddenY.value);
            CursorConfigApp.#positionNameLabel(
                section,
                hiddenPos.value,
                Number.isFinite(x) ? x : 0,
                Number.isFinite(y) ? y : 1.2
            );
        });
    }

    static #validateCursorImageDimensions(path) {
        if (!path) return;
        const img = new Image();
        img.onload = () => {
            if (img.width > CURSOR_SIZE_MAX || img.height > CURSOR_SIZE_MAX) {
                ui.notifications.warn(`Cursor image is ${img.width}x${img.height}px. Browser cursors should be ${CURSOR_SIZE_MAX}x${CURSOR_SIZE_MAX} or smaller for best results.`);
            }
        };
        img.onerror = () => {
            debugLog("config", `Failed to load cursor image for validation: ${path}`);
            ui.notifications.warn(`Could not load cursor image: ${path}. Check that the path is correct.`);
        };
        img.src = path;
    }

    static #updateStateImage(section, path) {
        const inputs = CursorConfigApp.#getStateInputs(section);
        if (!inputs) return;
        const { image: imageInput, previewImg } = inputs;
        const trimmedPath = path?.trim?.() ?? path ?? "";
        if (imageInput) imageInput.value = trimmedPath;
        if (previewImg) {
            previewImg.src = trimmedPath || '';
            previewImg.style.display = trimmedPath ? 'block' : 'none';
        }
        CursorConfigApp.#updateStatePreview(section);
        CursorConfigApp.#validateCursorImageDimensions(trimmedPath);
    }

    static #resetStateSection(section, state) {
        const inputs = CursorConfigApp.#getStateInputs(section);
        if (!inputs || !state) return;
        const { image: img, hotspotX: xS, hotspotY: yS, rotation: rS, width: wS, height: hS, enabled: en, previewImg: preview } = inputs;

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

        const imgW = previewWrapper.offsetWidth || previewImg?.offsetWidth || 64;
        const imgH = previewWrapper.offsetHeight || previewImg?.offsetHeight || 64;
        const anchor = positionName === "custom"
            ? { anchorX: 0.5, anchorY: 0 }
            : (NAME_POSITION_PRESETS[positionName] || { anchorX: 0.5, anchorY: 0 });
        const anchorX = (imgW / 2) + (offsetX * NAME_LABEL_OFFSET_SCALE);
        const anchorY = (imgH / 2) + (offsetY * NAME_LABEL_OFFSET_SCALE);
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

    static async #onBrowseCursorImage(event, target) {
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
                this._formDirty = true;
            }
        });
        try {
            await fp.browse();
        } catch (error) {
            console.warn(`${MODULE_ID} | FilePicker browse failed:`, error);
            ui.notifications.error("Could not open the cursor image browser.");
        }
    }

    // An empty image path means native Foundry cursor. Reset image-only controls
    // so old size/rotation values do not hang around.
    static #applyStateImageReset(section, { image, hotspotX, hotspotY }) {
        const inputs = CursorConfigApp.#getStateInputs(section);
        if (!inputs) return;
        CursorConfigApp.#updateStateImage(section, image);
        const { hotspotX: xSlider, hotspotY: ySlider, rotation: rotSlider, width: wInput, height: hInput } = inputs;
        if (xSlider) xSlider.value = hotspotX;
        if (ySlider) ySlider.value = hotspotY;
        if (rotSlider) rotSlider.value = 0;
        if (wInput) wInput.value = '';
        if (hInput) hInput.value = '';
        CursorConfigApp.#updateStatePreview(section);
    }

    static #onClearCursorImage(event, target) {
        event.preventDefault();
        const section = CursorConfigApp.#getStateSection(target);
        CursorConfigApp.#applyStateImageReset(section, { image: "", hotspotX: 0, hotspotY: 0 });
        this._formDirty = true;
    }

    static #onResetAll(event) {
        event.preventDefault();
        const profileDefaults = getDefaultUserCursorConfig();
        const defaults = profileDefaults.cursorStates;
        CURSOR_STATE_KEYS.forEach(key => {
            const section = this.element.querySelector(`.ttb-tab-content[data-tab="${key}"]`);
            CursorConfigApp.#resetStateSection(section, defaults[key]);
        });

        const customCursorToggle = this.element.querySelector('input[name="useCustomCursor"]');
        if (customCursorToggle) customCursorToggle.checked = profileDefaults.useCustomCursor;

        const defaultSection = this.element.querySelector('.ttb-tab-content[data-tab="default"]');
        const previewContainer = defaultSection?.querySelector('.ttb-preview-container');
        const hiddenX = previewContainer?.querySelector('input[name="nameOffsetX"]');
        const hiddenY = previewContainer?.querySelector('input[name="nameOffsetY"]');
        const hiddenPos = previewContainer?.querySelector('input[name="namePosition"]');
        if (hiddenX) hiddenX.value = profileDefaults.nameOffset.x;
        if (hiddenY) hiddenY.value = profileDefaults.nameOffset.y;
        if (hiddenPos) hiddenPos.value = profileDefaults.namePosition;
        CursorConfigApp.#setActiveNamePreset(previewContainer, profileDefaults.namePosition);
        CursorConfigApp.#positionNameLabel(
            defaultSection,
            profileDefaults.namePosition,
            profileDefaults.nameOffset.x,
            profileDefaults.nameOffset.y
        );

        this._formDirty = true;
        ui.notifications.info("Reset all cursor profile fields to defaults. Save to apply.");
    }

    static #onSetNamePreset(event, target) {
        event.preventDefault();
        const defaultSection = target.closest('.ttb-tab-content[data-tab="default"]');
        CursorConfigApp.#applyNamePreset(defaultSection, target.dataset.preset);
        this._formDirty = true;
    }

    _onRender(context, options) {
        super._onRender(context, options);
        // V14 detach/attach renders move the existing Application element
        // without replacing its Handlebars content. Its listeners and dirty
        // form state therefore remain valid and must not be reset or rebound.
        const windowOptions = options?.window;
        const isMovingWindow = !!(windowOptions?.detach || windowOptions?.attach)
            || Object.prototype.hasOwnProperty.call(windowOptions ?? {}, "detached");
        if (isMovingWindow) return;

        const html = this.element;
        this._formDirty = false;

        const userSelect = html.querySelector('.ttb-user-select');
        if (userSelect) {
            userSelect.addEventListener('change', async (e) => {
                e.preventDefault();
                const currentUserId = this.targetUserId;
                const nextUserId = userSelect.value || game.user.id;
                if (nextUserId === currentUserId) return;
                const nextUser = game.users.get(nextUserId);
                if (!nextUser) {
                    userSelect.value = currentUserId;
                    return;
                }
                if (this._targetSwitchPending) {
                    userSelect.value = currentUserId;
                    return;
                }

                userSelect.value = currentUserId;
                if (this._formDirty) {
                    const currentUser = game.users.get(currentUserId) ?? game.user;

                    this._targetSwitchPending = true;
                    userSelect.disabled = true;
                    let confirmed = false;
                    try {
                        confirmed = await confirmCursorProfileAction({
                            title: "Discard Unsaved Cursor Changes?",
                            content: `<p>Discard unsaved changes for <strong>${escapeHtml(currentUser.name)}</strong> and switch to <strong>${escapeHtml(nextUser.name)}</strong>?</p>`,
                            fallback: `Discard unsaved changes for ${currentUser.name} and switch to ${nextUser.name}?`,
                            yesLabel: "Discard & Switch",
                            noLabel: "Keep Editing"
                        });
                    } finally {
                        this._targetSwitchPending = false;
                        userSelect.disabled = false;
                    }
                    if (!confirmed) return;
                }

                this._formDirty = false;
                this.targetUserId = nextUserId;
                this.render({ force: true });
            });
        }

        this._markDirtyAbortController?.abort();
        const AbortControllerClass = html.ownerDocument?.defaultView?.AbortController ?? globalThis.AbortController;
        this._markDirtyAbortController = typeof AbortControllerClass === "function"
            ? new AbortControllerClass()
            : null;
        const markDirty = (event) => {
            const target = event.target;
            if (!target?.name || target === userSelect) return;
            this._formDirty = true;
        };
        const listenerOptions = this._markDirtyAbortController
            ? { signal: this._markDirtyAbortController.signal }
            : undefined;
        html.addEventListener('input', markDirty, listenerOptions);
        html.addEventListener('change', markDirty, listenerOptions);

        this.#setupStateControls(html);
        this.#setupNameLabelDrag(html);
    }

    // Attach the controls for each cursor-state tab.
    #setupStateControls(html) {
        CURSOR_STATE_KEYS.forEach(stateKey => {
            const section = html.querySelector(`.ttb-tab-content[data-tab="${stateKey}"]`);
            const inputs = CursorConfigApp.#getStateInputs(section);
            if (!inputs) return;

            const { image: imageInput, previewImg, hotspotX: xSlider, hotspotY: ySlider, rotation: rotSlider, enabled: enableCheckbox, width: wInput, height: hInput, ratioBtn } = inputs;

            // Per-tab only; saved profiles store the resulting width/height.
            let ratioLocked = false;
            let lockedRatio = 1; // width / height

            const updatePreview = () => CursorConfigApp.#updateStatePreview(section);

            // Toggle aspect-ratio locking for this tab.
            if (ratioBtn) {
                ratioBtn.setAttribute('aria-pressed', 'false');
                ratioBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    ratioLocked = !ratioLocked;
                    ratioBtn.classList.toggle('locked', ratioLocked);
                    ratioBtn.setAttribute('aria-pressed', ratioLocked ? 'true' : 'false');
                    if (ratioLocked) {
                        // If fields are blank, use the image's natural ratio.
                        lockedRatio = getCursorAspectRatio({
                            width: wInput?.value,
                            height: hInput?.value,
                            naturalWidth: previewImg?.naturalWidth,
                            naturalHeight: previewImg?.naturalHeight
                        });
                    }
                });
            }

            // Width drives height while the ratio is locked.
            if (wInput) {
                wInput.addEventListener('input', () => {
                    if (ratioLocked && hInput) {
                        const w = parseInt(wInput.value);
                        if (Number.isFinite(w)) {
                            const dimensions = computeRatioLockedDimensions({
                                driver: "width",
                                value: w,
                                ratio: lockedRatio
                            });
                            wInput.value = dimensions.width;
                            hInput.value = dimensions.height;
                        }
                    }
                    updatePreview();
                });
            }

            // Height drives width while the ratio is locked.
            if (hInput) {
                hInput.addEventListener('input', () => {
                    if (ratioLocked && wInput) {
                        const h = parseInt(hInput.value);
                        if (Number.isFinite(h)) {
                            const dimensions = computeRatioLockedDimensions({
                                driver: "height",
                                value: h,
                                ratio: lockedRatio
                            });
                            wInput.value = dimensions.width;
                            hInput.value = dimensions.height;
                        }
                    }
                    updatePreview();
                });
            }

            if (imageInput) {
                imageInput.addEventListener('change', () => CursorConfigApp.#updateStateImage(section, imageInput.value));
            }
            if (previewImg) {
                previewImg.addEventListener('load', () => {
                    if (ratioLocked) {
                        lockedRatio = getCursorAspectRatio({
                            width: wInput?.value,
                            height: hInput?.value,
                            naturalWidth: previewImg.naturalWidth,
                            naturalHeight: previewImg.naturalHeight
                        });
                    }
                    updatePreview();
                });
                previewImg.addEventListener('error', updatePreview);
            }
            if (xSlider) xSlider.addEventListener('input', updatePreview);
            if (ySlider) ySlider.addEventListener('input', updatePreview);
            if (rotSlider) rotSlider.addEventListener('input', updatePreview);

            // Disabled states keep their saved values but hide the edit fields.
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
    }

    // Hook up the draggable label in the Default tab preview.
    #setupNameLabelDrag(html) {
        const defaultSection = html.querySelector('.ttb-tab-content[data-tab="default"]');
        const dragLabel = defaultSection?.querySelector('.ttb-name-drag-label');
        if (!defaultSection || !dragLabel) return;

        const previewContainer = defaultSection.querySelector('.ttb-preview-container');
        const hiddenX = previewContainer.querySelector('input[name="nameOffsetX"]');
        const hiddenY = previewContainer.querySelector('input[name="nameOffsetY"]');
        const hiddenPos = previewContainer.querySelector('input[name="namePosition"]');
        const previewImg = defaultSection.querySelector('.ttb-preview-img');

        // Start from the saved preset/offset.
        CursorConfigApp.#setActiveNamePreset(previewContainer, hiddenPos.value);
        requestAnimationFrame(() => {
            CursorConfigApp.#positionNameLabel(defaultSection, hiddenPos.value, parseFloat(hiddenX.value), parseFloat(hiddenY.value));
        });

        // Store label movement as image-center offsets, the same space used by
        // the overlay.
        const commitLabelPosition = (newX, newY) => {
            dragLabel.style.left = `${newX}px`;
            dragLabel.style.top = `${newY}px`;
            const previewWrapper = defaultSection.querySelector('.ttb-preview-wrapper');
            const imgW = previewWrapper?.offsetWidth || previewImg?.offsetWidth || 64;
            const imgH = previewWrapper?.offsetHeight || previewImg?.offsetHeight || 64;
            const offsetX = ((newX + dragLabel.offsetWidth / 2) - imgW / 2) / NAME_LABEL_OFFSET_SCALE;
            const offsetY = (newY - imgH / 2) / NAME_LABEL_OFFSET_SCALE;
            hiddenX.value = Math.round(offsetX * 100) / 100;
            hiddenY.value = Math.round(offsetY * 100) / 100;
            hiddenPos.value = "custom";
            CursorConfigApp.#setActiveNamePreset(previewContainer, "custom");
            this._formDirty = true;
        };

        // Mouse drag path.
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
                commitLabelPosition(labelStartX + dx, labelStartY + dy);
            };
            this._boundDocMouseUp = () => {
                dragging = false;
                this._cleanupDragListeners();
            };

            listenerDocument.addEventListener('mousemove', this._boundDocMouseMove);
            listenerDocument.addEventListener('mouseup', this._boundDocMouseUp, { once: true });
        });

        // Arrow keys nudge by 1px; Shift bumps that to 10px.
        dragLabel.addEventListener('keydown', (e) => {
            const step = e.shiftKey ? 10 : 1;
            let dx = 0, dy = 0;
            switch (e.key) {
                case 'ArrowLeft': dx = -step; break;
                case 'ArrowRight': dx = step; break;
                case 'ArrowUp': dy = -step; break;
                case 'ArrowDown': dy = step; break;
                default: return;
            }
            e.preventDefault();
            commitLabelPosition(dragLabel.offsetLeft + dx, dragLabel.offsetTop + dy);
        });

        // Image size changes move the coordinate space; re-place the label next frame.
        const reposOnChange = () => {
            requestAnimationFrame(() => {
                CursorConfigApp.#positionNameLabel(defaultSection, hiddenPos.value, parseFloat(hiddenX.value), parseFloat(hiddenY.value));
            });
        };
        const wInput = defaultSection.querySelector('input[name="states.default.width"]');
        const hInput = defaultSection.querySelector('input[name="states.default.height"]');
        const rotInput = defaultSection.querySelector('input[name="states.default.rotation"]');
        if (wInput) wInput.addEventListener('input', reposOnChange);
        if (hInput) hInput.addEventListener('input', reposOnChange);
        if (rotInput) rotInput.addEventListener('input', reposOnChange);
        if (previewImg) previewImg.addEventListener('load', reposOnChange);
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
        this._markDirtyAbortController?.abort();
        this._markDirtyAbortController = null;
        super._onClose(options);
    }

    static async #onSubmit(event, form, formData) {
        const data = formData?.object ?? new foundry.applications.ux.FormDataExtended(form).object;
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
                enabled: key === "default" ? true : data[`states.${key}.enabled`] === true
            };
        });

        // Save name label placement with the cursor profile.
        const namePos = data.namePosition || "bottom-center";
        const nameOffsetX = parseNumber(data.nameOffsetX, 0);
        const nameOffsetY = parseNumber(data.nameOffsetY, 1.2);
        const useCustomCursor = data.useCustomCursor === true;
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
        debugLog("config", `onSubmit: saved cursor config for ${targetUser.name}:`, summarizeCursorConfigForLog(saved));

        if (targetUser.id === game.user.id) {
            await applyCursorStyles(saved.useCustomCursor);
            refreshSharedCursorImage();
        }

        ui.notifications.info(`Cursor configuration saved for ${targetUser.name}!`);
        await this.close({ submitted: true });
    }
}
