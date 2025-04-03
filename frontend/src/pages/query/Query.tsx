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
import { privateRequest } from '../../shared/utils/api';

// Helper function to generate a random ID (replacement for uuid)
const generateId = (): string => {
    return Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15);
};

interface Message {
    role: string;
    content: string;
    toolExecution?: ToolExecution;
}

interface ToolExecution {
    name: string;
    requiresConfirmation: boolean;
    status: 'pending' | 'executing' | 'completed' | 'cancelled';
    args?: any;
    messageId: string;
}

interface Conversation {
    id: string;
    messages: Message[];
}

interface QueryResponse {
    response: string;
    conversation_id: string;
    message_history: Message[];
    tool_execution?: {
        name: string;
        args?: any;
        write_operation: boolean;
    };
}

interface ToolExecuteResponse {
    success: boolean;
    message?: string;
    error?: string;
}

const Query: React.FC = () => {
    const [input, setInput] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [conversation, setConversation] = useState<Conversation | null>(null);
    const [executingTools, setExecutingTools] = useState<Record<string, boolean>>({});
    const messagesEndRef = useRef<HTMLDivElement>(null);

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

        // Add user message to conversation immediately
        const userMessage: Message = { role: 'user', content: input };
        const currentMessages = conversation?.messages || [];
        const updatedConversation = {
            id: conversation?.id || 'temp-id',
            messages: [...currentMessages, userMessage]
        };

        setConversation(updatedConversation);
        setIsLoading(true);

        try {
            // Create a copy of the messages but filter out any pending tool executions
            // This prevents issues when sending a new message while a previous tool is still pending
            const messagesToSend = currentMessages.map(msg => {
                if (msg.toolExecution?.status === 'pending') {
                    // Only send the message content without tool execution info to avoid confusion
                    return {
                        role: msg.role,
                        content: msg.content
                    };
                }
                return msg;
            });

            const data = await privateRequest<QueryResponse>('query', 'POST', {
                query: input,
                conversation_id: conversation?.id,
                message_history: messagesToSend.length > 0 ? messagesToSend : undefined // Only send if not empty
            });

            // Handle case where response is malformed or empty
            if (!data || (!data.response && !data.tool_execution && (!data.message_history || data.message_history.length === 0))) {
                throw new Error('Received empty or invalid response from server');
            }

            // Process tool execution if present
            if (data.tool_execution) {
                // Validate the tool execution has required fields
                if (!data.tool_execution.name) {
                    throw new Error('Invalid tool execution: missing name');
                }

                const requiresConfirmation = data.tool_execution.write_operation;
                const messageId = generateId();
                const toolExecution: ToolExecution = {
                    name: data.tool_execution.name,
                    args: data.tool_execution.args,
                    requiresConfirmation,
                    status: requiresConfirmation ? 'pending' : 'executing',
                    messageId
                };

                // Instead of modifying the received message history, we'll preserve any existing
                // pending tool executions and add the new one properly
                const updatedMessages = [...updatedConversation.messages];

                // Add a new assistant message with the tool execution
                updatedMessages.push({
                    role: 'assistant',
                    content: requiresConfirmation
                        ? `I need to execute the ${data.tool_execution.name} function.`
                        : `I'm executing the ${data.tool_execution.name} function.`,
                    toolExecution
                });

                setConversation({
                    id: data.conversation_id,
                    messages: updatedMessages
                });

                if (!requiresConfirmation) {
                    // For read operations, we can immediately execute the tool
                    executeConfirmedTool(toolExecution);
                }
            } else {
                // For responses without tool execution, we need to carefully preserve any pending tool executions
                // while still updating with the new assistant response

                // Merge the new message history with our current conversation
                // Start with user messages up to the latest
                const mergedMessages = [...updatedConversation.messages];

                // Add the new assistant response
                if (data.message_history && data.message_history.length > 0) {
                    // Find the last assistant message in the new history
                    const lastAssistantMessage = [...data.message_history]
                        .reverse()
                        .find(msg => msg.role === 'assistant');

                    if (lastAssistantMessage) {
                        mergedMessages.push(lastAssistantMessage);
                    }
                }

                setConversation({
                    id: data.conversation_id,
                    messages: mergedMessages
                });
            }

            setInput('');
        } catch (error) {
            console.error('Error sending message:', error);
            // Extract error message if available
            let errorContent = 'Sorry, there was an error processing your request. Please try again.';

            if (error && typeof error === 'object' && 'response' in error &&
                error.response && typeof error.response === 'object' &&
                'data' in error.response && error.response.data &&
                typeof error.response.data === 'object' && 'error' in error.response.data) {
                errorContent = error.response.data.error as string;
            } else if (error instanceof Error) {
                errorContent = `Error: ${error.message}`;
            }

            // Add error message to conversation
            const errorMessage: Message = {
                role: 'assistant',
                content: errorContent
            };

            setConversation(prev => {
                if (!prev) {
                    return {
                        id: 'temp-id',
                        messages: [userMessage, errorMessage]
                    };
                }

                return {
                    ...prev,
                    messages: [...prev.messages, errorMessage]
                };
            });
        } finally {
            setIsLoading(false);
        }
    };

    const executeConfirmedTool = async (toolToExecute: ToolExecution) => {
        if (!toolToExecute) return;

        // Set tool execution loading state for this specific message
        setExecutingTools(prev => ({
            ...prev,
            [toolToExecute.messageId]: true
        }));

        // Update tool status to executing
        setConversation(prev => {
            if (!prev) return prev;

            const updatedMessages = prev.messages.map(msg => {
                if (msg.toolExecution?.messageId === toolToExecute.messageId) {
                    return {
                        ...msg,
                        toolExecution: {
                            ...msg.toolExecution,
                            status: 'executing' as const
                        }
                    } as Message;
                }
                return msg;
            });

            return {
                ...prev,
                messages: updatedMessages
            };
        });

        try {
            // Make an API call to execute the tool on the backend
            const response = await privateRequest<ToolExecuteResponse>('query/tool-execute', 'POST', {
                tool_name: toolToExecute.name,
                args: toolToExecute.args,
                conversation_id: conversation?.id
            });

            // Update the conversation with the tool execution result
            if (response && response.success) {
                setConversation(prev => {
                    if (!prev) return prev;

                    const updatedMessages = [...prev.messages];

                    // Find the message with the tool execution and update its status
                    const toolMessageIndex = updatedMessages.findIndex(
                        msg => msg.toolExecution?.messageId === toolToExecute.messageId
                    );

                    if (toolMessageIndex !== -1) {
                        // Append the response message to the existing content instead of creating a new message
                        const originalContent = updatedMessages[toolMessageIndex].content;
                        const appendedContent = response.message
                            ? `${originalContent}\n\n${response.message}`
                            : originalContent;

                        updatedMessages[toolMessageIndex] = {
                            ...updatedMessages[toolMessageIndex],
                            content: appendedContent,
                            toolExecution: {
                                ...updatedMessages[toolMessageIndex].toolExecution!,
                                status: 'completed' as const
                            }
                        } as Message;
                    }

                    return {
                        ...prev,
                        messages: updatedMessages
                    };
                });
            } else {
                throw new Error(response?.error || 'Tool execution failed without specific error');
            }
        } catch (error) {
            console.error('Error executing tool:', error);

            // Extract a user-friendly error message
            let errorMsg = 'Failed to execute the tool due to an unknown error';

            if (error instanceof Error) {
                errorMsg = error.message;
            } else if (typeof error === 'object' && error !== null) {
                // Try to extract error message from axios error response
                if ('response' in error &&
                    error.response &&
                    typeof error.response === 'object' &&
                    'data' in error.response) {
                    const responseData = error.response.data;
                    if (typeof responseData === 'object' && responseData !== null && 'error' in responseData) {
                        errorMsg = responseData.error as string;
                    }
                }
            }

            // Update the conversation with the error
            setConversation(prev => {
                if (!prev) return prev;

                const updatedMessages = [...prev.messages];
                const toolMessageIndex = updatedMessages.findIndex(
                    msg => msg.toolExecution?.messageId === toolToExecute.messageId
                );

                if (toolMessageIndex !== -1) {
                    // Append the error to the existing message instead of creating a new one
                    const originalContent = updatedMessages[toolMessageIndex].content;

                    updatedMessages[toolMessageIndex] = {
                        ...updatedMessages[toolMessageIndex],
                        content: `${originalContent}\n\nError: ${errorMsg}`,
                        toolExecution: {
                            ...updatedMessages[toolMessageIndex].toolExecution!,
                            status: 'cancelled' as const
                        }
                    } as Message;
                }

                return {
                    ...prev,
                    messages: updatedMessages
                };
            });
        } finally {
            // Clear this specific executing tool
            setExecutingTools(prev => {
                const updated = { ...prev };
                delete updated[toolToExecute.messageId];
                return updated;
            });
        }
    };

    const cancelToolExecution = (toolToCancel: ToolExecution) => {
        // Update tool status to cancelled
        setConversation(prev => {
            if (!prev) return prev;

            const updatedMessages = prev.messages.map(msg => {
                if (msg.toolExecution?.messageId === toolToCancel.messageId) {
                    return {
                        ...msg,
                        toolExecution: {
                            ...msg.toolExecution,
                            status: 'cancelled' as const
                        },
                        content: `${msg.content}\n\n(Operation cancelled by user)`
                    } as Message;
                }
                return msg;
            });

            return {
                ...prev,
                messages: updatedMessages
            };
        });
    };

    const handleConfirmTool = (toolToConfirm: ToolExecution) => {
        executeConfirmedTool(toolToConfirm);
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
                statusText = 'Cancelled';
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

        const isExecuting = executingTools[toolExecution.messageId] === true;

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

                {toolExecution.status === 'pending' && toolExecution.requiresConfirmation && (
                    <Box sx={{ mt: 1.5, display: 'flex', gap: 1.5, pl: 2 }}>
                        <Button
                            size="small"
                            variant="contained"
                            color="error"
                            startIcon={<CancelIcon />}
                            onClick={() => cancelToolExecution(toolExecution)}
                            disabled={isExecuting}
                            sx={{
                                px: 2,
                                py: 0.8,
                                minWidth: '90px',
                                boxShadow: 2
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            size="small"
                            variant="contained"
                            color="primary"
                            startIcon={isExecuting ? <CircularProgress size={16} color="inherit" /> : <CheckCircleIcon />}
                            onClick={() => handleConfirmTool(toolExecution)}
                            disabled={isExecuting}
                            sx={{
                                px: 2,
                                py: 0.8,
                                minWidth: '90px',
                                boxShadow: 2
                            }}
                        >
                            {isExecuting ? 'Executing...' : 'Confirm'}
                        </Button>
                    </Box>
                )}
            </Box>
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
                    disabled={isLoading}
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
                    disabled={!input.trim() || isLoading}
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