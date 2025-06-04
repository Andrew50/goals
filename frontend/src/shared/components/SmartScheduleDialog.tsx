import React, { useState, useEffect } from 'react';
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
    Alert,
    TextField,
    Grid,
    FormControlLabel,
    Checkbox
} from '@mui/material';
import { KeyboardArrowDown } from '@mui/icons-material';
import { getSmartScheduleOptions } from '../utils/api';
import { timestampToDisplayString } from '../utils/time';

interface SmartScheduleDialogProps {
    open: boolean;
    duration: number;
    eventName?: string;
    currentScheduledTime?: Date;
    onClose: () => void;
    onSelect: (timestamp: Date) => void;
}

interface ScheduleOption {
    timestamp: Date;
    reason: string;
    score: number;
}

const SmartScheduleDialog: React.FC<SmartScheduleDialogProps> = ({
    open,
    duration,
    eventName,
    currentScheduledTime,
    onClose,
    onSelect
}) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>('');
    const [suggestions, setSuggestions] = useState<ScheduleOption[]>([]);
    const [selectedOption, setSelectedOption] = useState<ScheduleOption | null>(null);
    const [lookAheadDays, setLookAheadDays] = useState(7);
    const [preferredTimeStart, setPreferredTimeStart] = useState<number>(8);
    const [preferredTimeEnd, setPreferredTimeEnd] = useState<number>(18);
    const [suggestAfterCurrent, setSuggestAfterCurrent] = useState<boolean>(true);

    // Load initial suggestions when dialog opens
    useEffect(() => {
        if (open) {
            loadSuggestions();
        }
    }, [open]);

    const loadSuggestions = async (additionalDays?: number) => {
        setLoading(true);
        setError('');

        try {
            const days = additionalDays || lookAheadDays;
            const result = await getSmartScheduleOptions({
                duration,
                lookAheadDays: days,
                preferredTimeStart,
                preferredTimeEnd,
                startAfterTimestamp: currentScheduledTime && suggestAfterCurrent ? currentScheduledTime : undefined
            });

            if (additionalDays) {
                // Add to existing suggestions, removing duplicates
                const existingTimestamps = new Set(suggestions.map(s => s.timestamp.getTime()));
                const newSuggestions = result.suggestions.filter(s => !existingTimestamps.has(s.timestamp.getTime()));
                setSuggestions(prev => [...prev, ...newSuggestions]);
                setLookAheadDays(days);
            } else {
                setSuggestions(result.suggestions);
            }
        } catch (error) {
            console.error('Failed to load smart schedule suggestions:', error);
            setError('Failed to load schedule suggestions. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleLoadMore = () => {
        loadSuggestions(lookAheadDays + 7);
    };

    const handleSelectOption = (option: ScheduleOption) => {
        setSelectedOption(option);
    };

    const handleSchedule = () => {
        if (selectedOption) {
            onSelect(selectedOption.timestamp);
            handleClose();
        }
    };

    const handlePreferencesUpdate = () => {
        setSuggestions([]);
        setSelectedOption(null);
        loadSuggestions();
    };

    const handleClose = () => {
        setSuggestions([]);
        setSelectedOption(null);
        setError('');
        setLookAheadDays(7);
        setPreferredTimeStart(8);
        setPreferredTimeEnd(18);
        setSuggestAfterCurrent(true);
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
                {currentScheduledTime ? 'Reschedule Event' : 'Smart Schedule'}{eventName ? `: ${eventName}` : ''}
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Duration: {Math.floor(duration / 60)}h {duration % 60}m
                    {currentScheduledTime && (
                        <><br />Currently scheduled: {timestampToDisplayString(currentScheduledTime, 'datetime')}</>
                    )}
                </Typography>
            </DialogTitle>

            <DialogContent>
                {/* Preferences Section */}
                <Box sx={{ mb: 3, p: 2, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="subtitle2" sx={{ mb: 2 }}>Scheduling Preferences</Typography>

                    {currentScheduledTime && (
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={suggestAfterCurrent}
                                    onChange={(e) => setSuggestAfterCurrent(e.target.checked)}
                                />
                            }
                            label="Only suggest times after current scheduled date"
                            sx={{ mb: 2 }}
                        />
                    )}

                    <Grid container spacing={2}>
                        <Grid item xs={6}>
                            <TextField
                                label="Preferred Start Time"
                                type="number"
                                value={preferredTimeStart}
                                onChange={(e) => setPreferredTimeStart(parseInt(e.target.value) || 8)}
                                inputProps={{ min: 0, max: 23 }}
                                fullWidth
                                size="small"
                            />
                        </Grid>
                        <Grid item xs={6}>
                            <TextField
                                label="Preferred End Time"
                                type="number"
                                value={preferredTimeEnd}
                                onChange={(e) => setPreferredTimeEnd(parseInt(e.target.value) || 18)}
                                inputProps={{ min: 0, max: 23 }}
                                fullWidth
                                size="small"
                            />
                        </Grid>
                    </Grid>
                    <Button
                        onClick={handlePreferencesUpdate}
                        size="small"
                        sx={{ mt: 2 }}
                        variant="outlined"
                    >
                        Update Suggestions
                    </Button>
                </Box>

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
                        No schedule suggestions available. Try adjusting your preferences or extending the search range.
                    </Typography>
                )}

                {!loading && suggestions.length > 0 && (
                    <>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            Suggested Time Slots
                        </Typography>
                        <List dense sx={{ maxHeight: 300, overflow: 'auto' }}>
                            {suggestions.map((option, index) => (
                                <ListItem key={index} disablePadding>
                                    <ListItemButton
                                        onClick={() => handleSelectOption(option)}
                                        selected={selectedOption === option}
                                        sx={{
                                            borderRadius: 1,
                                            mb: 0.5,
                                            border: selectedOption === option ? 2 : 1,
                                            borderColor: selectedOption === option ? 'primary.main' : 'divider'
                                        }}
                                    >
                                        <ListItemText
                                            primary={formatTimeSlot(option.timestamp)}
                                            secondary={
                                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <Typography
                                                        component="span"
                                                        variant="caption"
                                                        sx={{
                                                            color: getScoreColor(option.score),
                                                            fontWeight: 'bold'
                                                        }}
                                                    >
                                                        {getScoreLabel(option.score)}
                                                    </Typography>
                                                    <Typography component="span" variant="caption" color="text.secondary">
                                                        • {option.reason}
                                                    </Typography>
                                                </span>
                                            }
                                        />
                                    </ListItemButton>
                                </ListItem>
                            ))}
                        </List>

                        {suggestions.length >= 15 && (
                            <Button
                                onClick={handleLoadMore}
                                startIcon={<KeyboardArrowDown />}
                                disabled={loading}
                                fullWidth
                                sx={{ mt: 1 }}
                            >
                                Load More Options
                            </Button>
                        )}
                    </>
                )}
            </DialogContent>

            <DialogActions>
                <Button onClick={handleClose}>
                    Cancel
                </Button>
                <Button
                    onClick={handleSchedule}
                    variant="contained"
                    disabled={!selectedOption}
                >
                    Schedule
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default SmartScheduleDialog; 