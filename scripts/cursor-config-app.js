import { MODULE_ID, DEFAULT_CURSOR_PATH, DEFAULT_HOTSPOT, CURSOR_STATE_KEYS, CURSOR_STATE_LABELS, debugLog } from './constants.js';
import { getDefaultCursorStates } from './settings.js';
import { applyCursorStyles } from './cursor-styles.js';
import { refreshSharedCursorImage } from './cursor-sharing.js';

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
        window: {
            title: "Cursor Configuration",
            icon: "fas fa-mouse-pointer",
            resizable: false
        },
        position: {
            width: 560,
            height: "auto"
        },
        classes: ["target-the-beastie", "cursor-config"]
    };

    static PARTS = {
        form: {
            template: `modules/${MODULE_ID}/templates/cursor-config.html`
        }
    };

    async _prepareContext(options) {
        const states = foundry.utils.deepClone(game.settings.get(MODULE_ID, "cursor-states"));
        const statesArray = CURSOR_STATE_KEYS.map(key => ({
            key,
            label: CURSOR_STATE_LABELS[key],
            isDefault: key === "default",
            ...states[key]
        }));
        return {
            states: statesArray,
            defaultCursorPath: DEFAULT_CURSOR_PATH
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;

        // Tab switching
        html.querySelectorAll('.ttb-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const tab = btn.dataset.tab;
                html.querySelectorAll('.ttb-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
                html.querySelectorAll('.ttb-tab-content').forEach(c => c.classList.toggle('active', c.dataset.tab === tab));
            });
        });

        // Per-state controls
        CURSOR_STATE_KEYS.forEach(stateKey => {
            const section = html.querySelector(`.ttb-tab-content[data-tab="${stateKey}"]`);
            if (!section) return;

            const imageInput = section.querySelector(`input[name="states.${stateKey}.image"]`);
            const previewImg = section.querySelector('.cursor-preview-img');
            const hotspotDot = section.querySelector('.hotspot-dot');
            const xSlider = section.querySelector(`input[name="states.${stateKey}.hotspotX"]`);
            const ySlider = section.querySelector(`input[name="states.${stateKey}.hotspotY"]`);
            const rotSlider = section.querySelector(`input[name="states.${stateKey}.rotation"]`);
            const xValue = section.querySelector('.hotspot-x-value');
            const yValue = section.querySelector('.hotspot-y-value');
            const rotValue = section.querySelector('.rotation-value');
            const browseBtn = section.querySelector('.ttb-browse-btn');
            const aomBtn = section.querySelector('.ttb-aom-btn');
            const enableCheckbox = section.querySelector(`input[name="states.${stateKey}.enabled"]`);
            const wInput = section.querySelector(`input[name="states.${stateKey}.width"]`);
            const hInput = section.querySelector(`input[name="states.${stateKey}.height"]`);
            const ratioBtn = section.querySelector('.ttb-ratio-btn');

            // Ratio lock state (per-tab, not persisted)
            let ratioLocked = false;
            let lockedRatio = 1; // width / height

            const updatePreview = () => {
                if (!xSlider || !ySlider) return;
                const x = parseInt(xSlider.value);
                const y = parseInt(ySlider.value);
                const rot = rotSlider ? parseInt(rotSlider.value) : 0;
                if (xValue) xValue.textContent = x;
                if (yValue) yValue.textContent = y;
                if (rotValue) rotValue.textContent = rot;

                // Apply size to preview image
                if (previewImg) {
                    const w = parseInt(wInput?.value) || 0;
                    const h = parseInt(hInput?.value) || 0;
                    previewImg.style.width = w > 0 ? `${w}px` : '';
                    previewImg.style.height = h > 0 ? `${h}px` : '';
                }

                // Apply rotation to preview image
                if (previewImg) {
                    previewImg.style.transform = rot ? `rotate(${rot}deg)` : '';
                }

                // Position the hotspot dot accounting for rotation
                if (hotspotDot && previewImg) {
                    // Use displayed size (after resize) for hotspot dot placement
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
            };

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

            const updateImage = (path) => {
                if (imageInput) imageInput.value = path;
                if (previewImg) {
                    previewImg.src = path || '';
                    previewImg.style.display = path ? 'block' : 'none';
                }
                // Validate dimensions
                if (path) {
                    const img = new Image();
                    img.onload = () => {
                        if (img.width > 128 || img.height > 128) {
                            ui.notifications.warn(`Cursor image is ${img.width}x${img.height}px. Browser cursors should be 128x128 or smaller for best results.`);
                        }
                    };
                    img.src = path;
                }
            };

            if (xSlider) xSlider.addEventListener('input', updatePreview);
            if (ySlider) ySlider.addEventListener('input', updatePreview);
            if (rotSlider) rotSlider.addEventListener('input', updatePreview);

            // Browse button - open FilePicker
            if (browseBtn) {
                browseBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const FP = foundry.applications.apps?.FilePicker?.implementation ?? FilePicker;
                    const fp = new FP({
                        type: "image",
                        current: imageInput?.value || "",
                        callback: (path) => {
                            debugLog("config", `FilePicker callback: selected path="${path}"`);
                            updateImage(path);
                        }
                    });
                    fp.browse();
                });
            }

            // Use AoM Default button
            if (aomBtn) {
                aomBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    updateImage(DEFAULT_CURSOR_PATH);
                    if (xSlider) { xSlider.value = DEFAULT_HOTSPOT.x; }
                    if (ySlider) { ySlider.value = DEFAULT_HOTSPOT.y; }
                    if (rotSlider) { rotSlider.value = 0; }
                    if (wInput) { wInput.value = ''; }
                    if (hInput) { hInput.value = ''; }
                    updatePreview();
                });
            }

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

        // Reset all button
        const resetBtn = html.querySelector('button[name="reset"]');
        if (resetBtn) {
            resetBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const defaults = getDefaultCursorStates();
                CURSOR_STATE_KEYS.forEach(key => {
                    const section = html.querySelector(`.ttb-tab-content[data-tab="${key}"]`);
                    if (!section) return;
                    const state = defaults[key];
                    const img = section.querySelector(`input[name="states.${key}.image"]`);
                    const xS = section.querySelector(`input[name="states.${key}.hotspotX"]`);
                    const yS = section.querySelector(`input[name="states.${key}.hotspotY"]`);
                    const rS = section.querySelector(`input[name="states.${key}.rotation"]`);
                    const wS = section.querySelector(`input[name="states.${key}.width"]`);
                    const hS = section.querySelector(`input[name="states.${key}.height"]`);
                    const en = section.querySelector(`input[name="states.${key}.enabled"]`);
                    const preview = section.querySelector('.cursor-preview-img');

                    if (img) img.value = state.image;
                    if (xS) xS.value = state.hotspotX;
                    if (yS) yS.value = state.hotspotY;
                    if (rS) rS.value = state.rotation || 0;
                    if (wS) wS.value = state.width || '';
                    if (hS) hS.value = state.height || '';
                    if (en) { en.checked = state.enabled; en.dispatchEvent(new Event('change')); }
                    if (preview) {
                        preview.src = state.image || '';
                        preview.style.display = state.image ? 'block' : 'none';
                        preview.style.width = '';
                        preview.style.height = '';
                    }
                });
                // Trigger preview updates
                CURSOR_STATE_KEYS.forEach(key => {
                    const section = html.querySelector(`.ttb-tab-content[data-tab="${key}"]`);
                    const xS = section?.querySelector(`input[name="states.${key}.hotspotX"]`);
                    if (xS) xS.dispatchEvent(new Event('input'));
                });
                ui.notifications.info("Reset to defaults.");
            });
        }
    }

    static async #onSubmit(event, form, formData) {
        const FDE = foundry.applications.ux?.FormDataExtended ?? FormDataExtended;
        const data = new FDE(form).object;
        debugLog("config", "onSubmit: raw FormDataExtended:", JSON.stringify(data, null, 2));

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

        debugLog("config", "onSubmit: saving cursor-states:", JSON.stringify(states, null, 2));
        await game.settings.set(MODULE_ID, "cursor-states", states);

        const saved = game.settings.get(MODULE_ID, "cursor-states");
        debugLog("config", "onSubmit: verified saved settings:", JSON.stringify(saved, null, 2));

        const isEnabled = game.settings.get(MODULE_ID, "use-custom-cursor");
        debugLog("config", "onSubmit: use-custom-cursor =", isEnabled);
        if (isEnabled) {
            await applyCursorStyles(true);
        }

        refreshSharedCursorImage();
        ui.notifications.info("Cursor configuration saved!");
    }
}
