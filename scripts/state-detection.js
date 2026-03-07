import { MODULE_ID, debugLog } from './constants.js';

let _stateListenersActive = false;
let _panningHandler = null;
let _panningUpHandler = null;
let _uiHoverHandler = null;

function _logCursorState() {
    const board = document.getElementById("board");
    const boardClasses = board?.classList;
    const bodyClasses = document.body.classList;

    // Priority order matches CSS specificity: panning > targeting > hover > default
    let activeState = "default";
    if (boardClasses?.contains("ttb-cursor-panning")) activeState = "panning";
    else if (boardClasses?.contains("ttb-cursor-targeting")) activeState = "targeting";
    else if (boardClasses?.contains("ttb-cursor-hover") || bodyClasses?.contains("ttb-cursor-hover")) activeState = "hover";

    try {
        const states = game.settings.get(MODULE_ID, "cursor-states");
        const stateConfig = states[activeState];
        const cursor = stateConfig?.enabled !== false ? (stateConfig?.image || "none") : `${activeState} disabled → default: ${states.default?.image || "none"}`;
        debugLog("states", `[CURSOR STATE] active="${activeState}" | cursor="${cursor}"`);
    } catch {
        debugLog("states", `[CURSOR STATE] active="${activeState}" | (settings not ready)`);
    }
}

function _onHoverToken(_token, isHovering) {
    debugLog("states", `hoverToken fired: isHovering=${isHovering}, token="${_token?.name || 'unknown'}", board classList before:`, document.getElementById("board")?.classList.toString());
    document.getElementById("board")?.classList.toggle("ttb-cursor-hover", isHovering);
    debugLog("states", `hoverToken: board classList after:`, document.getElementById("board")?.classList.toString());
    _logCursorState();
}

function _onRenderSceneControls() {
    const isTargeting = ui.controls?.tool === "target";
    debugLog("states", `renderSceneControls fired: activeTool="${ui.controls?.tool}", isTargeting=${isTargeting}`);
    document.getElementById("board")?.classList.toggle("ttb-cursor-targeting", isTargeting);
    _logCursorState();
}

export function setupCursorStateListeners() {
    if (_stateListenersActive) return;
    _stateListenersActive = true;
    debugLog("states", "setupCursorStateListeners: registering state detection hooks");

    Hooks.on("hoverToken", _onHoverToken);
    Hooks.on("renderSceneControls", _onRenderSceneControls);

    // UI hover: detect interactive elements (buttons, links, etc.) outside the canvas
    _uiHoverHandler = (e) => {
        const isPointer = window.getComputedStyle(e.target).cursor === 'pointer';
        const wasHover = document.body.classList.contains('ttb-cursor-hover');
        if (isPointer === wasHover) return;
        document.body.classList.toggle('ttb-cursor-hover', isPointer);
        debugLog("states", `uiHover: element="${e.target.tagName}", isPointer=${isPointer}`);
        _logCursorState();
    };
    document.addEventListener('mouseover', _uiHoverHandler);

    const stage = canvas?.app?.stage;
    if (stage) {
        _panningHandler = (event) => {
            if (event.originalEvent.button === 2) {
                debugLog("states", "panning: RIGHT-CLICK DOWN — adding ttb-cursor-panning class");
                document.getElementById("board")?.classList.add("ttb-cursor-panning");
                _logCursorState();
            }
        };
        _panningUpHandler = () => {
            debugLog("states", "panning: POINTER UP — removing ttb-cursor-panning class");
            document.getElementById("board")?.classList.remove("ttb-cursor-panning");
            _logCursorState();
        };

        stage.on("pointerdown", _panningHandler);
        stage.on("pointerup", _panningUpHandler);
        stage.on("pointerupoutside", _panningUpHandler);
        debugLog("states", "setupCursorStateListeners: panning listeners attached to canvas stage");
    } else {
        debugLog("states", "setupCursorStateListeners: WARNING — canvas stage not available, panning listeners NOT attached");
    }
}

export function cleanupCursorStateListeners() {
    if (!_stateListenersActive) return;
    _stateListenersActive = false;

    Hooks.off("hoverToken", _onHoverToken);
    Hooks.off("renderSceneControls", _onRenderSceneControls);

    const stage = canvas?.app?.stage;
    if (stage && _panningHandler) {
        stage.off("pointerdown", _panningHandler);
        stage.off("pointerup", _panningUpHandler);
        stage.off("pointerupoutside", _panningUpHandler);
    }

    const board = document.getElementById("board");
    if (board) {
        board.classList.remove("ttb-cursor-hover", "ttb-cursor-targeting", "ttb-cursor-panning");
    }

    if (_uiHoverHandler) {
        document.removeEventListener('mouseover', _uiHoverHandler);
        _uiHoverHandler = null;
        document.body.classList.remove('ttb-cursor-hover');
    }
}
