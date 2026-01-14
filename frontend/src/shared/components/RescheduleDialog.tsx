import React, { useState, useEffect, useCallback } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    List,
    ListItem,
    ListItemText,
    ListItemButton,
    Typography,
    Box,
    CircularProgress,
    Alert
} from '@mui/material';
import { KeyboardArrowDown } from '@mui/icons-material';
import { Goal } from '../../types/goals';
import { getRescheduleOptions, updateEvent } from '../utils/api';
import { timestampToDisplayString } from '../utils/time';

interface RescheduleDialogProps {
    open: boolean;
    event: Goal;
    onClose: () => void;
    onSuccess: (updatedEvent: Goal) => void;
}

interface RescheduleOption {
    timestamp: Date;
    reason: string;
    score: number;
}

const RescheduleDialog: React.FC<RescheduleDialogProps> = ({
    open,
    event,
    onClose,
    onSuccess
}) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>('');
    const [suggestions, setSuggestions] = useState<RescheduleOption[]>([]);
    const [selectedOption, setSelectedOption] = useState<RescheduleOption | null>(null);
    const [lookAheadDays, setLookAheadDays] = useState(7);
    const [rescheduling, setRescheduling] = useState(false);

    const loadSuggestions = useCallback(async (additionalDays?: number) => {
        if (!event.id) return;

        setLoading(true);
        setError('');

        try {
            const days = additionalDays || lookAheadDays;
            const result = await getRescheduleOptions(event.id, days);

            if (additionalDays) {
                // Add to existing suggestions, removing duplicates
                const existingTimestamps = new Set(suggestions.map((s: RescheduleOption) => s.timestamp.getTime()));
                const newSuggestions = result.suggestions.filter((s: RescheduleOption) => !existingTimestamps.has(s.timestamp.getTime()));
                setSuggestions(prev => [...prev, ...newSuggestions]);
                setLookAheadDays(days);
            } else {
                setSuggestions(result.suggestions);
            }
        } catch (error) {
            console.error('Failed to load reschedule suggestions:', error);
            setError('Failed to load reschedule suggestions. Please try again.');
        } finally {
            setLoading(false);
        }
    }, [event.id, lookAheadDays, suggestions]);

    // Load initial suggestions when dialog opens
    useEffect(() => {
        if (open && event.id) {
            loadSuggestions();
        }
    }, [open, event.id, loadSuggestions]);

    const handleLoadMore = () => {
        loadSuggestions(lookAheadDays + 7);
    };

    const handleSelectOption = (option: RescheduleOption) => {
        setSelectedOption(option);
    };

    const handleReschedule = async () => {
        if (!selectedOption || !event.id) return;

        setRescheduling(true);
        setError('');

        try {
            const updatedEvent = await updateEvent(event.id, {
                scheduled_timestamp: selectedOption.timestamp,
                move_reason: 'Rescheduled via suggestions'
            });

            onSuccess(updatedEvent);
            onClose();
        } catch (error) {
            console.error('Failed to reschedule event:', error);
            setError('Failed to reschedule event. Please try again.');
        } finally {
            setRescheduling(false);
        }
    };

    const handleClose = () => {
        setSuggestions([]);
        setSelectedOption(null);
        setError('');
        setLookAheadDays(7);
        onClose();
    };

    const formatTimeSlot = (timestamp: Date) => {
        return timestampToDisplayString(timestamp, 'datetime');
    };

    const getScoreColor = (score: number) => {
        if (score >= 0.8) return 'success.main';
        if (score >= 0.6) return 'warning.main';
        return 'error.main';
    };

    const getScoreLabel = (score: number) => {
        if (score >= 0.8) return 'Excellent';
        if (score >= 0.6) return 'Good';
        if (score >= 0.4) return 'Fair';
        return 'Poor';
    };

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth="sm"
            fullWidth
        >
            <DialogTitle>
                Reschedule Event
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Currently scheduled: {formatTimeSlot(event.scheduled_timestamp!)}
                </Typography>
            </DialogTitle>

            <DialogContent>
                {error && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                )}

                {loading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                        <CircularProgress />
                    </Box>
                )}

                {!loading && suggestions.length === 0 && !error && (
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', p: 3 }}>
                        No reschedule suggestions available. Try extending the search range.
                    </Typography>
                )}

                {suggestions.length > 0 && (
                    <>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            Select a new time slot:
                        </Typography>

                        <List>
                            {suggestions.map((option, index) => (
                                <ListItem key={index} disablePadding>
                                    <ListItemButton
                                        selected={selectedOption === option}
                                        onClick={() => handleSelectOption(option)}
                                        sx={{
                                            border: selectedOption === option ? 2 : 1,
                                            borderColor: selectedOption === option ? 'primary.main' : 'divider',
                                            borderRadius: 1,
                                            mb: 1
                                        }}
                                    >
                                        <ListItemText
                                            primary={formatTimeSlot(option.timestamp)}
                                            secondary={
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                                                    <Typography variant="caption" color="text.secondary">
                                                        {option.reason}
                                                    </Typography>
                                                    <Typography
                                                        variant="caption"
                                                        sx={{
                                                            color: getScoreColor(option.score),
                                                            fontWeight: 'bold'
                                                        }}
                                                    >
                                                        {getScoreLabel(option.score)}
                                                    </Typography>
                                                </Box>
                                            }
                                        />
                                    </ListItemButton>
                                </ListItem>
                            ))}
                        </List>

                        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                            <Button
                                variant="outlined"
                                onClick={handleLoadMore}
                                disabled={loading}
                                startIcon={<KeyboardArrowDown />}
                            >
                                Load More Options
                            </Button>
                        </Box>
                    </>
                )}
            </DialogContent>

            <DialogActions>
                <Button onClick={handleClose} disabled={rescheduling}>
                    Cancel
                </Button>
                <Button
                    onClick={handleReschedule}
                    variant="contained"
                    disabled={!selectedOption || rescheduling}
                >
                    {rescheduling ? 'Rescheduling...' : 'Reschedule'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default RescheduleDialog; 