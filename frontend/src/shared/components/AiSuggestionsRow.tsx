import React from 'react';
import { Box, Chip, CircularProgress, Typography, Tooltip } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';

interface AiSuggestionsRowProps {
    suggestions: string[];
    isLoading: boolean;
    onSelect: (value: string) => void;
    label?: string;
}

const AiSuggestionsRow: React.FC<AiSuggestionsRowProps> = ({ suggestions, isLoading, onSelect, label }) => {
    if (!isLoading && suggestions.length === 0) return null;

    return (
        <Box sx={{ mt: 0.5, mb: 1, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Tooltip title="AI Suggestions">
                <AutoAwesomeIcon sx={{ fontSize: 16, color: 'secondary.main', mr: 0.5 }} />
            </Tooltip>
            {label && (
                <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
                    {label}:
                </Typography>
            )}
            {isLoading ? (
                <CircularProgress size={16} color="secondary" />
            ) : (
                suggestions.map((s, idx) => (
                    <Chip
                        key={idx}
                        label={s}
                        size="small"
                        onClick={() => onSelect(s)}
                        color={idx === 0 ? "secondary" : "default"}
                        variant={idx === 0 ? "filled" : "outlined"}
                        sx={{ 
                            fontSize: '0.75rem',
                            height: 20,
                            cursor: 'pointer',
                            '&:hover': {
                                transform: 'translateY(-1px)',
                                boxShadow: 1
                            }
                        }}
                    />
                ))
            )}
        </Box>
    );
};

export default AiSuggestionsRow;

