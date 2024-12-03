import React from 'react';
import { BrowserRouter as Router, Route, Routes, Link, useNavigate } from 'react-router-dom';
import { ThemeProvider, AppBar, Toolbar, Button, Box, CssBaseline } from '@mui/material';
import { theme } from './styles/theme';

// Import CSS files in correct order
import './index.css';
import './styles/global.css';
import './App.css';

import Calendar from './components/Calendar';
import Signup from './components/Signup';
import Signin from './components/Signin';
import Root from './components/Root';
import Network from './components/Network';
import GoalMenu from './components/GoalMenu';
import List from './components/List';
import Day from './components/Day';
import Welcome from './components/Welcome';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

const NavBar: React.FC = () => {
  const { isAuthenticated, setIsAuthenticated } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = () => {
    localStorage.removeItem('authToken');
    setIsAuthenticated(false);
    navigate('/');
  };

  return (
    <AppBar position="static">
      <Toolbar>
        <Box sx={{ flexGrow: 1, display: 'flex', gap: 2 }}>
          <Button color="inherit" component={Link} to="/">Home</Button>
          <Button color="inherit" component={Link} to="/network">Network</Button>
          <Button color="inherit" component={Link} to="/calendar">Calendar</Button>
          <Button color="inherit" component={Link} to="/list">List</Button>
          <Button color="inherit" component={Link} to="/day">Day</Button>
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          {isAuthenticated ? (
            <Button color="inherit" onClick={handleSignOut}>Sign Out</Button>
          ) : (
            <>
              <Button color="inherit" component={Link} to="/signin">Sign In</Button>
              <Button color="inherit" component={Link} to="/signup">Sign Up</Button>
            </>
          )}
        </Box>
      </Toolbar>
    </AppBar>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Router>
          <Box sx={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'background.default',
            color: 'text.primary'
          }}>
            <NavBar />
            <Box sx={{
              flexGrow: 1,
              overflow: 'auto'
            }}>
              <Routes>
                <Route path="/signup" element={<Signup />} />
                <Route path="/signin" element={<Signin />} />
                <Route path="/welcome" element={<Welcome />} />
                <Route path="/" element={<Root />} />

                {/* Protected Routes */}
                <Route path="/calendar" element={
                  <ProtectedRoute>
                    <Calendar />
                  </ProtectedRoute>
                } />
                <Route path="/network" element={
                  <ProtectedRoute>
                    <Network />
                  </ProtectedRoute>
                } />
                <Route path="/list" element={
                  <ProtectedRoute>
                    <List />
                  </ProtectedRoute>
                } />
                <Route path="/day" element={
                  <ProtectedRoute>
                    <Day />
                  </ProtectedRoute>
                } />
              </Routes>
            </Box>
            <GoalMenu />
          </Box>
        </Router>
      </ThemeProvider>
    </AuthProvider>
  );
};

export default App;
