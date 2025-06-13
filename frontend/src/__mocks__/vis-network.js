// Mock for vis-network to avoid ES modules issues in Jest tests
export const DataSet = jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    get: jest.fn().mockReturnValue([]),
    clear: jest.fn(),
}));

export const Network = jest.fn().mockImplementation(() => ({
    destroy: jest.fn(),
    setData: jest.fn(),
    setOptions: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    fit: jest.fn(),
    focus: jest.fn(),
    getConnectedNodes: jest.fn().mockReturnValue([]),
    getSelectedNodes: jest.fn().mockReturnValue([]),
    selectNodes: jest.fn(),
}));

const visNetworkMock = {
    DataSet,
    Network,
};

export default visNetworkMock; 