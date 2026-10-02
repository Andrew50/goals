import {
    DRAG_SCROLL_MAX_SPEED,
    DRAG_SCROLL_MIN_SPEED,
    applyDragAutoScroll,
    attachDragAutoScroll,
    dragScrollDelta,
} from './dragAutoScroll';

function dragEvent(type: string, clientX: number, clientY: number): Event {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, 'clientX', { value: clientX });
    Object.defineProperty(event, 'clientY', { value: clientY });
    return event;
}

function rect(top: number, bottom: number, left = 0, right = 300) {
    return { top, bottom, left, right };
}

function mockScroller(
    metrics: {
        top: number;
        bottom: number;
        left?: number;
        right?: number;
        scrollHeight: number;
        clientHeight: number;
        scrollTop?: number;
    },
    parent?: HTMLElement,
): HTMLElement {
    const el = document.createElement('div');
    el.style.overflowY = 'auto';
    (parent ?? document.body).appendChild(el);

    const left = metrics.left ?? 0;
    const right = metrics.right ?? 300;
    const maxScroll = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
    let scrollTop = metrics.scrollTop ?? 0;

    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => metrics.scrollHeight });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => metrics.clientHeight });
    Object.defineProperty(el, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
            scrollTop = Math.min(maxScroll, Math.max(0, value));
        },
    });
    el.getBoundingClientRect = () => ({
        top: metrics.top,
        bottom: metrics.bottom,
        left,
        right,
        width: right - left,
        height: metrics.bottom - metrics.top,
        x: left,
        y: metrics.top,
        toJSON: () => ({}),
    });

    return el;
}

describe('dragScrollDelta', () => {
    const list = rect(100, 500);

    test('does not scroll in the middle of the list', () => {
        expect(dragScrollDelta(40, 300, list)).toBe(0);
    });

    test('does not scroll when the pointer is outside the list horizontally', () => {
        expect(dragScrollDelta(400, 110, list)).toBe(0);
    });

    test('scrolls up near the top edge and down near the bottom edge', () => {
        expect(dragScrollDelta(40, 110, list)).toBeLessThan(0);
        expect(dragScrollDelta(40, 490, list)).toBeGreaterThan(0);
    });

    test('scrolls faster closer to the outer edge', () => {
        const nearOuter = Math.abs(dragScrollDelta(40, 100, list));
        const nearInner = Math.abs(dragScrollDelta(40, 170, list));
        expect(nearOuter).toBe(DRAG_SCROLL_MAX_SPEED);
        expect(nearInner).toBeGreaterThanOrEqual(DRAG_SCROLL_MIN_SPEED);
        expect(nearOuter).toBeGreaterThan(nearInner);
    });

    test('keeps scrolling when the pointer is held just outside the list', () => {
        expect(dragScrollDelta(40, 90, list)).toBe(-DRAG_SCROLL_MAX_SPEED);
        expect(dragScrollDelta(40, 510, list)).toBe(DRAG_SCROLL_MAX_SPEED);
    });

    test('stops when the pointer is far outside the list', () => {
        expect(dragScrollDelta(40, 0, list)).toBe(0);
        expect(dragScrollDelta(40, 700, list)).toBe(0);
    });
});

describe('applyDragAutoScroll', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('scrolls the event list under the pointer', () => {
        const list = mockScroller({
            top: 100,
            bottom: 500,
            scrollHeight: 2000,
            clientHeight: 400,
            scrollTop: 80,
        });

        expect(applyDragAutoScroll(40, 480, [list])).toBe(true);
        expect(list.scrollTop).toBeGreaterThan(80);
    });

    test('scrolls the page when the event list itself cannot overflow', () => {
        const page = mockScroller({
            top: 0,
            bottom: 700,
            right: 800,
            scrollHeight: 2000,
            clientHeight: 700,
            scrollTop: 40,
        });
        const list = mockScroller({
            top: 120,
            bottom: 700,
            scrollHeight: 580,
            clientHeight: 580,
        }, page);

        expect(applyDragAutoScroll(40, 680, [list])).toBe(true);
        expect(list.scrollTop).toBe(0);
        expect(page.scrollTop).toBeGreaterThan(40);
    });

    test('continues into the parent scroller when the list is already at its end', () => {
        const page = mockScroller({
            top: 0,
            bottom: 700,
            right: 800,
            scrollHeight: 2400,
            clientHeight: 700,
            scrollTop: 20,
        });
        const list = mockScroller({
            top: 80,
            bottom: 700,
            scrollHeight: 2000,
            clientHeight: 620,
            scrollTop: 2000 - 620,
        }, page);

        expect(applyDragAutoScroll(40, 690, [list])).toBe(true);
        expect(list.scrollTop).toBe(2000 - 620);
        expect(page.scrollTop).toBeGreaterThan(20);
    });

    test('leaves the other column alone', () => {
        const todo = mockScroller({
            top: 100,
            bottom: 500,
            left: 0,
            right: 280,
            scrollHeight: 2000,
            clientHeight: 400,
            scrollTop: 50,
        });
        const resolved = mockScroller({
            top: 100,
            bottom: 500,
            left: 320,
            right: 600,
            scrollHeight: 2000,
            clientHeight: 400,
            scrollTop: 50,
        });

        applyDragAutoScroll(40, 120, [todo, resolved]);
        expect(todo.scrollTop).toBeLessThan(50);
        expect(resolved.scrollTop).toBe(50);
    });
});

describe('attachDragAutoScroll', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        document.body.classList.remove('day-drag-autoscroll');
    });

    test('scrolls on dragover and stops after dragend', () => {
        const frames: FrameRequestCallback[] = [];
        const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            frames.push(callback);
            return frames.length;
        });
        const cancel = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

        const list = mockScroller({
            top: 100,
            bottom: 500,
            scrollHeight: 2000,
            clientHeight: 400,
            scrollTop: 100,
        });
        const detach = attachDragAutoScroll(() => [list]);

        document.dispatchEvent(dragEvent('dragover', 30, 470));
        frames.shift()?.(0);

        expect(document.body.classList.contains('day-drag-autoscroll')).toBe(true);
        const whileDragging = list.scrollTop;
        expect(whileDragging).toBeGreaterThan(100);

        document.dispatchEvent(dragEvent('dragend', 30, 470));
        frames.shift()?.(0);

        expect(document.body.classList.contains('day-drag-autoscroll')).toBe(false);
        expect(list.scrollTop).toBe(whileDragging);

        detach();
        raf.mockRestore();
        cancel.mockRestore();
    });
});
