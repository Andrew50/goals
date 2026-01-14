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
    FormControlLabel,
    Switch,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    SelectChangeEvent,
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
    CalendarMonth,
    Sync,
    Send,
    Add,
    Delete,
    Telegram,
} from "@mui/icons-material";
import {
    privateRequest,
    getGoogleStatus,
    getGCalSettings,
    updateGCalSettings,
    getGoogleCalendars,
    unlinkGoogleAccount,
    getTelegramSettings,
    updateTelegramSettings,
    sendTelegramTest,
    getNotificationSettings,
    updateNotificationSettings,
    TelegramSettings,
    NotificationSettings,
    CalendarListEntry,
    GoogleStatusResponse,
    GCalSettingsResponse
} from "../../shared/utils/api";
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

    // Google Calendar state
    const [googleStatus, setGoogleStatus] = useState<GoogleStatusResponse | null>(null);
    const [gcalSettings, setGcalSettings] = useState<GCalSettingsResponse | null>(null);
    const [calendars, setCalendars] = useState<CalendarListEntry[]>([]);
    const [gcalLoading, setGcalLoading] = useState(false);

    // Telegram state
    const [telegramSettings, setTelegramSettings] = useState<TelegramSettings | null>(null);
    const [telegramBotToken, setTelegramBotToken] = useState("");
    const [telegramLoading, setTelegramLoading] = useState(false);

    // Notification Settings state
    const [notificationSettings, setNotificationSettings] = useState<NotificationSettings | null>(null);
    const [notificationSettingsLoading, setNotificationSettingsLoading] = useState(false);
    const [newOffset, setNewOffset] = useState("");

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
        loadGoogleCalendarSettings();
        loadTelegramSettings();
        loadNotificationSettings();
    }, []);

    const loadGoogleCalendarSettings = async () => {
        try {
            setGcalLoading(true);
            const [status, settings] = await Promise.all([
                getGoogleStatus(),
                getGCalSettings().catch(() => null),
            ]);
            setGoogleStatus(status);
            setGcalSettings(settings);

            // If Google is linked, load calendars
            if (status.linked) {
                try {
                    const calendarList = await getGoogleCalendars();
                    setCalendars(calendarList);
                } catch {
                    // Calendars might fail if permissions aren't granted
                    setCalendars([]);
                }
            }
        } catch (err) {
            console.error('Failed to load Google Calendar settings:', err);
        } finally {
            setGcalLoading(false);
        }
    };

    const loadTelegramSettings = async () => {
        try {
            setTelegramLoading(true);
            const settings = await getTelegramSettings();
            setTelegramSettings(settings);
        } catch (err) {
            console.error('Failed to load Telegram settings:', err);
        } finally {
            setTelegramLoading(false);
        }
    };

    const loadNotificationSettings = async () => {
        try {
            setNotificationSettingsLoading(true);
            const settings = await getNotificationSettings();
            setNotificationSettings(settings);
        } catch (err) {
            console.error('Failed to load notification settings:', err);
        } finally {
            setNotificationSettingsLoading(false);
        }
    };

    const handleTelegramSave = async () => {
        if (!telegramSettings) return;
        try {
            setTelegramLoading(true);
            await updateTelegramSettings({
                chat_id: telegramSettings.chat_id,
                bot_token: telegramBotToken || undefined,
            });
            setTelegramBotToken("");
            setSnackbarMessage('Telegram settings saved');
            loadTelegramSettings();
        } catch (err) {
            setError('Failed to save Telegram settings');
        } finally {
            setTelegramLoading(false);
        }
    };

    const handleTelegramTest = async () => {
        try {
            await sendTelegramTest();
            setSnackbarMessage('Test Telegram message sent!');
        } catch (err: any) {
            setError(err.response?.data || 'Failed to send test Telegram message');
        }
    };

    const handleNotificationSettingChange = async (key: keyof NotificationSettings, value: any) => {
        if (!notificationSettings) return;
        const updated = { ...notificationSettings, [key]: value };
        try {
            await updateNotificationSettings(updated);
            setNotificationSettings(updated);
            setSnackbarMessage('Notification settings updated');
        } catch (err) {
            setError('Failed to update notification settings');
        }
    };

    const handleAddOffset = async () => {
        if (!notificationSettings || !newOffset) return;
        const offset = parseInt(newOffset, 10);
        if (isNaN(offset)) return;
        if (notificationSettings.reminder_offsets_minutes.includes(offset)) return;

        const updated = {
            ...notificationSettings,
            reminder_offsets_minutes: [...notificationSettings.reminder_offsets_minutes, offset].sort((a, b) => a - b)
        };
        try {
            await updateNotificationSettings(updated);
            setNotificationSettings(updated);
            setNewOffset("");
            setSnackbarMessage('Reminder offset added');
        } catch (err) {
            setError('Failed to add reminder offset');
        }
    };

    const handleRemoveOffset = async (offset: number) => {
        if (!notificationSettings) return;
        const updated = {
            ...notificationSettings,
            reminder_offsets_minutes: notificationSettings.reminder_offsets_minutes.filter(o => o !== offset)
        };
        try {
            await updateNotificationSettings(updated);
            setNotificationSettings(updated);
            setSnackbarMessage('Reminder offset removed');
        } catch (err) {
            setError('Failed to remove reminder offset');
        }
    };

    const handleGcalAutoSyncChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const enabled = event.target.checked;
        try {
            const updated = await updateGCalSettings({ gcal_auto_sync_enabled: enabled });
            setGcalSettings(updated);
            setSnackbarMessage(enabled ? 'Auto-sync enabled' : 'Auto-sync disabled');
        } catch (err) {
            setError('Failed to update auto-sync setting');
        }
    };

    const handleDefaultCalendarChange = async (event: SelectChangeEvent<string>) => {
        const calendarId = event.target.value;
        try {
            const updated = await updateGCalSettings({ gcal_default_calendar_id: calendarId });
            setGcalSettings(updated);
            setSnackbarMessage('Default calendar updated');
        } catch (err) {
            setError('Failed to update default calendar');
        }
    };

    const handleUnlinkGoogleCalendar = async () => {
        if (!window.confirm('Are you sure you want to unlink your Google account? This will disable calendar sync.')) {
            return;
        }
        try {
            await unlinkGoogleAccount();
            setGoogleStatus({ linked: false, email: null, calendars_synced: 0 });
            setGcalSettings(null);
            setCalendars([]);
            setSnackbarMessage('Google account unlinked');
            loadAccountInfo(); // Reload account info
        } catch (err) {
            setError('Failed to unlink Google account');
        }
    };

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
                        Settings
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

                            {/* Notification Preferences Section */}
                            <Box sx={{ mb: 4 }}>
                                <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <NotificationsActive />
                                    Notification Preferences
                                </Typography>

                                {notificationSettingsLoading ? (
                                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                                        <CircularProgress size={24} />
                                    </Box>
                                ) : notificationSettings ? (
                                    <Card sx={{ mb: 2 }}>
                                        <CardContent>
                                            <FormControlLabel
                                                control={
                                                    <Switch
                                                        checked={notificationSettings.notifications_enabled}
                                                        onChange={(e) => handleNotificationSettingChange('notifications_enabled', e.target.checked)}
                                                    />
                                                }
                                                label="Enable all notifications"
                                                sx={{ mb: 2 }}
                                            />

                                            <Divider sx={{ my: 2 }} />

                                            <Typography variant="subtitle2" gutterBottom>Channels</Typography>
                                            <Box sx={{ display: 'flex', gap: 4, mb: 3 }}>
                                                <FormControlLabel
                                                    control={
                                                        <Switch
                                                            checked={notificationSettings.notify_via_push}
                                                            onChange={(e) => handleNotificationSettingChange('notify_via_push', e.target.checked)}
                                                            disabled={!notificationSettings.notifications_enabled}
                                                        />
                                                    }
                                                    label="Push"
                                                />
                                                <FormControlLabel
                                                    control={
                                                        <Switch
                                                            checked={notificationSettings.notify_via_telegram}
                                                            onChange={(e) => handleNotificationSettingChange('notify_via_telegram', e.target.checked)}
                                                            disabled={!notificationSettings.notifications_enabled}
                                                        />
                                                    }
                                                    label="Telegram"
                                                />
                                            </Box>

                                            <Typography variant="subtitle2" gutterBottom>What to notify on</Typography>
                                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 3 }}>
                                                <FormControlLabel
                                                    control={
                                                        <Switch
                                                            checked={notificationSettings.notify_high_priority_events}
                                                            onChange={(e) => handleNotificationSettingChange('notify_high_priority_events', e.target.checked)}
                                                            disabled={!notificationSettings.notifications_enabled}
                                                        />
                                                    }
                                                    label="High priority events (starting soon)"
                                                />
                                                <FormControlLabel
                                                    control={
                                                        <Switch
                                                            checked={notificationSettings.notify_event_reminders}
                                                            onChange={(e) => handleNotificationSettingChange('notify_event_reminders', e.target.checked)}
                                                            disabled={!notificationSettings.notifications_enabled}
                                                        />
                                                    }
                                                    label="Event reminders"
                                                />
                                            </Box>

                                            <Typography variant="subtitle2" gutterBottom>Reminder offsets (minutes before)</Typography>
                                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                                                {notificationSettings.reminder_offsets_minutes.map(offset => (
                                                    <Chip
                                                        key={offset}
                                                        label={offset >= 1440 ? `${offset / 1440}d (${offset}m)` : offset >= 60 ? `${offset / 60}h (${offset}m)` : `${offset}m`}
                                                        onDelete={() => handleRemoveOffset(offset)}
                                                        disabled={!notificationSettings.notifications_enabled}
                                                    />
                                                ))}
                                            </Box>
                                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                                <TextField
                                                    size="small"
                                                    label="Add offset (min)"
                                                    type="number"
                                                    value={newOffset}
                                                    onChange={(e) => setNewOffset(e.target.value)}
                                                    disabled={!notificationSettings.notifications_enabled}
                                                />
                                                <IconButton 
                                                    onClick={handleAddOffset} 
                                                    disabled={!newOffset || !notificationSettings.notifications_enabled}
                                                    color="primary"
                                                >
                                                    <Add />
                                                </IconButton>
                                            </Box>
                                        </CardContent>
                                    </Card>
                                ) : (
                                    <Typography color="text.secondary">Failed to load notification settings</Typography>
                                )}
                            </Box>

                            <Divider sx={{ mb: 4 }} />

                            {/* Telegram Section */}
                            <Box sx={{ mb: 4 }}>
                                <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Telegram />
                                    Telegram Bot Config
                                </Typography>

                                {telegramLoading ? (
                                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                                        <CircularProgress size={24} />
                                    </Box>
                                ) : telegramSettings ? (
                                    <Card sx={{ mb: 2 }}>
                                        <CardContent>
                                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                                <TextField
                                                    fullWidth
                                                    label="Telegram Chat ID"
                                                    value={telegramSettings.chat_id || ""}
                                                    onChange={(e) => setTelegramSettings({ ...telegramSettings, chat_id: e.target.value })}
                                                    placeholder="e.g. 123456789"
                                                    helperText="Use @userinfobot or similar to find your ID"
                                                />
                                                <TextField
                                                    fullWidth
                                                    label="Telegram Bot Token"
                                                    type="password"
                                                    value={telegramBotToken}
                                                    onChange={(e) => setTelegramBotToken(e.target.value)}
                                                    placeholder={telegramSettings.has_bot_token ? "•••••••••••• (saved)" : "Your bot token from @BotFather"}
                                                    helperText={telegramSettings.has_bot_token ? "Leave blank to keep existing token" : "Enter the API token for your personal bot"}
                                                />
                                                <Box sx={{ display: 'flex', gap: 2 }}>
                                                    <Button
                                                        variant="contained"
                                                        onClick={handleTelegramSave}
                                                        disabled={telegramLoading}
                                                    >
                                                        Save Telegram Config
                                                    </Button>
                                                    <Button
                                                        variant="outlined"
                                                        startIcon={<Send />}
                                                        onClick={handleTelegramTest}
                                                        disabled={!telegramSettings.has_bot_token && !telegramBotToken}
                                                    >
                                                        Send Test Message
                                                    </Button>
                                                </Box>
                                            </Box>
                                        </CardContent>
                                    </Card>
                                ) : (
                                    <Typography color="text.secondary">Failed to load Telegram settings</Typography>
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

                            <Divider sx={{ mb: 4 }} />

                            {/* Google Calendar Settings */}
                            <Box sx={{ mb: 4 }}>
                                <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <CalendarMonth />
                                    Google Calendar Sync
                                </Typography>

                                {gcalLoading ? (
                                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                                        <CircularProgress size={24} />
                                    </Box>
                                ) : googleStatus?.linked ? (
                                    <Card sx={{ mb: 2 }}>
                                        <CardContent>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                                                <Sync color="success" />
                                                <Box sx={{ flexGrow: 1 }}>
                                                    <Typography variant="subtitle1">
                                                        Google Account Linked
                                                    </Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        {googleStatus.email}
                                                    </Typography>
                                                    {googleStatus.calendars_synced > 0 && (
                                                        <Chip 
                                                            label={`${googleStatus.calendars_synced} calendar(s) synced`} 
                                                            size="small" 
                                                            color="primary" 
                                                            sx={{ mt: 1 }}
                                                        />
                                                    )}
                                                </Box>
                                                <IconButton
                                                    onClick={handleUnlinkGoogleCalendar}
                                                    title="Unlink Google account"
                                                    color="error"
                                                >
                                                    <LinkOff />
                                                </IconButton>
                                            </Box>

                                            <Divider sx={{ my: 2 }} />

                                            {/* Auto-sync toggle */}
                                            <FormControlLabel
                                                control={
                                                    <Switch
                                                        checked={gcalSettings?.gcal_auto_sync_enabled || false}
                                                        onChange={handleGcalAutoSyncChange}
                                                    />
                                                }
                                                label={
                                                    <Box>
                                                        <Typography variant="body1">Auto-sync (every 15 minutes)</Typography>
                                                        <Typography variant="body2" color="text.secondary">
                                                            Automatically sync events between Goals and Google Calendar
                                                        </Typography>
                                                    </Box>
                                                }
                                                sx={{ mb: 2, alignItems: 'flex-start' }}
                                            />

                                            {/* Default calendar selector */}
                                            {calendars.length > 0 && (
                                                <FormControl fullWidth sx={{ mt: 2 }}>
                                                    <InputLabel id="default-calendar-label">Default Calendar</InputLabel>
                                                    <Select
                                                        labelId="default-calendar-label"
                                                        value={gcalSettings?.gcal_default_calendar_id || 'primary'}
                                                        label="Default Calendar"
                                                        onChange={handleDefaultCalendarChange}
                                                    >
                                                        {calendars.map((cal) => (
                                                            <MenuItem key={cal.id} value={cal.id}>
                                                                {cal.summary} {cal.primary && '(Primary)'}
                                                            </MenuItem>
                                                        ))}
                                                    </Select>
                                                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                                                        New events will sync to this calendar by default
                                                    </Typography>
                                                </FormControl>
                                            )}
                                        </CardContent>
                                    </Card>
                                ) : (
                                    <Card sx={{ mb: 2 }}>
                                        <CardContent>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                                <Google color="disabled" />
                                                <Box sx={{ flexGrow: 1 }}>
                                                    <Typography variant="subtitle1">
                                                        Google Calendar Not Connected
                                                    </Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        Link your Google account to sync events with Google Calendar
                                                    </Typography>
                                                </Box>
                                            </Box>
                                            <Button
                                                variant="contained"
                                                startIcon={<Google />}
                                                onClick={handleLinkGoogle}
                                                sx={{ mt: 2 }}
                                            >
                                                Connect Google Calendar
                                            </Button>
                                        </CardContent>
                                    </Card>
                                )}

                                <Typography variant="body2" color="text.secondary">
                                    Google Calendar sync allows you to import events from Google Calendar and export your scheduled events.
                                    You can also use the Sync button in the Calendar view for manual syncing.
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