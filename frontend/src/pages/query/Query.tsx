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
    Alert,
    Link
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import DeleteIcon from '@mui/icons-material/Delete';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import PersonIcon from '@mui/icons-material/Person';
import { useAuth } from '../../shared/contexts/AuthContext';
import { privateRequest } from '../../shared/utils/api';

interface Message {
    role: string;
    content: string;
}

interface Conversation {
    id: string;
    messages: Message[];
}

interface QueryResponse {
    response: string;
    conversation_id: string;
    message_history: Message[];
}

const Query: React.FC = () => {
    const [input, setInput] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [conversation, setConversation] = useState<Conversation | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const { token } = useAuth();

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

        setIsLoading(true);

        try {
            const data = await privateRequest<QueryResponse>('query', 'POST', {
                query: input,
                conversation_id: conversation?.id,
                message_history: conversation?.messages
            });

            setConversation({
                id: data.conversation_id,
                messages: data.message_history
            });

            setInput('');
        } catch (error) {
            console.error('Error sending message:', error);
            // Add error message to conversation
            const errorMessage: Message = {
                role: 'assistant',
                content: 'Sorry, there was an error processing your request. Please try again.'
            };

            setConversation(prev => {
                if (!prev) {
                    return {
                        id: 'temp-id',
                        messages: [
                            { role: 'user', content: input },
                            errorMessage
                        ]
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

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const clearConversation = () => {
        setConversation(null);
    };

    return (
        <Container maxWidth="md" sx={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column', py: 2 }}>
            <Typography variant="h4" component="h1" gutterBottom>
                AI Assistant
            </Typography>
            <Typography variant="body1" gutterBottom>
                Ask anything about your goals, tasks, or get help with organizing your day.
            </Typography>

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
                    <IconButton onClick={clearConversation} title="Clear conversation">
                        <DeleteIcon />
                    </IconButton>
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
                                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                                        {message.content}
                                    </Typography>
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
                        sx: { borderRadius: 2 }
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
            </Paper>
        </Container>
    );
};

export default Query; 