import React, { Suspense, lazy } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Container,
    Paper,
    Typography,
    Box,
    Button,
    Grid
} from '@mui/material';
import { } from '@mui/icons-material';

import { useAuth } from '../../shared/contexts/AuthContext';
import PreviewCard from './components/PreviewCard';
import DayPreview from './components/DayPreview';
import NetworkPreview from './components/NetworkPreview';
const CalendarPreview = lazy(() => import('./components/CalendarPreview'));

const Welcome: React.FC = () => {
    const navigate = useNavigate();
    const { isAuthenticated } = useAuth();


    const primaryCta = () => {
        if (isAuthenticated) return { label: 'Get Started', onClick: () => navigate('/calendar') };
        return { label: 'Get Started', onClick: () => navigate('/signup') };
    };

    const secondaryCta = () => {
        return { label: 'Sign In', onClick: () => navigate('/signin') };
    };

    const p = primaryCta();
    const s = secondaryCta();

    return (
        <Container component="main" maxWidth="lg">
            <Box sx={{ mt: { xs: 4, md: 8 }, mb: { xs: 2, md: 6 } }}>
                <Paper elevation={0} sx={{ p: { xs: 3, md: 6 }, textAlign: 'center', bgcolor: 'background.default' }}>
                    <Typography component="h1" variant="h3" sx={{ fontWeight: 700, mb: 1 }}>
                        Plan with Precision
                    </Typography>
                    <Typography variant="h6" color="text.secondary" sx={{ mb: 4 }}>
                        Calendar, lists, and visual networks that keep your goals aligned.
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 3, justifyContent: 'center', flexWrap: 'nowrap' }}>
                        <Button variant="contained" size="large" onClick={p.onClick} sx={{ px: 4 }}>{p.label}</Button>
                        <Button variant="outlined" size="large" onClick={s.onClick} sx={{ px: 4 }}>{s.label}</Button>
                    </Box>
                </Paper>
            </Box>

            <Grid container spacing={6} sx={{ mt: 2 }}>
                <Grid item xs={12} md={4} lg={4}>
                    <PreviewCard
                        title="Calendar"
                        subtitle="Plan your day, week, month, year with precision."
                        to="/calendar"
                    >
                        <Suspense fallback={<Box sx={{ height: 240 }} />}>
                            <CalendarPreview />
                        </Suspense>
                    </PreviewCard>
                </Grid>
                <Grid item xs={12} md={4} lg={4}>
                    <PreviewCard
                        title="Day"
                        subtitle="Focus on today’s tasks with clarity."
                        to="/day"
                    >
                        <DayPreview />
                    </PreviewCard>
                </Grid>
                <Grid item xs={12} md={4} lg={4}>
                    <PreviewCard
                        title="Network"
                        subtitle="See how everything connects."
                        to="/network"
                    >
                        <NetworkPreview />
                    </PreviewCard>
                </Grid>
            </Grid>
        </Container>
    );
};





export default Welcome; 