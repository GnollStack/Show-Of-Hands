import { MODULE_ID, DEFAULT_CURSOR_PATH, DEFAULT_HOTSPOT, CURSOR_STATE_KEYS, CURSOR_STATE_DETAILS, NAME_POSITION_PRESETS, debugLog } from './constants.js';
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
            width: 760,
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
        const namePosition = game.settings.get(MODULE_ID, "cursor-name-position");
        const nameOffset = game.settings.get(MODULE_ID, "cursor-name-offset");
        return {
            states: statesArray,
            defaultCursorPath: DEFAULT_CURSOR_PATH,
            cursorImage: states.default?.image || DEFAULT_CURSOR_PATH,
            playerName: game.user.name,
            namePosition,
            nameOffsetX: nameOffset?.x ?? 0,
            nameOffsetY: nameOffset?.y ?? 1.2
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
            const previewImg = section.querySelector('.ttb-preview-img');
            const hotspotDot = section.querySelector('.ttb-hotspot-dot');
            const xSlider = section.querySelector(`input[name="states.${stateKey}.hotspotX"]`);
            const ySlider = section.querySelector(`input[name="states.${stateKey}.hotspotY"]`);
            const rotSlider = section.querySelector(`input[name="states.${stateKey}.rotation"]`);
            const xValue = section.querySelector('.ttb-hotspot-x-value');
            const yValue = section.querySelector('.ttb-hotspot-y-value');
            const rotValue = section.querySelector('.ttb-rotation-value');
            const browseBtn = section.querySelector('.ttb-browse-btn');
            const aomBtn = section.querySelector('.ttb-aom-btn');
            const clearBtn = section.querySelector('.ttb-clear-btn');
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
                const trimmedPath = path?.trim?.() ?? path ?? "";
                if (imageInput) imageInput.value = trimmedPath;
                if (previewImg) {
                    previewImg.src = trimmedPath || '';
                    previewImg.style.display = trimmedPath ? 'block' : 'none';
                }
                // Validate dimensions
                if (trimmedPath) {
                    const img = new Image();
                    img.onload = () => {
                        if (img.width > 128 || img.height > 128) {
                            ui.notifications.warn(`Cursor image is ${img.width}x${img.height}px. Browser cursors should be 128x128 or smaller for best results.`);
                        }
                    };
                    img.onerror = () => {
                        debugLog("config", `Failed to load cursor image for validation: ${trimmedPath}`);
                    };
                    img.src = trimmedPath;
                }
            };

            if (imageInput) {
                imageInput.addEventListener('change', () => updateImage(imageInput.value));
            }
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

            if (clearBtn) {
                clearBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    updateImage("");
                    if (xSlider) { xSlider.value = 0; }
                    if (ySlider) { ySlider.value = 0; }
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
                    const preview = section.querySelector('.ttb-preview-img');

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

        // --- Name Label Position (inside Default tab's preview) ---
        const defaultSection = html.querySelector('.ttb-tab-content[data-tab="default"]');
        const dragLabel = defaultSection?.querySelector('.ttb-name-drag-label');
        if (defaultSection && dragLabel) {
            const previewWrapper = defaultSection.querySelector('.ttb-preview-wrapper');
            const previewContainer = defaultSection.querySelector('.ttb-preview-container');
            const presetBtns = previewContainer.querySelectorAll('.ttb-name-preset');
            const hiddenX = previewContainer.querySelector('input[name="nameOffsetX"]');
            const hiddenY = previewContainer.querySelector('input[name="nameOffsetY"]');
            const hiddenPos = previewContainer.querySelector('input[name="namePosition"]');
            const previewImg = defaultSection.querySelector('.ttb-preview-img');

            // Position the label relative to the cursor image center in the preview
            const positionLabel = (positionName, offsetX, offsetY) => {
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
            };

            const setActivePreset = (presetName) => {
                presetBtns.forEach(b => b.classList.toggle('active', b.dataset.preset === presetName));
            };

            const applyPreset = (presetName) => {
                const preset = NAME_POSITION_PRESETS[presetName];
                if (!preset) return;
                hiddenPos.value = presetName;
                hiddenX.value = preset.offsetX;
                hiddenY.value = preset.offsetY;
                setActivePreset(presetName);
                positionLabel(presetName, preset.offsetX, preset.offsetY);
            };

            // Init from current values
            setActivePreset(hiddenPos.value);
            requestAnimationFrame(() => {
                positionLabel(hiddenPos.value, parseFloat(hiddenX.value), parseFloat(hiddenY.value));
            });

            // Preset buttons
            presetBtns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    applyPreset(btn.dataset.preset);
                });
            });

            // Drag logic
            let dragging = false;
            let dragStartX = 0, dragStartY = 0, labelStartX = 0, labelStartY = 0;

            dragLabel.addEventListener('mousedown', (e) => {
                e.preventDefault();
                dragging = true;
                dragStartX = e.clientX;
                dragStartY = e.clientY;
                labelStartX = dragLabel.offsetLeft;
                labelStartY = dragLabel.offsetTop;
            });

            // Clean up previous document listeners if _onRender is called again
            this._cleanupDragListeners();

            this._boundDocMouseMove = (e) => {
                if (!dragging) return;
                const dx = e.clientX - dragStartX;
                const dy = e.clientY - dragStartY;
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
                setActivePreset("custom");
            };

            this._boundDocMouseUp = () => {
                dragging = false;
            };

            document.addEventListener('mousemove', this._boundDocMouseMove);
            document.addEventListener('mouseup', this._boundDocMouseUp);

            // Re-position label when image size/rotation changes
            const reposOnChange = () => {
                requestAnimationFrame(() => {
                    positionLabel(hiddenPos.value, parseFloat(hiddenX.value), parseFloat(hiddenY.value));
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
        if (this._boundDocMouseMove) {
            document.removeEventListener('mousemove', this._boundDocMouseMove);
            this._boundDocMouseMove = null;
        }
        if (this._boundDocMouseUp) {
            document.removeEventListener('mouseup', this._boundDocMouseUp);
            this._boundDocMouseUp = null;
        }
    }

    _onClose(options) {
        this._cleanupDragListeners();
        super._onClose(options);
    }

    static async #onSubmit(event, form, formData) {
        const FDE = foundry.applications.ux?.FormDataExtended ?? FormDataExtended;
        const data = new FDE(form).object;
        debugLog("config", "onSubmit: raw FormDataExtended:", JSON.stringify(data, null, 2));
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

        debugLog("config", "onSubmit: saving cursor-states:", JSON.stringify(states, null, 2));
        await game.settings.set(MODULE_ID, "cursor-states", states);

        const saved = game.settings.get(MODULE_ID, "cursor-states");
        debugLog("config", "onSubmit: verified saved settings:", JSON.stringify(saved, null, 2));

        const isEnabled = game.settings.get(MODULE_ID, "use-custom-cursor");
        debugLog("config", "onSubmit: use-custom-cursor =", isEnabled);
        if (isEnabled) {
            await applyCursorStyles(true);
        }

        // Save name label position
        const namePos = data.namePosition || "bottom-center";
        const nameOffsetX = parseNumber(data.nameOffsetX, 0);
        const nameOffsetY = parseNumber(data.nameOffsetY, 1.2);
        await game.settings.set(MODULE_ID, "cursor-name-position", namePos);
        await game.settings.set(MODULE_ID, "cursor-name-offset", { x: nameOffsetX, y: nameOffsetY });

        refreshSharedCursorImage();
        ui.notifications.info("Cursor configuration saved!");
    }
}
