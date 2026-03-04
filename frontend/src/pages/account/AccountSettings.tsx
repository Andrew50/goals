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
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
} from "@mui/material";
import {
    Google,
    Key,
    LinkOff,
    Sync,
    Send,
    Add,
} from "@mui/icons-material";
import { useTheme } from "../../shared/contexts/ThemeContext";
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

    // Telegram Dialog state
    const [telegramDialogOpen, setTelegramDialogOpen] = useState(false);

    // Theme context
    const { themeName, setTheme, availableThemes } = useTheme();

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
                            {/* Account */}
                            <Box sx={{ mb: 4 }}>
                                <Typography variant="h6" gutterBottom>
                                    Account
                                </Typography>
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    {/* Auth Method Bubbles */}
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                                        {/* Password Auth Bubble */}
                                        {hasPasswordAuth ? (
                                            <Chip
                                                icon={<Key />}
                                                label="Password"
                                                sx={{
                                                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                                    color: 'text.primary',
                                                    '& .MuiChip-icon': {
                                                        color: 'text.secondary',
                                                    },
                                                }}
                                            />
                                        ) : (
                                            !showPasswordForm ? (
                                                <Button
                                                    variant="outlined"
                                                    size="small"
                                                    startIcon={<Key />}
                                                    onClick={() => setShowPasswordForm(true)}
                                                >
                                                    Set Password
                                                </Button>
                                            ) : (
                                                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                                    <TextField
                                                        size="small"
                                                        label="New Password"
                                                        type="password"
                                                        value={password}
                                                        onChange={(e) => setPassword(e.target.value)}
                                                        required
                                                        sx={{ width: 180 }}
                                                    />
                                                    <Button type="submit" variant="contained" size="small" onClick={handleSetPassword}>
                                                        Save
                                                    </Button>
                                                    <Button
                                                        variant="outlined"
                                                        size="small"
                                                        onClick={() => {
                                                            setShowPasswordForm(false);
                                                            setPassword("");
                                                        }}
                                                    >
                                                        Cancel
                                                    </Button>
                                                </Box>
                                            )
                                        )}

                                        {/* Google Auth Bubble */}
                                        {hasGoogleAuth ? (
                                            <Chip
                                                icon={<Google />}
                                                label="Google"
                                                onDelete={hasPasswordAuth ? handleUnlinkGoogle : undefined}
                                                deleteIcon={<LinkOff />}
                                                sx={{
                                                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                                    color: 'text.primary',
                                                    '& .MuiChip-icon': {
                                                        color: 'text.secondary',
                                                    },
                                                }}
                                            />
                                        ) : (
                                            <Button
                                                variant="outlined"
                                                size="small"
                                                startIcon={<Google />}
                                                onClick={handleLinkGoogle}
                                            >
                                                Link Google
                                            </Button>
                                        )}
                                    </Box>

                                    {account.display_name && (
                                        <Typography variant="body2" color="text.secondary">
                                            {account.display_name}
                                        </Typography>
                                    )}
                                </Box>
                            </Box>

                            <Divider sx={{ mb: 4 }} />

                            {/* Notifications Section */}
                            <Box sx={{ mb: 4 }}>
                                <Typography variant="h6" gutterBottom>
                                    Notifications
                                </Typography>

                                {notificationSettingsLoading ? (
                                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                                        <CircularProgress size={24} />
                                    </Box>
                                ) : notificationSettings ? (
                                    <Card sx={{ mb: 2 }}>
                                        <CardContent sx={{ '& .MuiFormControlLabel-root': { marginLeft: 0, marginRight: 0 } }}>
                                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                                <FormControlLabel
                                                    sx={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 1,
                                                        '& .MuiSwitch-root': { margin: 0 },
                                                    }}
                                                    control={
                                                        <Switch
                                                            checked={notificationSettings.notify_high_priority_events}
                                                            onChange={(e) => handleNotificationSettingChange('notify_high_priority_events', e.target.checked)}
                                                        />
                                                    }
                                                    label="High priority events (starting soon)"
                                                />
                                                <FormControlLabel
                                                    sx={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 1,
                                                        '& .MuiSwitch-root': { margin: 0 },
                                                    }}
                                                    control={
                                                        <Switch
                                                            checked={notificationSettings.notify_event_reminders}
                                                            onChange={(e) => handleNotificationSettingChange('notify_event_reminders', e.target.checked)}
                                                        />
                                                    }
                                                    label="Event reminders"
                                                />

                                                <Box sx={{ mt: 1 }}>
                                                    <Typography variant="body2" color="text.secondary" gutterBottom>
                                                        Reminder offsets (minutes before)
                                                    </Typography>
                                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
                                                        {notificationSettings.reminder_offsets_minutes.map(offset => (
                                                            <Chip
                                                                key={offset}
                                                                size="small"
                                                                label={offset >= 1440 ? `${offset / 1440}d` : offset >= 60 ? `${offset / 60}h` : `${offset}m`}
                                                                onDelete={() => handleRemoveOffset(offset)}
                                                            />
                                                        ))}
                                                    </Box>
                                                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                                        <TextField
                                                            size="small"
                                                            label="Add (min)"
                                                            type="number"
                                                            value={newOffset}
                                                            onChange={(e) => setNewOffset(e.target.value)}
                                                            sx={{ width: 100 }}
                                                        />
                                                        <IconButton
                                                            onClick={handleAddOffset}
                                                            disabled={!newOffset}
                                                            color="primary"
                                                            size="small"
                                                        >
                                                            <Add />
                                                        </IconButton>
                                                    </Box>
                                                </Box>
                                            </Box>
                                        </CardContent>
                                    </Card>
                                ) : (
                                    <Typography color="text.secondary">Failed to load notification settings</Typography>
                                )}
                            </Box>

                            <Divider sx={{ mb: 4 }} />

                            {/* Integrations */}
                            <Box sx={{ mb: 4 }}>
                                <Typography variant="h6" gutterBottom>
                                    Integrations
                                </Typography>

                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    {/* Google Calendar Integration */}
                                    {gcalLoading ? (
                                        <CircularProgress size={24} />
                                    ) : googleStatus?.linked ? (
                                        <Card>
                                            <CardContent>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
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
                                                                sx={{ mt: 0.5 }}
                                                            />
                                                        )}
                                                    </Box>
                                                    <IconButton
                                                        onClick={handleUnlinkGoogleCalendar}
                                                        title="Unlink Google account"
                                                        color="error"
                                                        size="small"
                                                    >
                                                        <LinkOff />
                                                    </IconButton>
                                                </Box>

                                                <FormControlLabel
                                                    control={
                                                        <Switch
                                                            checked={gcalSettings?.gcal_auto_sync_enabled || false}
                                                            onChange={handleGcalAutoSyncChange}
                                                            size="small"
                                                        />
                                                    }
                                                    label="Auto-sync (every 15 minutes)"
                                                    sx={{ mb: 1 }}
                                                />

                                                {calendars.length > 0 && (
                                                    <FormControl fullWidth size="small" sx={{ mt: 1 }}>
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
                                                    </FormControl>
                                                )}
                                            </CardContent>
                                        </Card>
                                    ) : (
                                        <Card>
                                            <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                                    <Google color="action" />
                                                    <Box>
                                                        <Typography variant="subtitle1">Google Calendar</Typography>
                                                        <Typography variant="body2" color="text.secondary">
                                                            Not connected
                                                        </Typography>
                                                    </Box>
                                                </Box>
                                                <Button
                                                    variant="outlined"
                                                    size="small"
                                                    onClick={handleLinkGoogle}
                                                >
                                                    Connect
                                                </Button>
                                            </CardContent>
                                        </Card>
                                    )}

                                    {/* Telegram Config */}
                                    <Card>
                                        <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                                <Send color="action" />
                                                <Box>
                                                    <Typography variant="subtitle1">Telegram</Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        {telegramSettings?.has_bot_token ? 'Configured' : 'Not configured'}
                                                    </Typography>
                                                </Box>
                                            </Box>
                                            <Button
                                                variant="outlined"
                                                size="small"
                                                onClick={() => setTelegramDialogOpen(true)}
                                            >
                                                Configure
                                            </Button>
                                        </CardContent>
                                    </Card>
                                </Box>
                            </Box>

                            <Divider sx={{ mb: 4 }} />

                            {/* Appearance / Theme Section */}
                            <Box sx={{ mb: 4 }}>
                                <Typography variant="h6" gutterBottom>
                                    Appearance
                                </Typography>

                                <Card sx={{ mb: 2 }}>
                                    <CardContent>
                                        <Typography variant="subtitle2" gutterBottom>Color Theme</Typography>
                                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                                            {availableThemes.map((t) => (
                                                <Button
                                                    key={t.name}
                                                    variant={themeName === t.name ? 'contained' : 'outlined'}
                                                    onClick={() => setTheme(t.name)}
                                                    sx={{
                                                        minWidth: 100,
                                                        borderColor: themeName === t.name ? undefined : t.preview,
                                                        backgroundColor: themeName === t.name ? t.preview : undefined,
                                                        color: themeName === t.name ? '#fff' : t.preview,
                                                        '&:hover': {
                                                            backgroundColor: themeName === t.name
                                                                ? t.preview
                                                                : `${t.preview}20`,
                                                        },
                                                    }}
                                                >
                                                    {t.label}
                                                </Button>
                                            ))}
                                        </Box>
                                    </CardContent>
                                </Card>
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

            {/* Telegram Config Dialog */}
            <Dialog open={telegramDialogOpen} onClose={() => setTelegramDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Telegram Configuration</DialogTitle>
                <DialogContent>
                    {telegramLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                            <CircularProgress size={24} />
                        </Box>
                    ) : telegramSettings ? (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                            <TextField
                                fullWidth
                                size="small"
                                label="Telegram Chat ID"
                                value={telegramSettings.chat_id || ""}
                                onChange={(e) => setTelegramSettings({ ...telegramSettings, chat_id: e.target.value })}
                                placeholder="e.g. 123456789"
                                helperText="Use @userinfobot or similar to find your ID"
                            />
                            <TextField
                                fullWidth
                                size="small"
                                label="Telegram Bot Token"
                                type="password"
                                value={telegramBotToken}
                                onChange={(e) => setTelegramBotToken(e.target.value)}
                                placeholder={telegramSettings.has_bot_token ? "•••••••••••• (saved)" : "Your bot token from @BotFather"}
                                helperText={telegramSettings.has_bot_token ? "Leave blank to keep existing token" : "Enter the API token for your personal bot"}
                            />
                            <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                                <Button
                                    variant="contained"
                                    onClick={handleTelegramSave}
                                    disabled={telegramLoading}
                                    size="small"
                                >
                                    Save
                                </Button>
                                <Button
                                    variant="outlined"
                                    startIcon={<Send />}
                                    onClick={handleTelegramTest}
                                    disabled={!telegramSettings.has_bot_token && !telegramBotToken}
                                    size="small"
                                >
                                    Send Test
                                </Button>
                            </Box>
                        </Box>
                    ) : (
                        <Typography color="text.secondary">Failed to load Telegram settings</Typography>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setTelegramDialogOpen(false)} size="small">
                        Close
                    </Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
};

export default AccountSettings; 