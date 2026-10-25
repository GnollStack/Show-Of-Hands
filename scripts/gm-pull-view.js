/** Camera geometry shared by GM pull pings and their receivers. */
export function isPositiveFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function isValidViewSize(view) {
    return !!view && isPositiveFiniteNumber(view.width) && isPositiveFiniteNumber(view.height);
}

export function getCanvasViewport(canvasRef = globalThis.canvas) {
    // Renderer screen dimensions are logical/CSS pixels, not the backing
    // framebuffer dimensions, so device pixel ratio must not be applied here.
    const screen = canvasRef?.app?.renderer?.screen;
    if (isValidViewSize(screen)) return { width: screen.width, height: screen.height };
    const [width, height] = canvasRef?.screenDimensions ?? [];
    return isValidViewSize({ width, height }) ? { width, height } : null;
}

export function captureGmView(canvasRef = globalThis.canvas) {
    if (!canvasRef?.ready) return null;
    const viewport = getCanvasViewport(canvasRef);
    const zoom = canvasRef?.stage?.scale?.x;
    if (!viewport || !isPositiveFiniteNumber(zoom)) return null;
    const view = { width: viewport.width / zoom, height: viewport.height / zoom };
    return isValidViewSize(view) ? view : null;
}

export function computeFitZoom(view, viewport) {
    if (!isValidViewSize(view) || !isValidViewSize(viewport)) return null;
    const zoom = Math.min(viewport.width / view.width, viewport.height / view.height);
    return isPositiveFiniteNumber(zoom) ? zoom : null;
}

export function clampCanvasZoom(zoom, canvasRef = globalThis.canvas, canvasConfig = globalThis.CONFIG?.Canvas) {
    const current = canvasRef?.stage?.scale?.x;
    const requested = isPositiveFiniteNumber(zoom) ? zoom : (isPositiveFiniteNumber(current) ? current : 1);
    const limits = canvasRef?.ready ? canvasRef.dimensions?.scale : null;
    const min = isPositiveFiniteNumber(limits?.min) ? limits.min
        : (isPositiveFiniteNumber(canvasConfig?.minZoom) ? canvasConfig.minZoom : Number.MIN_VALUE);
    const max = isPositiveFiniteNumber(limits?.max) ? limits.max
        : (isPositiveFiniteNumber(canvasConfig?.maxZoom) ? canvasConfig.maxZoom : Number.MAX_VALUE);
    // Foundry still applies its own final constraints through handlePing.
    return Math.min(Math.max(min, max), Math.max(min, requested));
}

export function resolveGmPullZoom(mode, view, canvasRef = globalThis.canvas, canvasConfig = globalThis.CONFIG?.Canvas) {
    if (!canvasRef?.ready) return null;
    const zoom = mode === 'keep' ? canvasRef.stage?.scale?.x
        : (mode === 'fit' ? computeFitZoom(view, getCanvasViewport(canvasRef)) : null);
    return isPositiveFiniteNumber(zoom) ? clampCanvasZoom(zoom, canvasRef, canvasConfig) : null;
}
