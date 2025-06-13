// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

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

// Mock Material-UI components
jest.mock('@mui/material', () => {
    const React = require('react');
    return {
        Dialog: ({ children, ...props }: any) => React.createElement('div', { 'data-testid': 'dialog', ...props }, children),
        DialogTitle: ({ children }: any) => React.createElement('div', { 'data-testid': 'dialog-title' }, children),
        DialogContent: ({ children }: any) => React.createElement('div', { 'data-testid': 'dialog-content' }, children),
        DialogActions: ({ children }: any) => React.createElement('div', { 'data-testid': 'dialog-actions' }, children),
        Button: ({ children, onClick }: any) => React.createElement('button', { onClick }, children),
        TextField: ({ label, value, onChange, ...props }: any) => React.createElement('input', {
            placeholder: label,
            value: value,
            onChange: (e: any) => onChange?.(e),
            ...props
        }),
        List: ({ children }: any) => React.createElement('ul', {}, children),
        ListItem: ({ children, ...props }: any) => React.createElement('li', { ...props }, children),
        ListItemText: ({ primary }: any) => React.createElement('span', {}, primary),
        IconButton: ({ children, onClick }: any) => React.createElement('button', { onClick }, children),
        Typography: ({ children }: any) => React.createElement('span', {}, children),
        Box: ({ children }: any) => React.createElement('div', {}, children),
        Radio: (props: any) => React.createElement('input', { type: 'radio', ...props }),
        RadioGroup: ({ children }: any) => React.createElement('div', {}, children),
        FormControlLabel: ({ children }: any) => React.createElement('label', {}, children),
        FormControl: ({ children }: any) => React.createElement('div', {}, children),
    };
});

// Mock Material-UI icons
jest.mock('@mui/icons-material/Close', () => {
    const React = require('react');
    return () => React.createElement('span', {}, '✕');
});
jest.mock('@mui/icons-material/Add', () => {
    const React = require('react');
    return () => React.createElement('span', {}, '+');
});
jest.mock('@mui/icons-material/Delete', () => {
    const React = require('react');
    return () => React.createElement('span', {}, '🗑');
});

// Mock vis-network
jest.mock('vis-network/standalone', () => ({
    DataSet: jest.fn().mockImplementation((data) => ({
        add: jest.fn(),
        update: jest.fn(),
        remove: jest.fn(),
        clear: jest.fn(),
        get: jest.fn().mockReturnValue(data || [])
    })),
    Network: jest.fn().mockImplementation(() => ({
        destroy: jest.fn(),
        fit: jest.fn(),
        setData: jest.fn(),
        on: jest.fn(),
        off: jest.fn(),
        redraw: jest.fn()
    }))
}));
