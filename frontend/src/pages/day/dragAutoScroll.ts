export const DRAG_SCROLL_EDGE_PX = 80;
export const DRAG_SCROLL_MIN_SPEED = 4;
export const DRAG_SCROLL_MAX_SPEED = 16;

export interface ScrollRect {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

/**
 * Pixels to add to scrollTop while a drag is held at pointerX/pointerY.
 * Negative scrolls up, positive scrolls down.
 */
export function dragScrollDelta(
    pointerX: number,
    pointerY: number,
    rect: ScrollRect,
    edgePx = DRAG_SCROLL_EDGE_PX,
): number {
    if (rect.bottom - rect.top < 8 || rect.right <= rect.left) return 0;
    if (pointerX < rect.left || pointerX > rect.right) return 0;
    if (pointerY < rect.top - edgePx || pointerY > rect.bottom + edgePx) return 0;

    const distTop = pointerY - rect.top;
    const distBottom = rect.bottom - pointerY;

    if (distTop < edgePx && distTop < distBottom && pointerY <= rect.bottom) {
        return -edgeSpeed(distTop, edgePx);
    }
    if (distBottom < edgePx && distBottom < distTop && pointerY >= rect.top) {
        return edgeSpeed(distBottom, edgePx);
    }
    return 0;
}

function edgeSpeed(distanceFromOuterEdge: number, edgePx: number): number {
    const clamped = Math.min(edgePx, Math.max(0, distanceFromOuterEdge));
    const proximity = (edgePx - clamped) / edgePx;
    return Math.max(
        1,
        Math.round(DRAG_SCROLL_MIN_SPEED + (DRAG_SCROLL_MAX_SPEED - DRAG_SCROLL_MIN_SPEED) * proximity),
    );
}

function canScroll(element: HTMLElement): boolean {
    if (element.scrollHeight <= element.clientHeight + 1) return false;
    if (element === document.scrollingElement) return true;
    const overflowY = window.getComputedStyle(element).overflowY;
    return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
}

/** Visible portion of a scrollport, clipped to the viewport. */
export function visibleScrollRect(element: HTMLElement): ScrollRect | null {
    if (!canScroll(element)) return null;
    const rect = element.getBoundingClientRect();
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, window.innerHeight);
    const left = Math.max(rect.left, 0);
    const right = Math.min(rect.right, window.innerWidth);
    if (bottom - top < 8 || right - left < 8) return null;
    return { top, bottom, left, right };
}

function scrollBy(element: HTMLElement, delta: number): boolean {
    const before = element.scrollTop;
    element.scrollTop = before + delta;
    if (element.scrollTop !== before) return true;

    if (element === document.scrollingElement) {
        const windowBefore = window.scrollY;
        window.scrollBy(0, delta);
        return window.scrollY !== windowBefore;
    }
    return false;
}

/**
 * Scroll the list under the pointer, or the nearest ancestor that can still move.
 * The event list is preferred; the page scroller is used when the list itself
 * is not the overflow container.
 */
export function applyDragAutoScroll(pointerX: number, pointerY: number, roots: Array<HTMLElement | null>): boolean {
    const seen = new Set<HTMLElement>();

    const tryScroll = (element: HTMLElement): boolean => {
        if (seen.has(element)) return false;
        seen.add(element);
        const rect = visibleScrollRect(element);
        if (!rect) return false;
        const delta = dragScrollDelta(pointerX, pointerY, rect);
        if (delta === 0) return false;
        return scrollBy(element, delta);
    };

    for (const root of roots) {
        if (!root) continue;
        const rootRect = root.getBoundingClientRect();
        if (pointerX < rootRect.left || pointerX > rootRect.right) continue;

        let node: HTMLElement | null = root;
        while (node) {
            const rect = node.getBoundingClientRect();
            if (pointerX >= rect.left && pointerX <= rect.right && tryScroll(node)) {
                return true;
            }
            node = node.parentElement;
        }

        const scrollingElement = document.scrollingElement;
        if (scrollingElement instanceof HTMLElement && tryScroll(scrollingElement)) {
            return true;
        }
    }

    return false;
}

/** Follow the pointer during an HTML5 drag and keep scrolling while it stays in an edge zone. */
export function attachDragAutoScroll(getRoots: () => Array<HTMLElement | null>): () => void {
    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;
    let dragging = false;

    const tick = () => {
        if (!dragging) {
            frame = 0;
            return;
        }
        applyDragAutoScroll(pointerX, pointerY, getRoots());
        frame = window.requestAnimationFrame(tick);
    };

    const onDragOver = (event: DragEvent) => {
        if (event.clientX === 0 && event.clientY === 0) return;
        pointerX = event.clientX;
        pointerY = event.clientY;
        dragging = true;
        document.body.classList.add('day-drag-autoscroll');
        if (!frame) frame = window.requestAnimationFrame(tick);
    };

    const stop = () => {
        dragging = false;
        if (frame) window.cancelAnimationFrame(frame);
        frame = 0;
        document.body.classList.remove('day-drag-autoscroll');
    };

    document.addEventListener('dragover', onDragOver, true);
    document.addEventListener('dragend', stop, true);
    document.addEventListener('drop', stop, true);

    return () => {
        stop();
        document.removeEventListener('dragover', onDragOver, true);
        document.removeEventListener('dragend', stop, true);
        document.removeEventListener('drop', stop, true);
    };
}
