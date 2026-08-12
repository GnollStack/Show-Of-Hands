import assert from 'node:assert/strict';
import { test } from 'node:test';

class TestApplicationV2 {
    constructor() {
        this.renderCalls = [];
        this.closeCalls = [];
    }

    _onRender() {}

    render(options) {
        this.renderCalls.push(options);
        return this;
    }

    async close(options) {
        this.closeCalls.push(options);
    }
}

const dialogState = {
    calls: [],
    result: false
};

globalThis.foundry = {
    applications: {
        api: {
            ApplicationV2: TestApplicationV2,
            HandlebarsApplicationMixin: Base => Base,
            DialogV2: {
                async confirm(options) {
                    dialogState.calls.push(options);
                    return dialogState.result;
                }
            }
        },
        apps: {},
        ux: {}
    },
    utils: {
        deepClone: value => structuredClone(value),
        escapeHTML: value => String(value),
        mergeObject: (base, update) => Object.assign(structuredClone(base), structuredClone(update))
    }
};

const { CursorConfigApp, computeRatioLockedDimensions, getCursorAspectRatio } = await import('../scripts/cursor-config-app.js');
const { AdvancedSettingsApp } = await import('../scripts/advanced-settings-app.js');
const { CURSOR_STATE_KEYS } = await import('../scripts/constants.js');
const { getDefaultUserCursorConfig } = await import('../scripts/settings.js');

function makeListenerTarget(initial = {}) {
    const listeners = new Map();
    const listenerOptions = new Map();
    return {
        ...initial,
        listeners,
        listenerOptions,
        addEventListener(type, handler, options) {
            listeners.set(type, handler);
            listenerOptions.set(type, options);
        }
    };
}

test('ratio-locked cursor dimensions remain valid and preserve the ratio when representable', () => {
    assert.deepEqual(
        computeRatioLockedDimensions({ driver: 'width', value: 100, ratio: 2 }),
        { width: 100, height: 50 }
    );
    assert.deepEqual(
        computeRatioLockedDimensions({ driver: 'width', value: 128, ratio: 0.5 }),
        { width: 64, height: 128 }
    );
    assert.deepEqual(
        computeRatioLockedDimensions({ driver: 'height', value: 100, ratio: 2 }),
        { width: 128, height: 64 }
    );

    const extreme = computeRatioLockedDimensions({ driver: 'height', value: 128, ratio: 1000 });
    assert.deepEqual(extreme, { width: 128, height: 1 });
    assert.ok(extreme.width >= 1 && extreme.width <= 128);
    assert.ok(extreme.height >= 1 && extreme.height <= 128);

    const invalidLowInput = computeRatioLockedDimensions({ driver: 'width', value: -5, ratio: 2 });
    assert.ok(invalidLowInput.width >= 1 && invalidLowInput.width <= 128);
    assert.ok(invalidLowInput.height >= 1 && invalidLowInput.height <= 128);
});

test('aspect-ratio locking follows the rendered geometry when one dimension is blank', () => {
    assert.equal(
        getCursorAspectRatio({ width: 100, height: '', naturalWidth: 32, naturalHeight: 64 }),
        0.5
    );
    assert.equal(
        getCursorAspectRatio({ width: '', height: 100, naturalWidth: 32, naturalHeight: 64 }),
        0.5
    );
    assert.equal(
        getCursorAspectRatio({ width: 100, height: 40, naturalWidth: 32, naturalHeight: 64 }),
        2.5
    );
    assert.equal(getCursorAspectRatio({ width: 100, height: '' }), 1);
});

test('GM target switching prompts before discarding dirty cursor form state', async () => {
    const users = new Map([
        ['gm', { id: 'gm', name: 'Gamemaster', isGM: true }],
        ['player', { id: 'player', name: 'Player' }]
    ]);
    globalThis.game = {
        user: users.get('gm'),
        users
    };

    const userSelect = makeListenerTarget({
        value: 'gm',
        name: 'targetUserId',
        disabled: false
    });
    const form = makeListenerTarget({
        querySelector(selector) {
            if (selector === '.ttb-user-select') return userSelect;
            return null;
        }
    });
    const app = new CursorConfigApp({ targetUserId: 'gm' });
    app.element = form;
    app._onRender({}, {});

    form.listeners.get('input')({ target: { name: 'states.default.image' } });
    userSelect.value = 'player';
    dialogState.calls.length = 0;
    dialogState.result = false;
    await userSelect.listeners.get('change')({ preventDefault() {} });

    assert.equal(dialogState.calls.length, 1);
    assert.equal(dialogState.calls[0].yes.label, 'Discard & Switch');
    assert.equal(userSelect.value, 'gm');
    assert.equal(app.targetUserId, 'gm');
    assert.equal(app.renderCalls.length, 0);

    userSelect.value = 'player';
    dialogState.result = true;
    await userSelect.listeners.get('change')({ preventDefault() {} });

    assert.equal(app.targetUserId, 'player');
    assert.deepEqual(app.renderCalls, [{ force: true }]);
});

test('cursor form rerenders abort the previous delegated dirty listeners', () => {
    const users = new Map([
        ['gm', { id: 'gm', name: 'Gamemaster', isGM: true }]
    ]);
    globalThis.game = { user: users.get('gm'), users };

    const userSelect = makeListenerTarget({ value: 'gm', name: 'targetUserId' });
    const form = makeListenerTarget({
        querySelector(selector) {
            if (selector === '.ttb-user-select') return userSelect;
            return null;
        }
    });
    const app = new CursorConfigApp({ targetUserId: 'gm' });
    app.element = form;

    app._onRender({}, {});
    const firstSignal = form.listenerOptions.get('input')?.signal;
    assert.ok(firstSignal);
    assert.equal(firstSignal.aborted, false);

    app._onRender({}, {});
    const secondSignal = form.listenerOptions.get('input')?.signal;
    assert.equal(firstSignal.aborted, true);
    assert.notEqual(secondSignal, firstSignal);
    assert.equal(secondSignal.aborted, false);
});

test('detached-window moves preserve dirty state and existing form listeners', () => {
    const users = new Map([
        ['gm', { id: 'gm', name: 'Gamemaster', isGM: true }]
    ]);
    globalThis.game = { user: users.get('gm'), users };

    const userSelect = makeListenerTarget({ value: 'gm', name: 'targetUserId' });
    let addCount = 0;
    const form = makeListenerTarget({
        querySelector(selector) {
            if (selector === '.ttb-user-select') return userSelect;
            return null;
        }
    });
    const addEventListener = form.addEventListener.bind(form);
    form.addEventListener = (...args) => {
        addCount += 1;
        addEventListener(...args);
    };

    const app = new CursorConfigApp({ targetUserId: 'gm' });
    app.element = form;
    app._onRender({}, {});
    form.listeners.get('input')({ target: { name: 'states.default.image' } });
    const initialAddCount = addCount;

    app._onRender({}, { window: { detached: true } });
    assert.equal(app._formDirty, true);
    assert.equal(addCount, initialAddCount);

    app._onRender({}, { window: { detached: false } });
    assert.equal(app._formDirty, true);
    assert.equal(addCount, initialAddCount);
});

test('cursor profile persistence failures do not close the form', async () => {
    const saveError = new Error('flag write failed');
    const gm = {
        id: 'gm',
        name: 'Gamemaster',
        isGM: true,
        async setFlag() { throw saveError; }
    };
    globalThis.game = { user: gm, users: new Map([[gm.id, gm]]) };
    globalThis.ui = { notifications: { error() {}, info() {} } };

    const data = {
        targetUserId: gm.id,
        useCustomCursor: true,
        namePosition: 'bottom-center',
        nameOffsetX: 0,
        nameOffsetY: 1.2
    };
    const previousWarn = console.warn;
    console.warn = () => {};
    try {
        const app = new CursorConfigApp({ targetUserId: gm.id });
        await CursorConfigApp.DEFAULT_OPTIONS.form.handler.call(
            app,
            {},
            {},
            { object: data }
        );
        assert.equal(CursorConfigApp.DEFAULT_OPTIONS.form.closeOnSubmit, false);
        assert.deepEqual(app.closeCalls, []);
    } finally {
        console.warn = previousWarn;
    }
});

test('Reset All restores every editable cursor profile field', () => {
    const defaults = getDefaultUserCursorConfig();
    const hiddenFields = {
        namePosition: { value: 'custom' },
        nameOffsetX: { value: '9' },
        nameOffsetY: { value: '-4' }
    };
    const previewContainer = {
        querySelector(selector) {
            if (selector === 'input[name="namePosition"]') return hiddenFields.namePosition;
            if (selector === 'input[name="nameOffsetX"]') return hiddenFields.nameOffsetX;
            if (selector === 'input[name="nameOffsetY"]') return hiddenFields.nameOffsetY;
            return null;
        },
        querySelectorAll() {
            return [];
        }
    };
    const sections = new Map();

    for (const key of CURSOR_STATE_KEYS) {
        const controls = {
            image: { value: 'custom.webp' },
            hotspotX: { value: '40', max: '65535' },
            hotspotY: { value: '50', max: '65535' },
            rotation: { value: '270' },
            width: { value: '80' },
            height: { value: '90' },
            enabled: { checked: true, dispatchEvent() {} }
        };
        const wrapper = { style: {}, offsetWidth: 16, offsetHeight: 16 };
        const preview = {
            complete: false,
            naturalWidth: 0,
            naturalHeight: 0,
            src: 'custom.webp',
            style: {},
            offsetWidth: 16,
            offsetHeight: 16,
            closest: selector => selector === '.ttb-preview-wrapper' ? wrapper : null
        };
        const section = {
            dataset: { tab: key },
            controls,
            querySelector(selector) {
                const fieldMatch = selector.match(/^input\[name="states\.[^.]+\.([^"]+)"\]$/);
                if (fieldMatch) return controls[fieldMatch[1]] ?? null;
                if (selector === '.ttb-preview-img') return preview;
                if (selector === '.ttb-preview-wrapper') return wrapper;
                if (selector === '.ttb-preview-container' && key === 'default') return previewContainer;
                return null;
            }
        };
        sections.set(key, section);
    }

    const useCustomCursor = { checked: false };
    const app = new CursorConfigApp({ targetUserId: 'gm' });
    app.element = {
        querySelector(selector) {
            if (selector === 'input[name="useCustomCursor"]') return useCustomCursor;
            const tabMatch = selector.match(/^\.ttb-tab-content\[data-tab="([^"]+)"\]$/);
            return tabMatch ? sections.get(tabMatch[1]) ?? null : null;
        }
    };
    globalThis.ui = { notifications: { info() {} } };
    globalThis.requestAnimationFrame = callback => callback();

    CursorConfigApp.DEFAULT_OPTIONS.actions.resetAll.call(app, { preventDefault() {} });

    assert.equal(useCustomCursor.checked, defaults.useCustomCursor);
    assert.equal(hiddenFields.namePosition.value, defaults.namePosition);
    assert.equal(hiddenFields.nameOffsetX.value, defaults.nameOffset.x);
    assert.equal(hiddenFields.nameOffsetY.value, defaults.nameOffset.y);
    assert.equal(app._formDirty, true);
    for (const key of CURSOR_STATE_KEYS) {
        const { controls } = sections.get(key);
        const expected = defaults.cursorStates[key];
        assert.equal(controls.image.value, expected.image, `${key} image`);
        assert.equal(Number(controls.hotspotX.value), expected.hotspotX, `${key} hotspotX`);
        assert.equal(Number(controls.hotspotY.value), expected.hotspotY, `${key} hotspotY`);
        assert.equal(Number(controls.rotation.value), expected.rotation, `${key} rotation`);
        assert.equal(controls.width.value, expected.width || '', `${key} width`);
        assert.equal(controls.height.value, expected.height || '', `${key} height`);
        assert.equal(controls.enabled.checked, expected.enabled, `${key} enabled`);
    }
});

test('Advanced Settings updates the opacity readout while its slider moves', () => {
    let addCount = 0;
    const slider = makeListenerTarget({ value: '0.55' });
    const addEventListener = slider.addEventListener.bind(slider);
    slider.addEventListener = (...args) => {
        addCount += 1;
        addEventListener(...args);
    };
    const output = { textContent: '' };
    const app = new AdvancedSettingsApp();
    app.element = {
        querySelector(selector) {
            if (selector === '#ttb-shared-cursor-opacity') return slider;
            if (selector === '.ttb-shared-cursor-opacity-value') return output;
            return null;
        }
    };

    app._onRender({}, {});
    assert.equal(output.textContent, '0.55');

    slider.value = '0.8';
    slider.listeners.get('input')();
    assert.equal(output.textContent, '0.8');

    app._onRender({}, { window: { detached: true } });
    app._onRender({}, { window: { detached: false } });
    assert.equal(addCount, 1, 'moving the existing detached DOM must not duplicate the listener');
});
