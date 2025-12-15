import React, { useState, useEffect, useRef, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Container from '@mui/material/Container';
import Avatar from '@mui/material/Avatar';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import SendIcon from '@mui/icons-material/Send';
import DeleteIcon from '@mui/icons-material/Delete';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import PersonIcon from '@mui/icons-material/Person';

import WarningIcon from '@mui/icons-material/Warning';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HelpIcon from '@mui/icons-material/Help';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useAuth } from '../../shared/contexts/AuthContext';

// Helper function to generate a random ID (replacement for uuid)
const generateId = (): string => {
    return (
        Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15)
    );
};

// Define possible structures for ToolResult content
interface ToolResultSuccessContent {
    result: 'success';
    data: any; // Can be refined further if the data structure is consistent
}

interface ToolResultErrorContent {
    result: 'error';
    error: string;
}

// More specific type for the content of a ToolResult message
type ToolResultContentType = string | ToolResultSuccessContent | ToolResultErrorContent | { [key: string]: any }; // Allow generic object as fallback

// WebSocket Message Types
interface WsQueryMessageBase {
    type: 'UserQuery' | 'AssistantText' | 'ToolCall' | 'Error';
    content?: string;
    message?: string;
    name?: string;
    args?: any;
    success?: boolean;
    conversation_id?: string;
}

interface WsToolResultMessage {
    type: 'ToolResult';
    content?: ToolResultContentType; // Use the more specific type here
    message?: string;
    name?: string; // Tool name is expected for ToolResult
    args?: any;    // Args might not be present in result, but keeping for flexibility
    success?: boolean; // Success status is expected for ToolResult
    conversation_id?: string;
}

// Union type for all possible WebSocket messages
type WsQueryMessage = WsQueryMessageBase | WsToolResultMessage;

interface Message {
    role: string;
    content: string;
    toolExecution?: ToolExecution;
}

interface ToolExecution {
    name: string;
    args?: any;
    status: 'pending' | 'executing' | 'completed' | 'cancelled';
    messageId: string;
    resultData?: any; // Added to store raw/parsed result data
}

interface Conversation {
    id: string;
    messages: Message[];
}


enum WebSocketStatus {
    CONNECTING = 'connecting',
    OPEN = 'open',
    CLOSED = 'closed',
    ERROR = 'error'
}

const Query: React.FC = () => {
    const [input, setInput] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [conversation, setConversation] = useState<Conversation | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [wsStatus, setWsStatus] = useState<WebSocketStatus>(WebSocketStatus.CLOSED);
    const ws = useRef<WebSocket | null>(null);
    const { token } = useAuth();

    // Store expanded state for each tool execution (collapsed by default)
    const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});

    // Helper to format a tool/goal name by replacing underscores and capitalizing words
    const formatGoalTitle = (title: string): string => {
        return title
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    };

    // Handle incoming WebSocket messages
    // Wrap in useCallback to ensure stable identity for connectWebSocket dependency
    const handleWebSocketMessage = useCallback((message: WsQueryMessage) => {
        console.log('Received WebSocket message:', message);

        switch (message.type) {
            case 'AssistantText':
                if (message.content) {
                    setIsLoading(false);

                    setConversation(prev => {
                        if (!prev) {
                            // If no conversation exists, create a new one
                            return {
                                id: generateId(),
                                messages: [
                                    {
                                        role: 'assistant',
                                        content: message.content || ''
                                    }
                                ]
                            };
                        }

                        // Check if the last message is already from the assistant
                        const lastMessage = prev.messages[prev.messages.length - 1];
                        if (lastMessage && lastMessage.role === 'assistant' && !lastMessage.toolExecution) {
                            // Update the existing assistant message
                            const updatedMessages = [...prev.messages];
                            updatedMessages[updatedMessages.length - 1] = {
                                ...lastMessage,
                                content: message.content || ''
                            };

                            return {
                                ...prev,
                                messages: updatedMessages
                            };
                        } else {
                            // Add a new assistant message
                            return {
                                ...prev,
                                messages: [
                                    ...prev.messages,
                                    {
                                        role: 'assistant',
                                        content: message.content || ''
                                    }
                                ]
                            };
                        }
                    });
                }
                break;

            case 'ToolCall':
                if (message.name && message.args) {
                    const messageId = generateId();
                    const toolExecution: ToolExecution = {
                        name: message.name,
                        args: message.args,
                        status: 'executing',
                        messageId
                    };

                    setConversation(prev => {
                        if (!prev) return prev;

                        // Add a new assistant message with the tool execution
                        return {
                            ...prev,
                            messages: [
                                ...prev.messages,
                                {
                                    role: 'assistant',
                                    content: `I'm executing the ${message.name} function.`,
                                    toolExecution
                                }
                            ]
                        };
                    });
                }
                break;

            case 'ToolResult':
                if (message.name) {
                    setConversation(prev => {
                        if (!prev) return prev;

                        const updatedMessages = prev.messages.map(msg => {
                            if (msg.toolExecution && msg.toolExecution.name === message.name) {

                                // Backend now sends content like: { result: "success", data: <actual_data> }
                                // or { result: "error", error: <error_message> } for tool handler errors
                                // or just the error string for dispatch/serialization errors.

                                let resultData: any = undefined;
                                let summaryContent = msg.content; // Keep the initial "Executing..." message
                                let finalStatus: 'completed' | 'cancelled' = 'cancelled'; // Default to cancelled

                                // Type guard to check if content is a ToolResultSuccessContent object
                                const isSuccessResult = (content: any): content is ToolResultSuccessContent =>
                                    typeof content === 'object' && content !== null && content.result === 'success';

                                // Type guard to check if content is a ToolResultErrorContent object
                                const isErrorResult = (content: any): content is ToolResultErrorContent =>
                                    typeof content === 'object' && content !== null && content.result === 'error' && typeof content.error === 'string';

                                // Type guard to check for generic object with an error property (fallback)
                                const hasErrorProperty = (content: any): content is { error: string } =>
                                    typeof content === 'object' && content !== null && typeof content.error === 'string';


                                if (message.success && isSuccessResult(message.content)) {
                                    // Successful execution, extract data
                                    resultData = message.content.data; // Extract the actual data
                                    summaryContent = `Executed ${formatGoalTitle(message.name || 'tool')} successfully.`; // More concise summary
                                    finalStatus = 'completed';
                                } else {
                                    // Handle failure - could be structured error or plain string
                                    let errorMsg = 'Operation failed';
                                    if (isErrorResult(message.content)) {
                                        // Structured error { result: 'error', error: '...' }
                                        errorMsg += `: ${message.content.error}`;
                                        resultData = message.content; // Store the whole error object
                                    } else if (hasErrorProperty(message.content)) {
                                        // Generic object with error property { error: '...' }
                                        errorMsg += `: ${message.content.error}`;
                                        resultData = message.content; // Store the whole error object
                                    } else if (typeof message.content === 'string') {
                                        // Plain error string from wrap_result or dispatch_tool
                                        errorMsg += `: ${message.content}`;
                                        resultData = { error: message.content }; // Store as an object for consistency
                                    } else {
                                        // Fallback for unexpected content structure
                                        errorMsg += ': An unknown error occurred.';
                                        resultData = message.content; // Store whatever we got
                                    }
                                    summaryContent = errorMsg; // Use the error message as the summary
                                    finalStatus = 'cancelled';
                                }


                                return {
                                    ...msg,
                                    content: summaryContent, // Use the generated summary text
                                    toolExecution: {
                                        ...msg.toolExecution,
                                        status: finalStatus,
                                        resultData: resultData // Store the extracted data or error info
                                    }
                                };
                            }
                            return msg;
                        });

                        return {
                            ...prev,
                            messages: updatedMessages
                        };
                    });
                }
                break;

            case 'Error':
                setIsLoading(false);
                setConversation(prev => {
                    if (!prev) {
                        return {
                            id: generateId(),
                            messages: [
                                {
                                    role: 'assistant',
                                    content: message.message || 'An error occurred'
                                }
                            ]
                        };
                    }

                    return {
                        ...prev,
                        messages: [
                            ...prev.messages,
                            {
                                role: 'assistant',
                                content: message.message || 'An error occurred'
                            }
                        ]
                    };
                });
                break;

            default:
                console.warn('Unhandled WebSocket message type:', message.type);
        }
    }, []); // Empty dependency array: uses stable state setters and outside functions

    // Function to establish WebSocket connection
    const connectWebSocket = useCallback(() => {
        setWsStatus(WebSocketStatus.CONNECTING);

        if (!token) {
            console.error('No authentication token available (from AuthContext)');
            setWsStatus(WebSocketStatus.ERROR);
            return;
        }

        // Determine WebSocket URL based on environment
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.hostname;
        const port = process.env.NODE_ENV === 'development' ? ':5059' : '';
        const wsUrl = `${protocol}//${host}${port}/query/ws?token=${encodeURIComponent(token)}`;

        console.log(`Attempting to connect WebSocket to: ${wsUrl}`);

        // Create new WebSocket connection
        ws.current = new WebSocket(wsUrl);

        // WebSocket event handlers
        ws.current.onopen = () => {
            console.log('WebSocket connection established');
            setWsStatus(WebSocketStatus.OPEN);
        };

        ws.current.onmessage = event => {
            try {
                const message = JSON.parse(event.data) as WsQueryMessage;
                handleWebSocketMessage(message);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        ws.current.onclose = () => {
            console.log('WebSocket connection closed');
            setWsStatus(WebSocketStatus.CLOSED);
            // Could implement reconnection logic here
        };

        ws.current.onerror = error => {
            console.error('WebSocket error:', error);
            setWsStatus(WebSocketStatus.ERROR);
        };
    }, [token, handleWebSocketMessage]); // Added handleWebSocketMessage dependency

    // Initialize WebSocket connection on component mount
    useEffect(() => {
        connectWebSocket();

        return () => {
            // Clean up WebSocket connection on component unmount
            // Be defensive: in tests/mocks `WebSocket.OPEN` or `.close` may be missing.
            if (ws.current && typeof (ws.current as any).close === 'function') {
                try {
                    (ws.current as any).close();
                } catch {
                    // ignore cleanup errors
                }
            }
        };
    }, [connectWebSocket]);

    useEffect(() => {
        // Scroll to bottom whenever messages change
        messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
    }, [conversation?.messages]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInput(e.target.value);
    };

    const handleSendMessage = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();

        if (!input.trim()) return;

        // Check if WebSocket is connected
        if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
            console.error('WebSocket is not connected');
            return;
        }

        // Add user message to conversation immediately
        const userMessage: Message = { role: 'user', content: input };
        const currentMessages = conversation?.messages || [];
        const conversationId = conversation?.id || generateId();

        setConversation({
            id: conversationId,
            messages: [...currentMessages, userMessage]
        });

        setIsLoading(true);

        try {
            // Send message via WebSocket
            const wsMessage: WsQueryMessage = {
                type: 'UserQuery',
                content: input,
                conversation_id: conversationId
            };

            ws.current.send(JSON.stringify(wsMessage));
            setInput('');
        } catch (error) {
            console.error('Error sending message via WebSocket:', error);
            setIsLoading(false);

            // Add error message to conversation
            setConversation(prev => {
                if (!prev) return prev;

                return {
                    ...prev,
                    messages: [
                        ...prev.messages,
                        {
                            role: 'assistant',
                            content: 'Failed to send message. Please try again.'
                        }
                    ]
                };
            });
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const clearConversation = () => {
        setConversation(null);
    };

    // Render the entire tool execution (header + collapsible content)
    const renderToolExecution = (
        toolExecution: ToolExecution,
        messageContent: string
    ) => {
        // We'll split the message content into two parts (before and after the first blank line),
        // just in case there's text like "I'm executing X function." and then the appended results.
        const [preContent] = messageContent.split('\n\n');
        // const postContent = rest.join('\n\n'); // Removed unused variable

        // Determine status and icon
        let color:
            | 'warning'
            | 'info'
            | 'success'
            | 'error'
            | 'default' = 'default';
        let icon: React.ReactNode;
        let statusText: string;

        switch (toolExecution.status) {
            case 'pending':
                color = 'warning';
                statusText = 'Waiting for confirmation';
                icon = <WarningIcon fontSize="small" />;
                break;
            case 'executing':
                color = 'info';
                statusText = 'Executing';
                icon = <CircularProgress size={14} thickness={2} />;
                break;
            case 'completed':
                color = 'success';
                statusText = 'Completed';
                icon = <CheckCircleIcon fontSize="small" />;
                break;
            case 'cancelled':
                color = 'error';
                statusText = 'Failed';
                icon = <CancelIcon fontSize="small" />;
                break;
            default:
                statusText = 'Unknown';
                icon = <HelpIcon fontSize="small" />;
        }

        // Expanded/collapsed for this message
        const isResultsExpanded = expandedTools[toolExecution.messageId] || false;

        const toggleResultsExpansion = () => {
            setExpandedTools(prev => ({
                ...prev,
                [toolExecution.messageId]: !prev[toolExecution.messageId]
            }));
        };

        return (
            <Box
                sx={{
                    mt: 1.5,
                    border: '1px solid',
                    borderColor: `${color}.main`,
                    borderRadius: 1.5,
                    overflow: 'hidden',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                }}
            >
                {/* Collapsible Header */}
                <Box
                    sx={{
                        bgcolor: `${color}.main`,
                        py: 0.7,
                        px: 1.5,
                        borderBottom: isResultsExpanded ? '1px solid' : 'none',
                        borderColor: `${color}.dark`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer'
                    }}
                    onClick={toggleResultsExpansion}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                        {icon}
                        <Typography
                            variant="caption"
                            sx={{ fontWeight: 'bold', color: 'white' }}
                        >
                            {formatGoalTitle(toolExecution.name)} ({statusText})
                        </Typography>
                    </Box>
                    <IconButton
                        size="small"
                        sx={{ color: 'white', p: 0.2 }}
                        onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            toggleResultsExpansion();
                        }}
                    >
                        {isResultsExpanded ? (
                            <ExpandLessIcon fontSize="small" />
                        ) : (
                            <ExpandMoreIcon fontSize="small" />
                        )}
                    </IconButton>
                </Box>

                {/* Collapsible Content */}
                <Collapse in={isResultsExpanded}>
                    <Box sx={{ bgcolor: 'background.paper', p: 1.5 }}>
                        {/* Pre-content (e.g. "I'm executing the X function.") */}
                        {preContent && (
                            <Box sx={{ mb: 2 }}>
                                <Typography
                                    variant="body2"
                                    sx={{ whiteSpace: 'pre-wrap' }}
                                >
                                    {preContent}
                                </Typography>
                            </Box>
                        )}

                        {/* Function Arguments Section */}
                        <Box
                            sx={{
                                border: '1px solid',
                                borderColor: 'divider',
                                borderRadius: 1,
                                mb: 2
                            }}
                        >
                            <Box
                                sx={{
                                    bgcolor: 'rgba(0,0,0,0.04)',
                                    px: 1.5,
                                    py: 1
                                }}
                            >
                                <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                                    Function Arguments
                                </Typography>
                            </Box>
                            <Box sx={{ p: 1.5 }}>
                                {toolExecution.args && Object.keys(toolExecution.args).length ? (
                                    Object.entries(toolExecution.args).map(([key, value]) => (
                                        <Box
                                            key={key}
                                            sx={{
                                                mb: 1,
                                                display: 'flex',
                                                flexDirection: 'column'
                                            }}
                                        >
                                            <Typography
                                                variant="caption"
                                                sx={{ fontWeight: 'bold', color: 'text.secondary' }}
                                            >
                                                {key}:
                                            </Typography>
                                            <Typography
                                                variant="caption"
                                                sx={{ whiteSpace: 'pre-wrap', ml: 1 }}
                                            >
                                                {typeof value === 'object'
                                                    ? JSON.stringify(value, null, 2)
                                                    : String(value)}
                                            </Typography>
                                        </Box>
                                    ))
                                ) : (
                                    <Typography
                                        variant="caption"
                                        sx={{ fontStyle: 'italic', color: 'text.secondary' }}
                                    >
                                        None
                                    </Typography>
                                )}
                            </Box>
                        </Box>

                        {/* Tool Result Section */}
                        {toolExecution.resultData !== undefined && (
                            <Box
                                sx={{
                                    border: '1px solid',
                                    borderColor: 'divider',
                                    borderRadius: 1
                                }}
                            >
                                <Box
                                    sx={{
                                        bgcolor: 'rgba(0,0,0,0.04)',
                                        px: 1.5,
                                        py: 1
                                    }}
                                >
                                    <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                                        Tool Result Data
                                    </Typography>
                                </Box>
                                <Box sx={{ p: 1.5, overflowX: 'auto' }}>
                                    {typeof toolExecution.resultData === 'object' ? (
                                        <Typography
                                            component="pre" // Use <pre> for formatting
                                            variant="body2"
                                            sx={{
                                                whiteSpace: 'pre-wrap', // Wrap long lines
                                                wordBreak: 'break-all', // Break long words/strings
                                                fontFamily: 'monospace', // Use monospace font
                                                fontSize: '0.8rem', // Slightly smaller font
                                                margin: 0 // Remove default pre margin
                                            }}
                                        >
                                            {JSON.stringify(
                                                toolExecution.resultData,
                                                null,
                                                2
                                            )}
                                        </Typography>
                                    ) : (
                                        <Typography
                                            variant="body2"
                                            sx={{
                                                whiteSpace: 'pre-wrap',
                                                fontFamily: 'inherit'
                                            }}
                                        >
                                            {String(toolExecution.resultData)}
                                        </Typography>
                                    )}
                                </Box>
                            </Box>
                        )}
                    </Box>
                </Collapse>
            </Box>
        );
    };

    // Render WebSocket connection status indicator
    const renderConnectionStatus = () => {
        let color: 'success' | 'error' | 'warning' | 'info';
        let text: string;

        switch (wsStatus) {
            case WebSocketStatus.OPEN:
                color = 'success';
                text = 'Connected';
                break;
            case WebSocketStatus.CONNECTING:
                color = 'info';
                text = 'Connecting...';
                break;
            case WebSocketStatus.CLOSED:
                color = 'warning';
                text = 'Disconnected';
                break;
            case WebSocketStatus.ERROR:
                color = 'error';
                text = 'Connection Error';
                break;
        }

        return (
            <Chip
                size="small"
                color={color}
                label={text}
                sx={{ ml: 1 }}
                onClick={wsStatus !== WebSocketStatus.OPEN ? connectWebSocket : undefined}
            />
        );
    };

    return (
        <Container
            maxWidth="md"
            sx={{
                height: 'calc(100vh - 100px)',
                display: 'flex',
                flexDirection: 'column',
                py: 2
            }}
        >
            <Paper
                elevation={3}
                sx={{
                    flexGrow: 1,
                    mb: 2,
                    p: 2,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    bgcolor: 'background.default'
                }}
            >
                <Box
                    sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        mb: 2
                    }}
                >
                    <Typography variant="h6">
                        Conversation
                        {renderConnectionStatus()}
                    </Typography>
                </Box>

                <Divider sx={{ mb: 2 }} />

                <Box
                    sx={{
                        flexGrow: 1,
                        overflow: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2
                    }}
                >
                    {!conversation?.messages?.length && (
                        <Box
                            sx={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                height: '100%',
                                opacity: 0.7
                            }}
                        >
                            <SmartToyIcon sx={{ fontSize: 48, mb: 2 }} />
                            <Typography>Start a conversation by sending a message</Typography>
                        </Box>
                    )}

                    {conversation?.messages?.map((message, index) => (
                        <Box
                            key={index}
                            sx={{
                                display: 'flex',
                                alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
                                maxWidth: '80%'
                            }}
                        >
                            <Box
                                sx={{
                                    display: 'flex',
                                    flexDirection: message.role === 'user' ? 'row-reverse' : 'row',
                                    alignItems: 'flex-start',
                                    gap: 1
                                }}
                            >
                                <Avatar
                                    sx={{
                                        bgcolor:
                                            message.role === 'user'
                                                ? 'primary.main'
                                                : 'secondary.main',
                                        mt: 0.5
                                    }}
                                >
                                    {message.role === 'user' ? <PersonIcon /> : <SmartToyIcon />}
                                </Avatar>
                                <Paper
                                    elevation={1}
                                    sx={{
                                        p: 2,
                                        bgcolor:
                                            message.role === 'user'
                                                ? 'primary.light'
                                                : 'background.paper',
                                        borderRadius: 2
                                    }}
                                >
                                    {message.toolExecution ? (
                                        // Entire tool execution (collapsed by default)
                                        renderToolExecution(
                                            message.toolExecution,
                                            message.content
                                        )
                                    ) : (
                                        // Regular message without tool execution
                                        <div
                                            style={{
                                                whiteSpace: 'pre-wrap',
                                                fontFamily: 'inherit',
                                                fontSize: '1rem',
                                                lineHeight: '1.5'
                                            }}
                                        >
                                            {message.content}
                                        </div>
                                    )}
                                </Paper>
                            </Box>
                        </Box>
                    ))}

                    {isLoading && (
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                alignSelf: 'flex-start',
                                ml: 2
                            }}
                        >
                            <CircularProgress size={20} />
                            <Typography variant="body2">Thinking...</Typography>
                        </Box>
                    )}

                    <div ref={messagesEndRef} />
                </Box>
            </Paper>

            <Paper
                component="form"
                onSubmit={handleSendMessage}
                sx={{ p: 1, display: 'flex', alignItems: 'center' }}
            >
                <TextField
                    fullWidth
                    multiline
                    maxRows={4}
                    placeholder="Type your message here..."
                    value={input}
                    onChange={handleInputChange}
                    onKeyPress={handleKeyPress}
                    disabled={isLoading || wsStatus !== WebSocketStatus.OPEN}
                    variant="outlined"
                    sx={{ mr: 1 }}
                    InputProps={{
                        sx: { borderRadius: 2 },
                        inputProps: {
                            spellCheck: 'false',
                            autoComplete: 'off'
                        }
                    }}
                />
                <Button
                    variant="contained"
                    color="primary"
                    disabled={!input.trim() || isLoading || wsStatus !== WebSocketStatus.OPEN}
                    type="submit"
                    endIcon={<SendIcon />}
                    sx={{ borderRadius: 2, px: 3, py: 1.5 }}
                >
                    Send
                </Button>
                <IconButton onClick={clearConversation} title="Clear conversation" sx={{ ml: 1 }}>
                    <DeleteIcon />
                </IconButton>
            </Paper>
        </Container>
    );
};

export default Query;

