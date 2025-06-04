import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Container, Box, Paper, Typography, TextField, Button, Alert, Divider } from "@mui/material";
import { useAuth } from "../../shared/contexts/AuthContext";

const Signin: React.FC = () => {
  const { login, googleLogin, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | React.ReactNode | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) {
      const destination = location.state?.from || '/';
      navigate(destination, { replace: true });
    }
  }, [isAuthenticated, navigate, location]);

  const handleSignin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    try {
      const message = await login(username, password);
      setSuccess(message);
      navigate("/day");
    } catch (err: any) {
      let errorMessage = err.message || "An error occurred during sign in";

      // Check for specific error messages and provide helpful guidance
      if (errorMessage.includes("Google sign-in")) {
        setError(
          <div>
            {errorMessage}
            <br />
            <br />
            <Button
              variant="outlined"
              startIcon={<img src="https://developers.google.com/identity/images/g-logo.png" alt="Google" style={{ width: 16, height: 16 }} />}
              onClick={handleGoogleSignin}
              sx={{ mt: 1 }}
            >
              Sign in with Google instead
            </Button>
          </div>
        );
      } else {
        setError(errorMessage);
      }
    }
  };

  const handleGoogleSignin = async () => {
    setError(null);
    setSuccess(null);

    try {
      await googleLogin("");
      // The googleLogin function will redirect to Google, so we won't reach here normally
    } catch (err: any) {
      setError(err.message || "An error occurred during Google sign in");
    }
  };

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
        <Paper elevation={3} sx={{ p: 4, width: '100%' }}>
          <Typography component="h1" variant="h5" sx={{ mb: 3, textAlign: 'center' }}>
            Sign In
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

          <form onSubmit={handleSignin}>
            <TextField
              margin="normal"
              required
              fullWidth
              label="Username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <TextField
              margin="normal"
              required
              fullWidth
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button
              type="submit"
              fullWidth
              variant="contained"
              sx={{ mt: 3, mb: 2 }}
            >
              Sign In
            </Button>
          </form>

          <Divider sx={{ my: 2 }}>
            <Typography variant="body2" color="text.secondary">
              OR
            </Typography>
          </Divider>

          <Button
            fullWidth
            variant="outlined"
            onClick={handleGoogleSignin}
            sx={{
              mt: 1,
              mb: 2,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              textTransform: 'none'
            }}
          >
            <img
              src="https://developers.google.com/identity/images/g-logo.png"
              alt="Google logo"
              style={{ width: 20, height: 20 }}
            />
            Sign in with Google
          </Button>
        </Paper>
      </Box>
    </Container>
  );
};

export default Signin;

