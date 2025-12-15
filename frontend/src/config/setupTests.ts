// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Set required environment variables for tests
process.env.REACT_APP_API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8080';

// Axios is ESM as of v1.x, which can break CRA/Jest when importing from node_modules.
// CRA also resets mock implementations between tests, so we implement axios as plain functions
// (not `jest.fn`) to keep required properties stable across tests.
jest.mock('axios', () => {
    const axiosFn: any = async (_config?: any) => ({ data: {} });

    axiosFn.defaults = {
        timeout: 0,
        headers: { common: {} as Record<string, string> },
        withCredentials: false,
    };

    axiosFn.interceptors = {
        response: {
            use: (_onFulfilled: any, _onRejected: any) => {
                // no-op
                return 0;
            },
        },
    };

    axiosFn.create = () => axiosFn;

    // Common helper methods (some callers may use these)
    axiosFn.get = async () => ({ data: {} });
    axiosFn.post = async () => ({ data: {} });
    axiosFn.put = async () => ({ data: {} });
    axiosFn.delete = async () => ({ data: {} });

    return { __esModule: true, default: axiosFn };
});

// Polyfill for structuredClone (not available in Node.js < 17 or Jest environment)
if (typeof global.structuredClone === 'undefined') {
    global.structuredClone = function (obj: any): any {
        // Simple deep clone implementation for testing
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }

        if (obj instanceof Date) {
            return new Date(obj.getTime());
        }

        if (obj instanceof Array) {
            return obj.map(item => global.structuredClone(item));
        }

        if (typeof obj === 'object') {
            const cloned: any = {};
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    cloned[key] = global.structuredClone(obj[key]);
                }
            }
            return cloned;
        }

        return obj;
    };
}

// Mock react-dnd modules
jest.mock('react-dnd', () => {
    return {
        useDrop: jest.fn().mockReturnValue([{}, jest.fn()]),
        useDrag: jest.fn().mockReturnValue([{}, jest.fn()]),
        DndProvider: ({ children }: { children: any }) => children
    };
});

jest.mock('react-dnd-html5-backend', () => ({
    HTML5Backend: {}
}));

// Mock vis-network
jest.mock('vis-network/standalone', () => ({
    // Use classes/plain methods so `fit()` exists even when Jest resets mock implementations.
    DataSet: class DataSet {
        private _data: any[];
        constructor(data?: any[]) {
            this._data = data || [];
        }
        add = () => { };
        update = () => { };
        remove = () => { };
        clear = () => { this._data = []; };
        get = () => this._data;
    },
    Network: class Network {
        constructor(_container: any, _data: any, _options: any) { }
        destroy = () => { };
        fit = () => { };
        setData = () => { };
        on = () => { };
        off = () => { };
        redraw = () => { };
        getPositions = () => ({});
        moveNode = () => { };
    }
}));

// Mock ResizeObserver (not available in JSDOM)
global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
} as any;

// Mock matchMedia (not available in JSDOM)
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
    })),
});

// JSDOM doesn't implement scrollIntoView by default; some components call it in effects.
if (typeof (Element as any).prototype.scrollIntoView !== 'function') {
    (Element as any).prototype.scrollIntoView = () => { };
}

// Mock requestAnimationFrame with synchronous fallback for tests
let rafId = 0;
global.requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => {
    // In tests, execute immediately for deterministic behavior
    setTimeout(() => cb(performance.now()), 0);
    return rafId++;
});

global.cancelAnimationFrame = jest.fn((id: number) => {
    // No-op in tests
});

