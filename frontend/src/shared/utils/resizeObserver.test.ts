import { createResizeObserver } from './resizeObserver';

// Mock ResizeObserver with a callback we can trigger
let resizeCallback: (() => void) | null = null;
const mockObserve = jest.fn((element: Element, options?: ResizeObserverOptions) => {
    // Store callback for testing
});
const mockDisconnect = jest.fn();

beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    resizeCallback = null;
    
    (global.ResizeObserver as any) = jest.fn().mockImplementation((callback: ResizeObserverCallback) => {
        resizeCallback = callback as any;
        return {
            observe: mockObserve,
            disconnect: mockDisconnect,
        };
    });
});

afterEach(() => {
    jest.useRealTimers();
    resizeCallback = null;
});

describe('createResizeObserver', () => {
    test('creates a ResizeObserver wrapper', () => {
        const callback = jest.fn();
        const observer = createResizeObserver(callback);

        expect(observer).toHaveProperty('observe');
        expect(observer).toHaveProperty('disconnect');
    });

    test('observes an element', () => {
        const callback = jest.fn();
        const observer = createResizeObserver(callback);
        const element = document.createElement('div');

        observer.observe(element);

        expect(mockObserve).toHaveBeenCalledWith(element);
    });

    test('debounces callback on resize', () => {
        const callback = jest.fn();
        const observer = createResizeObserver(callback);
        const element = document.createElement('div');

        observer.observe(element);

        // Trigger resize multiple times quickly
        if (resizeCallback) {
            resizeCallback();
            resizeCallback();
            resizeCallback();
        }

        // Callback should not be called yet
        expect(callback).not.toHaveBeenCalled();

        // Fast-forward past debounce delay
        jest.advanceTimersByTime(100);

        // Callback should be called once (debounced)
        expect(callback).toHaveBeenCalledTimes(1);
    });

    test('clears previous timeout on new resize', () => {
        const callback = jest.fn();
        const observer = createResizeObserver(callback);
        const element = document.createElement('div');

        observer.observe(element);
        
        // First resize
        if (resizeCallback) {
            resizeCallback();
        }
        jest.advanceTimersByTime(50);

        // Second resize (should cancel first timeout)
        if (resizeCallback) {
            resizeCallback();
        }
        jest.advanceTimersByTime(100);

        // Should only be called once (second resize)
        expect(callback).toHaveBeenCalledTimes(1);
    });

    test('disconnects observer and clears timeout', () => {
        const callback = jest.fn();
        const observer = createResizeObserver(callback);
        const element = document.createElement('div');

        observer.observe(element);

        if (resizeCallback) {
            resizeCallback();
        }

        observer.disconnect();

        expect(mockDisconnect).toHaveBeenCalled();

        // Fast-forward - callback should not be called after disconnect
        jest.advanceTimersByTime(100);
        expect(callback).not.toHaveBeenCalled();
    });

    test('handles disconnect when no timeout exists', () => {
        const callback = jest.fn();
        const observer = createResizeObserver(callback);
        const element = document.createElement('div');

        observer.observe(element);

        // Disconnect without triggering resize
        expect(() => observer.disconnect()).not.toThrow();
        expect(mockDisconnect).toHaveBeenCalled();
    });
});
