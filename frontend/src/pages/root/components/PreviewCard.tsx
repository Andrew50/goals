import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Paper, Box, Typography, Button } from '@mui/material';

interface PreviewCardProps {
    title: string;
    subtitle: string;
    to: string;
    children: React.ReactNode;
}

const PreviewCard: React.FC<PreviewCardProps> = ({ title, subtitle, to, children }) => {
    return (
        <Paper elevation={1} sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column', gap: 2, borderRadius: 2 }}>
            <Box>
                <Typography variant="h6" noWrap sx={{ mb: 0.5 }}>{title}</Typography>
                <Typography variant="body2" color="text.secondary" noWrap>{subtitle}</Typography>
            </Box>
            <Box sx={{ flex: 1, minHeight: 360, overflow: 'hidden', borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
                {children}
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button component={RouterLink} to={to} size="medium" variant="contained">
                    Open
                </Button>
            </Box>
        </Paper>
    );
};

export default PreviewCard;


