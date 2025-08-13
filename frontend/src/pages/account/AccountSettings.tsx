import React, { useState, useEffect } from "react";
import {
    Container,
    Paper,
    Typography,
    Box,
    Button,
    TextField,
    Alert,
    Chip,
    Divider,
    List,
    ListItem,
    ListItemText,
    ListItemSecondaryAction,
    IconButton,
    Card,
    CardContent,
    CircularProgress,
    Snackbar,
} from "@mui/material";
import { 
    Google, 
    Key, 
    LinkOff, 
    Notifications, 
    NotificationsOff,
    NotificationsActive,
    PhoneIphone,
    CheckCircle,
} from "@mui/icons-material";
import { privateRequest } from "../../shared/utils/api";
import { usePushNotifications, useInstallPrompt } from "../../shared/hooks/usePushNotifications";

interface AuthMethod {
    method_type: string;
    is_primary: boolean;
    created_at: number;
    last_used?: number;
}

interface UserAccount {
    user_id: number;
    username: string;
    email?: string;
    display_name?: string;
    auth_methods: AuthMethod[];
    is_email_verified: boolean;
    created_at?: number;
    updated_at?: number;
}

const AccountSettings: React.FC = () => {
    const [account, setAccount] = useState<UserAccount | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [password, setPassword] = useState("");
    const [showPasswordForm, setShowPasswordForm] = useState(false);
    const [notificationState, notificationActions] = usePushNotifications();
    const { showPrompt: showInstallPrompt, dismissPrompt } = useInstallPrompt();
    const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);

    const loadAccountInfo = async () => {
        try {
            setLoading(true);
            const accountData = await privateRequest<UserAccount>("account", "GET");
            setAccount(accountData);
        } catch (err: any) {
            setError("Failed to load account information");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadAccountInfo();
    }, []);

    const handleSetPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        try {
            await privateRequest("account/set-password", "POST", { password });
            setSuccess("Password set successfully");
            setPassword("");
            setShowPasswordForm(false);
            loadAccountInfo(); // Reload account info
        } catch (err: any) {
            setError(err.response?.data?.message || "Failed to set password");
        }
    };

    const handleLinkGoogle = async () => {
        setError(null);
        setSuccess(null);

        try {
            // Get Google auth URL
            const response = await privateRequest<{ auth_url: string; state: string }>("auth/google", "GET");

            // Store the current action for when we return from Google
            localStorage.setItem("google_auth_action", "link");
            localStorage.setItem("google_auth_state", response.state);

            // Redirect to Google
            window.location.href = response.auth_url;
        } catch (err: any) {
            setError("Failed to initiate Google linking");
        }
    };

    const handleUnlinkGoogle = async () => {
        if (!window.confirm("Are you sure you want to unlink your Google account?")) {
            return;
        }

        setError(null);
        setSuccess(null);

        try {
            await privateRequest("account/unlink-google", "POST");
            setSuccess("Google account unlinked successfully");
            loadAccountInfo(); // Reload account info
        } catch (err: any) {
            setError(err.response?.data?.message || "Failed to unlink Google account");
        }
    };

    const hasPasswordAuth = account?.auth_methods.some(method => method.method_type === "password");
    const hasGoogleAuth = account?.auth_methods.some(method => method.method_type === "google");

    if (loading) {
        return (
            <Container component="main" maxWidth="md">
                <Box sx={{ mt: 4, display: 'flex', justifyContent: 'center' }}>
                    <Typography>Loading account information...</Typography>
                </Box>
            </Container>
        );
    }

    return (
        <Container component="main" maxWidth="md">
            <Box sx={{ mt: 4 }}>
                <Paper elevation={3} sx={{ p: 4 }}>
                    <Typography variant="h4" component="h1" gutterBottom>
                        Account Settings
                    </Typography>

                    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                    {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

                    {account && (
                        <>
                            {/* Account Information */}
                            <Box sx={{ mb: 4 }}>
                                <Typography variant="h6" gutterBottom>
                                    Account Information
                                </Typography>
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    <Typography><strong>Username:</strong> {account.username}</Typography>
                                    {account.email && (
                                        <Typography><strong>Email:</strong> {account.email}</Typography>
                                    )}
                                    {account.display_name && (
                                        <Typography><strong>Display Name:</strong> {account.display_name}</Typography>
                                    )}
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Typography><strong>Email Verified:</strong></Typography>
                                        <Chip
                                            label={account.is_email_verified ? "Verified" : "Not Verified"}
                                            color={account.is_email_verified ? "success" : "warning"}
                                            size="small"
                                        />
                                    </Box>
                                </Box>
                            </Box>

                            <Divider sx={{ mb: 4 }} />

                            {/* Authentication Methods */}
                            <Box sx={{ mb: 4 }}>
                                <Typography variant="h6" gutterBottom>
                                    Authentication Methods
                                </Typography>
                                <List>
                                    {account.auth_methods.map((method, index) => (
                                        <ListItem key={index} divider>
                                            <ListItemText
                                                primary={
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                        {method.method_type === "password" ? <Key /> : <Google />}
                                                        <Typography variant="subtitle1">
                                                            {method.method_type === "password" ? "Password" : "Google"}
                                                        </Typography>
                                                        {method.is_primary && (
                                                            <Chip label="Primary" color="primary" size="small" />
                                                        )}
                                                    </Box>
                                                }
                                                secondary={`Added: ${new Date(method.created_at).toLocaleDateString()}`}
                                            />
                                            <ListItemSecondaryAction>
                                                {method.method_type === "google" && (
                                                    <IconButton
                                                        edge="end"
                                                        onClick={handleUnlinkGoogle}
                                                        disabled={!hasPasswordAuth}
                                                        title={!hasPasswordAuth ? "Set a password before unlinking Google" : "Unlink Google account"}
                                                    >
                                                        <LinkOff />
                                                    </IconButton>
                                                )}
                                            </ListItemSecondaryAction>
                                        </ListItem>
                                    ))}
                                </List>
                            </Box>

                            <Divider sx={{ mb: 4 }} />

                            {/* Add Authentication Methods */}
                            <Box sx={{ mb: 4 }}>
                                <Typography variant="h6" gutterBottom>
                                    Add Authentication Methods
                                </Typography>

                                {/* Password Section */}
                                {!hasPasswordAuth && (
                                    <Box sx={{ mb: 3 }}>
                                        <Typography variant="subtitle1" gutterBottom>
                                            Set Password
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                            Add a password to your account for additional security.
                                        </Typography>
                                        {!showPasswordForm ? (
                                            <Button
                                                variant="outlined"
                                                startIcon={<Key />}
                                                onClick={() => setShowPasswordForm(true)}
                                            >
                                                Set Password
                                            </Button>
                                        ) : (
                                            <Box component="form" onSubmit={handleSetPassword} sx={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
                                                <TextField
                                                    label="New Password"
                                                    type="password"
                                                    value={password}
                                                    onChange={(e) => setPassword(e.target.value)}
                                                    required
                                                    sx={{ flexGrow: 1 }}
                                                />
                                                <Button type="submit" variant="contained">
                                                    Set Password
                                                </Button>
                                                <Button
                                                    variant="outlined"
                                                    onClick={() => {
                                                        setShowPasswordForm(false);
                                                        setPassword("");
                                                    }}
                                                >
                                                    Cancel
                                                </Button>
                                            </Box>
                                        )}
                                    </Box>
                                )}

                                {/* Google Section */}
                                {!hasGoogleAuth && (
                                    <Box sx={{ mb: 3 }}>
                                        <Typography variant="subtitle1" gutterBottom>
                                            Link Google Account
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                            Link your Google account for easy sign-in.
                                        </Typography>
                                        <Button
                                            variant="outlined"
                                            startIcon={<Google />}
                                            onClick={handleLinkGoogle}
                                        >
                                            Link Google Account
                                        </Button>
                                    </Box>
                                )}
                            </Box>

                            <Divider sx={{ mb: 4 }} />

                            {/* Push Notifications Section */}
                            <Box sx={{ mb: 4 }}>
                                <Typography variant="h6" gutterBottom>
                                    Push Notifications
                                </Typography>
                                
                                {/* iOS Install Prompt */}
                                {showInstallPrompt && (
                                    <Card sx={{ mb: 3, bgcolor: 'info.light', color: 'info.contrastText' }}>
                                        <CardContent>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                                                <PhoneIphone />
                                                <Typography variant="subtitle1">
                                                    Install App for Notifications
                                                </Typography>
                                            </Box>
                                            <Typography variant="body2" sx={{ mb: 2 }}>
                                                To receive push notifications on iOS, you need to add this app to your home screen:
                                            </Typography>
                                            <Typography variant="body2" component="ol" sx={{ pl: 2, mb: 2 }}>
                                                <li>Tap the Share button <span style={{ fontFamily: 'system-ui' }}>􀈂</span> in Safari</li>
                                                <li>Select "Add to Home Screen"</li>
                                                <li>Tap "Add" to install</li>
                                                <li>Open the app from your home screen</li>
                                            </Typography>
                                            <Button 
                                                variant="contained" 
                                                size="small"
                                                onClick={dismissPrompt}
                                            >
                                                Got it
                                            </Button>
                                        </CardContent>
                                    </Card>
                                )}

                                {/* Notification Status */}
                                <Card sx={{ mb: 2 }}>
                                    <CardContent>
                                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                                {notificationState.isSubscribed ? (
                                                    <NotificationsActive color="success" />
                                                ) : (
                                                    <NotificationsOff color="disabled" />
                                                )}
                                                <Box>
                                                    <Typography variant="subtitle1">
                                                        {notificationState.isSubscribed ? 'Notifications Enabled' : 'Notifications Disabled'}
                                                    </Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        {notificationState.isSupported ? 
                                                            (notificationState.isStandalone ? 
                                                                `Permission: ${notificationState.permission}` : 
                                                                'App not installed to home screen') : 
                                                            'Not supported in this browser'}
                                                    </Typography>
                                                </Box>
                                            </Box>
                                            
                                            {notificationState.isLoading && <CircularProgress size={24} />}
                                        </Box>

                                        {notificationState.error && (
                                            <Alert severity="error" sx={{ mt: 2 }}>
                                                {notificationState.error}
                                            </Alert>
                                        )}

                                        <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
                                            {!notificationState.isSubscribed ? (
                                                <Button
                                                    variant="contained"
                                                    startIcon={<Notifications />}
                                                    onClick={async () => {
                                                        const success = await notificationActions.subscribe();
                                                        if (success) {
                                                            setSnackbarMessage('Push notifications enabled successfully!');
                                                        }
                                                    }}
                                                    disabled={
                                                        notificationState.isLoading || 
                                                        !notificationState.isSupported ||
                                                        (!notificationState.isStandalone && /iPad|iPhone|iPod/.test(navigator.userAgent))
                                                    }
                                                >
                                                    Enable Notifications
                                                </Button>
                                            ) : (
                                                <>
                                                    <Button
                                                        variant="outlined"
                                                        startIcon={<NotificationsOff />}
                                                        onClick={async () => {
                                                            const success = await notificationActions.unsubscribe();
                                                            if (success) {
                                                                setSnackbarMessage('Push notifications disabled');
                                                            }
                                                        }}
                                                        disabled={notificationState.isLoading}
                                                    >
                                                        Disable Notifications
                                                    </Button>
                                                    <Button
                                                        variant="outlined"
                                                        startIcon={<CheckCircle />}
                                                        onClick={async () => {
                                                            const success = await notificationActions.sendTestNotification();
                                                            if (success) {
                                                                setSnackbarMessage('Test notification sent!');
                                                            }
                                                        }}
                                                        disabled={notificationState.isLoading}
                                                    >
                                                        Send Test
                                                    </Button>
                                                </>
                                            )}
                                        </Box>
                                    </CardContent>
                                </Card>

                                {/* Information about notifications */}
                                <Typography variant="body2" color="text.secondary">
                                    Push notifications can alert you about upcoming events, task deadlines, and routine reminders.
                                    {' '}
                                    {/iPad|iPhone|iPod/.test(navigator.userAgent) && !notificationState.isStandalone && (
                                        <>
                                            <strong>Note:</strong> On iOS devices, the app must be installed to your home screen to receive notifications.
                                        </>
                                    )}
                                </Typography>
                            </Box>
                        </>
                    )}
                </Paper>
            </Box>

            {/* Snackbar for success messages */}
            <Snackbar
                open={!!snackbarMessage}
                autoHideDuration={4000}
                onClose={() => setSnackbarMessage(null)}
                message={snackbarMessage}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            />
        </Container>
    );
};

export default AccountSettings; 