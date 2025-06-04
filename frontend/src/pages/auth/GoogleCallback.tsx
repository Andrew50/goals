import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Container, Box, Typography, CircularProgress, Alert } from '@mui/material';
import { useAuth } from '../../shared/contexts/AuthContext';

const GoogleCallback: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { handleGoogleCallback, isAuthenticated } = useAuth();
    const [error, setError] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(true);
    const hasProcessed = useRef(false);

    useEffect(() => {
        const code = searchParams.get('code');
        const state = searchParams.get('state');
        const error = searchParams.get('error');

        console.log('🔄 [CALLBACK] GoogleCallback component useEffect triggered');
        console.log('📋 [CALLBACK] URL search params:', {
            code: code?.substring(0, 50) + '...',
            state: state,
            error: error,
            hasProcessed: hasProcessed.current
        });

        // Only process if we have code/state and haven't processed yet
        if (!code || !state || hasProcessed.current) {
            if (error) {
                console.error('❌ [CALLBACK] Google OAuth error received:', error);
                setError(`Google OAuth error: ${error}`);
                setIsProcessing(false);
            } else if (!code || !state) {
                console.error('❌ [CALLBACK] Missing required parameters - code:', !!code, 'state:', !!state);
                setError('Missing authorization code or state parameter');
                setIsProcessing(false);
            } else {
                console.log('⏭️ [CALLBACK] Skipping processing - already processed');
            }
            return;
        }

        console.log('✅ [CALLBACK] All required parameters present, starting processing...');

        const processCallback = async () => {
            try {
                hasProcessed.current = true;
                console.log('🔒 [CALLBACK] Set hasProcessed flag to true');

                console.log('🔄 [CALLBACK] Calling handleGoogleCallback...');
                // Handle the callback
                await handleGoogleCallback(code, state);

                console.log('✅ [CALLBACK] Google callback processed successfully');
                console.log('🧭 [CALLBACK] Navigating to /calendar...');
                // Navigate to the calendar page on success
                navigate('/day');
            } catch (err: any) {
                console.error('❌ [CALLBACK] Error during callback processing:', err);
                console.error('❌ [CALLBACK] Error details:', {
                    message: err.message,
                    stack: err.stack
                });
                setError(err.message || 'Failed to process Google login');
                setIsProcessing(false);
            }
        };

        processCallback();
    }, [searchParams, handleGoogleCallback, navigate]); // Include proper dependencies

    // If already authenticated, redirect
    useEffect(() => {
        if (isAuthenticated && !isProcessing) {
            navigate('/day');
        }
    }, [isAuthenticated, isProcessing, navigate]);

    if (error) {
        return (
            <Container component="main" maxWidth="xs">
                <Box
                    sx={{
                        marginTop: 8,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                    }}
                >
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                    <Typography variant="body2" sx={{ textAlign: 'center' }}>
                        <a href="/signin">Return to sign in</a>
                    </Typography>
                </Box>
            </Container>
        );
    }

    return (
        <Container component="main" maxWidth="xs">
            <Box
                sx={{
                    marginTop: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                }}
            >
                <CircularProgress sx={{ mb: 2 }} />
                <Typography variant="h6" sx={{ textAlign: 'center' }}>
                    Processing Google Sign-In...
                </Typography>
            </Box>
        </Container>
    );
};

export default GoogleCallback; 