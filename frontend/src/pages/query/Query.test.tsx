import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../shared/utils/renderWithProviders';
import Query from './Query';

class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    static instances: MockWebSocket[] = [];

    url: string;
    readyState: number = MockWebSocket.CONNECTING;
    onopen: null | (() => void) = null;
    onmessage: null | ((event: { data: string }) => void) = null;
    onclose: null | (() => void) = null;
    onerror: null | ((error: any) => void) = null;
    send = jest.fn();
    close = jest.fn(() => {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.();
    });

    constructor(url: string) {
        this.url = url;
        MockWebSocket.instances.push(this);
    }
}

// Mock WebSocket implementation for Query.tsx
global.WebSocket = MockWebSocket as any;

describe('Query', () => {
    beforeEach(() => {
        MockWebSocket.instances = [];
        localStorage.setItem('testMode', 'true');
        localStorage.setItem('authToken', 'test-token');
        localStorage.setItem('username', 'testuser');
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        (console.error as any).mockRestore?.();
        (console.warn as any).mockRestore?.();
        (console.log as any).mockRestore?.();
    });

    test('renders query page', () => {
        renderWithProviders(<Query />, {
            withAuth: true,
            initialEntries: ['/query'],
        });

        // Look for the send button or the message input
        expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/type your message here/i)).toBeInTheDocument();
    });

    test('handles websocket lifecycle + messages (AssistantText, ToolCall, ToolResult, Error, invalid JSON)', async () => {
        renderWithProviders(<Query />, { withAuth: true, initialEntries: ['/query'] });

        await waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
        const ws = MockWebSocket.instances[0];

        // Connection opens
        act(() => {
            ws.readyState = MockWebSocket.OPEN;
            ws.onopen?.();
        });

        // Send a message
        const input = screen.getByPlaceholderText(/type your message here/i);
        await userEvent.type(input, 'hello world');
        await userEvent.click(screen.getByRole('button', { name: /send/i }));

        expect(ws.send).toHaveBeenCalledTimes(1);
        expect(screen.getByText('hello world')).toBeInTheDocument();

        // Assistant text (adds assistant message)
        act(() => {
            ws.onmessage?.({ data: JSON.stringify({ type: 'AssistantText', content: 'Hi there' }) });
        });
        expect(await screen.findByText('Hi there')).toBeInTheDocument();

        // Second assistant text updates last assistant message instead of appending a new one
        act(() => {
            ws.onmessage?.({ data: JSON.stringify({ type: 'AssistantText', content: 'Updated response' }) });
        });
        expect(await screen.findByText('Updated response')).toBeInTheDocument();

        // Tool call -> creates tool execution message
        act(() => {
            ws.onmessage?.({
                data: JSON.stringify({
                    type: 'ToolCall',
                    name: 'create_goal',
                    args: { title: 'my_goal', effort: 5 }
                })
            });
        });
        expect(await screen.findByText(/create goal \(executing\)/i)).toBeInTheDocument();

        // Tool result success -> marks completed
        act(() => {
            ws.onmessage?.({
                data: JSON.stringify({
                    type: 'ToolResult',
                    name: 'create_goal',
                    success: true,
                    content: { result: 'success', data: { id: 123 } }
                })
            });
        });
        expect(await screen.findByText(/create goal \(completed\)/i)).toBeInTheDocument();

        // Expand to render result/args sections
        await userEvent.click(screen.getByText(/create goal \(completed\)/i));
        expect(await screen.findByText(/function arguments/i)).toBeInTheDocument();
        expect(screen.getByText(/tool result data/i)).toBeInTheDocument();

        // Tool result error path (string content)
        act(() => {
            ws.onmessage?.({
                data: JSON.stringify({
                    type: 'ToolResult',
                    name: 'create_goal',
                    success: false,
                    content: 'nope'
                })
            });
        });
        expect(await screen.findByText(/create goal \(failed\)/i)).toBeInTheDocument();

        // Error message type
        act(() => {
            ws.onmessage?.({ data: JSON.stringify({ type: 'Error', message: 'server says no' }) });
        });
        expect(await screen.findByText('server says no')).toBeInTheDocument();

        // Invalid JSON should be caught
        act(() => {
            ws.onmessage?.({ data: '{not-json' });
        });
        expect(console.error).toHaveBeenCalled();

        // Unhandled message type warns
        act(() => {
            ws.onmessage?.({ data: JSON.stringify({ type: 'WeirdType', content: 'x' }) });
        });
        expect(console.warn).toHaveBeenCalled();
    });

    test('shows connection error when no auth token is available', async () => {
        // No auth provider => token is null
        renderWithProviders(<Query />, { withAuth: false, initialEntries: ['/query'] });

        // connectWebSocket runs on mount and should set status to ERROR, without constructing a WebSocket
        await waitFor(() => expect(screen.getByText(/connection error/i)).toBeInTheDocument());
        expect(MockWebSocket.instances.length).toBe(0);
    });

    test('enter key sends when connected (and shift+enter does not)', async () => {
        renderWithProviders(<Query />, { withAuth: true, initialEntries: ['/query'] });

        await waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
        const ws = MockWebSocket.instances[0];
        act(() => {
            ws.readyState = MockWebSocket.OPEN;
            ws.onopen?.();
        });

        const input = screen.getByPlaceholderText(/type your message here/i);
        await userEvent.type(input, 'line1');
        fireEvent.keyPress(input, { key: 'Enter', code: 'Enter', charCode: 13 });
        expect(ws.send).toHaveBeenCalledTimes(1);

        await userEvent.type(input, 'line2');
        fireEvent.keyPress(input, { key: 'Enter', shiftKey: true, code: 'Enter', charCode: 13 });
        // shift+enter should not send
        expect(ws.send).toHaveBeenCalledTimes(1);
    });
});

