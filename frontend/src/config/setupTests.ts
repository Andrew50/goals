// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Mock react-dnd modules
jest.mock('react-dnd', () => ({
    useDrop: jest.fn().mockReturnValue([{}, jest.fn()]),
    useDrag: jest.fn().mockReturnValue([{}, jest.fn()]),
    DndProvider: ({ children }) => children
}));

jest.mock('react-dnd-html5-backend', () => ({
    HTML5Backend: {}
}));
