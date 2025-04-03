import React, { useState, useEffect, useRef } from 'react';
import {
    Box,
    Typography,
    TextField,
    Button,
    Paper,
    Container,
    Avatar,
    CircularProgress,
    Divider,
    IconButton,
    Chip
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import DeleteIcon from '@mui/icons-material/Delete';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import PersonIcon from '@mui/icons-material/Person';
import BuildIcon from '@mui/icons-material/Build';
import WarningIcon from '@mui/icons-material/Warning';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HelpIcon from '@mui/icons-material/Help';
// Import from api instead since we don't have auth utility
import { privateRequest } from '../../shared/utils/api';

// Helper function to generate a random ID (replacement for uuid)
const generateId = (): string => {
    return Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15);
};

// WebSocket Message Types
interface WsQueryMessage {
    type: 'UserQuery' | 'AssistantText' | 'ToolCall' | 'ToolResult' | 'Error';
    content?: string;
    message?: string;
    name?: string;
    args?: any;
    success?: boolean;
    conversation_id?: string;
}

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
}

interface Conversation {
    id: string;
    messages: Message[];
}

// Tool result content type for better typing
interface ToolResultContent {
    goals?: Array<{
        name?: string;
        description?: string;
        [key: string]: any;
    }>;
    goal?: {
        title?: string;
        description?: string;
        [key: string]: any;
    };
    status?: string;
    error?: string;
    [key: string]: any;
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

    // Initialize WebSocket connection on component mount
    useEffect(() => {
        connectWebSocket();

        return () => {
            // Clean up WebSocket connection on component unmount
            if (ws.current && ws.current.readyState === WebSocket.OPEN) {
                ws.current.close();
            }
        };
    }, []);

    // Function to establish WebSocket connection
    const connectWebSocket = () => {
        setWsStatus(WebSocketStatus.CONNECTING);

        // Get authentication token from localStorage or wherever it's stored
        const token = localStorage.getItem('token');
        if (!token) {
            console.error('No authentication token available');
            setWsStatus(WebSocketStatus.ERROR);
            return;
        }

        // Determine WebSocket URL based on environment
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.hostname;
        const port = process.env.NODE_ENV === 'development' ? ':5057' : '';
        const wsUrl = `${protocol}//${host}${port}/api/query/ws?token=${encodeURIComponent(token)}`;

        console.log(`Connecting to WebSocket at ${wsUrl}`);

        // Create new WebSocket connection
        ws.current = new WebSocket(wsUrl);

        // WebSocket event handlers
        ws.current.onopen = () => {
            console.log('WebSocket connection established');
            setWsStatus(WebSocketStatus.OPEN);
        };

        ws.current.onmessage = (event) => {
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

        ws.current.onerror = (error) => {
            console.error('WebSocket error:', error);
            setWsStatus(WebSocketStatus.ERROR);
        };
    };

    // Handle incoming WebSocket messages
    const handleWebSocketMessage = (message: WsQueryMessage) => {
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
                                messages: [{
                                    role: 'assistant',
                                    content: message.content || '' // Ensure non-null content
                                }]
                            };
                        }

                        // Check if the last message is already from the assistant
                        const lastMessage = prev.messages[prev.messages.length - 1];
                        if (lastMessage && lastMessage.role === 'assistant' && !lastMessage.toolExecution) {
                            // Update the existing assistant message
                            const updatedMessages = [...prev.messages];
                            updatedMessages[updatedMessages.length - 1] = {
                                ...lastMessage,
                                content: message.content || '' // Ensure non-null content
                            };

                            return {
                                ...prev,
                                messages: updatedMessages
                            };
                        } else {
                            // Add a new assistant message
                            return {
                                ...prev,
                                messages: [...prev.messages, {
                                    role: 'assistant',
                                    content: message.content || '' // Ensure non-null content
                                }]
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
                        status: 'executing' as const,
                        messageId
                    };

                    setConversation(prev => {
                        if (!prev) return prev;

                        // Add a new assistant message with the tool execution
                        return {
                            ...prev,
                            messages: [...prev.messages, {
                                role: 'assistant',
                                content: `I'm executing the ${message.name} function.`,
                                toolExecution
                            }]
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
                                // Format content for display
                                let formattedContent = msg.content;

                                if (message.success) {
                                    // Extract relevant information from the tool result
                                    if (typeof message.content === 'object' && message.content !== null) {
                                        const content = message.content as ToolResultContent;

                                        if (message.name === 'list_goals' && Array.isArray(content.goals)) {
                                            formattedContent += '\n\nGoals:';
                                            content.goals.forEach((goal, index) => {
                                                formattedContent += `\n${index + 1}. ${goal.name || 'Untitled Goal'}`;
                                                if (goal.description) formattedContent += ` - ${goal.description}`;
                                            });
                                        } else if (message.name === 'create_goal' && content.goal) {
                                            formattedContent += `\n\nCreated goal: "${content.goal.title || 'Untitled'}"`;
                                            if (content.goal.description) {
                                                formattedContent += `\nDescription: ${content.goal.description}`;
                                            }
                                        } else {
                                            formattedContent += `\n\n${JSON.stringify(content, null, 2)}`;
                                        }
                                    } else {
                                        formattedContent += '\n\nOperation completed successfully.';
                                    }
                                } else {
                                    // Handle error case
                                    if (typeof message.content === 'object' && message.content !== null) {
                                        const errorContent = message.content as ToolResultContent;
                                        formattedContent += `\n\nError: ${errorContent.error || 'Something went wrong'}`;
                                    } else {
                                        formattedContent += '\n\nOperation failed: Something went wrong';
                                    }
                                }

                                return {
                                    ...msg,
                                    content: formattedContent,
                                    toolExecution: {
                                        ...msg.toolExecution,
                                        status: message.success ? 'completed' as const : 'cancelled' as const
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
                            messages: [{
                                role: 'assistant',
                                content: message.message || 'An error occurred'
                            }]
                        };
                    }

                    return {
                        ...prev,
                        messages: [...prev.messages, {
                            role: 'assistant',
                            content: message.message || 'An error occurred'
                        }]
                    };
                });
                break;

            default:
                console.warn('Unhandled WebSocket message type:', message.type);
        }
    };

    useEffect(() => {
        // Scroll to bottom whenever messages change
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
                    messages: [...prev.messages, {
                        role: 'assistant',
                        content: 'Failed to send message. Please try again.'
                    }]
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

    // Render tool execution status
    const renderToolExecution = (toolExecution: ToolExecution) => {
        // Define the type for color to fix TypeScript errors
        let color: 'warning' | 'info' | 'success' | 'error' | 'default';
        let icon;
        let statusText;

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
                color = 'default';
                statusText = 'Unknown';
                icon = <HelpIcon fontSize="small" />;
        }

        // Helper function to get background and text colors based on status
        const getStatusColors = () => {
            switch (color) {
                case 'warning':
                    return { bg: '#FFF8E1', text: '#F57C00' };
                case 'info':
                    return { bg: '#E3F2FD', text: '#1976D2' };
                case 'success':
                    return { bg: '#E8F5E9', text: '#2E7D32' };
                case 'error':
                    return { bg: '#FFEBEE', text: '#C62828' };
                default:
                    return { bg: '#F5F5F5', text: '#757575' };
            }
        };

        const { bg, text } = getStatusColors();

        return (
            <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Chip
                    icon={icon}
                    label={`${toolExecution.name} (${statusText})`}
                    color={color}
                    size="small"
                    variant="outlined"
                    sx={{ alignSelf: 'flex-start' }}
                />

                {toolExecution.args && (
                    <Box sx={{
                        mt: 1.5,
                        border: '1px solid',
                        borderColor: `${color}.main`,
                        borderRadius: 1.5,
                        overflow: 'hidden',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                    }}>
                        <Box sx={{
                            bgcolor: `${color}.main`,
                            py: 0.7,
                            px: 1.5,
                            borderBottom: '1px solid',
                            borderColor: `${color}.dark`,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.8
                        }}>
                            <BuildIcon fontSize="small" sx={{ color: 'white' }} />
                            <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'white' }}>
                                Function Arguments
                            </Typography>
                        </Box>
                        <Box sx={{ p: 0, bgcolor: 'background.paper' }}>
                            {Object.entries(toolExecution.args).map(([key, value], index) => (
                                <Box key={key} sx={{
                                    display: 'flex',
                                    borderBottom: index < Object.entries(toolExecution.args).length - 1 ? '1px solid' : 'none',
                                    borderColor: 'divider',
                                }}>
                                    <Box sx={{
                                        width: '35%',
                                        p: 1.2,
                                        pl: 1.5,
                                        bgcolor: bg,
                                        color: text,
                                        borderRight: '1px solid',
                                        borderColor: 'divider',
                                        fontWeight: 'bold',
                                        fontSize: '0.8rem',
                                        fontFamily: 'monospace',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis'
                                    }}>
                                        {key}
                                    </Box>
                                    <Box sx={{
                                        width: '65%',
                                        p: 1.2,
                                        pl: 1.5,
                                        wordBreak: 'break-word',
                                        fontSize: '0.8rem',
                                        fontFamily: 'monospace',
                                        bgcolor: 'background.default',
                                        color: 'text.primary'
                                    }}>
                                        {typeof value === 'object'
                                            ? JSON.stringify(value, null, 2)
                                            : String(value)}
                                    </Box>
                                </Box>
                            ))}
                        </Box>
                    </Box>
                )}
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
        <Container maxWidth="md" sx={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column', py: 2 }}>
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
                <Box sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    mb: 2
                }}>
                    <Typography variant="h6">
                        Conversation
                        {renderConnectionStatus()}
                    </Typography>
                </Box>

                <Divider sx={{ mb: 2 }} />

                <Box sx={{
                    flexGrow: 1,
                    overflow: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2
                }}>
                    {!conversation?.messages?.length && (
                        <Box sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100%',
                            opacity: 0.7
                        }}>
                            <SmartToyIcon sx={{ fontSize: 48, mb: 2 }} />
                            <Typography>
                                Start a conversation by sending a message
                            </Typography>
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
                            <Box sx={{
                                display: 'flex',
                                flexDirection: message.role === 'user' ? 'row-reverse' : 'row',
                                alignItems: 'flex-start',
                                gap: 1
                            }}>
                                <Avatar
                                    sx={{
                                        bgcolor: message.role === 'user' ? 'primary.main' : 'secondary.main',
                                        mt: 0.5
                                    }}
                                >
                                    {message.role === 'user' ? <PersonIcon /> : <SmartToyIcon />}
                                </Avatar>
                                <Paper
                                    elevation={1}
                                    sx={{
                                        p: 2,
                                        bgcolor: message.role === 'user' ? 'primary.light' : 'background.paper',
                                        borderRadius: 2
                                    }}
                                >
                                    {message.toolExecution ? (
                                        // If message has tool execution, split content into pre and post execution parts
                                        <>
                                            <div style={{
                                                whiteSpace: 'pre-wrap',
                                                fontFamily: 'inherit',
                                                fontSize: '1rem',
                                                lineHeight: '1.5'
                                            }}>
                                                {/* Display content up to the first blank line, which will separate pre and post execution content */}
                                                {message.content.split('\n\n')[0]}
                                            </div>

                                            {renderToolExecution(message.toolExecution)}

                                            {/* If there's content after a blank line, display it after the tool execution UI */}
                                            {message.content.includes('\n\n') && (
                                                <div style={{
                                                    whiteSpace: 'pre-wrap',
                                                    fontFamily: 'inherit',
                                                    fontSize: '1rem',
                                                    lineHeight: '1.5',
                                                    marginTop: '12px'
                                                }}>
                                                    {message.content.split('\n\n').slice(1).join('\n\n')}
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        // Regular message without tool execution
                                        <div style={{
                                            whiteSpace: 'pre-wrap',
                                            fontFamily: 'inherit',
                                            fontSize: '1rem',
                                            lineHeight: '1.5'
                                        }}>
                                            {message.content}
                                        </div>
                                    )}
                                </Paper>
                            </Box>
                        </Box>
                    ))}

                    {isLoading && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, alignSelf: 'flex-start', ml: 2 }}>
                            <CircularProgress size={20} />
                            <Typography variant="body2">Thinking...</Typography>
                        </Box>
                    )}

                    <div ref={messagesEndRef} />
                </Box>
            </Paper>

            <Paper component="form" onSubmit={handleSendMessage} sx={{ p: 1, display: 'flex', alignItems: 'center' }}>
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
                <IconButton
                    onClick={clearConversation}
                    title="Clear conversation"
                    sx={{ ml: 1 }}
                >
                    <DeleteIcon />
                </IconButton>
            </Paper>
        </Container>
    );
};

export default Query; 