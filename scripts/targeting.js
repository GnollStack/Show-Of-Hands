import { MODULE_ID, debugLog } from './constants.js';

function handlePointerDown(event) {
    if (event.originalEvent.button !== 1) return;
    if (!canvas.tokens.hover) return;

    const targetAction = game.keybindings.actions.get("core.target");
    if (targetAction?.onDown) {
        targetAction.onDown({ isShift: event.originalEvent.shiftKey });
    }
}

export function toggleListener(isEnabled) {
    const stage = canvas?.app?.stage;
    if (!stage) return;

    stage.off('pointerdown', handlePointerDown);
    if (isEnabled) {
        console.log(`${MODULE_ID} | Mousewheel targeting enabled.`);
        stage.on('pointerdown', handlePointerDown);
    } else {
        console.log(`${MODULE_ID} | Mousewheel targeting disabled.`);
    }
}
