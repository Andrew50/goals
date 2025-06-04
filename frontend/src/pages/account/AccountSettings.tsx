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
} from "@mui/material";
import { Google, Key, Link, LinkOff } from "@mui/icons-material";
import { privateRequest } from "../../shared/utils/api";

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
                        </>
                    )}
                </Paper>
            </Box>
        </Container>
    );
};

export default AccountSettings; 