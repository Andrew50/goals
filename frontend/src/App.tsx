import React from 'react';
import { BrowserRouter as Router, Route, Routes, Link, useNavigate } from 'react-router-dom';
import { ThemeProvider, AppBar, Toolbar, Button, Box, CssBaseline } from '@mui/material';
import { theme } from './shared/styles/theme';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

// Import CSS files in correct order
import './index.css';
import './shared/styles/global.css';
import './App.css';

import Calendar from './pages/calendar/Calendar';
import Signup from './pages/signup/Signup';
import Signin from './pages/signin/Signin';
import Root from './pages/root/Root';
import Network from './pages/network/Network';
import GoalMenu from './shared/components/GoalMenu';
import List from './pages/list/List';
import Day from './pages/day/Day';
import { AuthProvider, useAuth } from './shared/contexts/AuthContext';
import ProtectedRoute from './shared/components/ProtectedRoute';

const NavBar: React.FC = () => {
  const { isAuthenticated, logout, username } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = () => {
    logout();
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
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          {isAuthenticated ? (
            <>
              <Box sx={{ typography: 'body1', color: 'inherit' }}>{username}</Box>
              <Button color="inherit" onClick={handleSignOut}>Sign Out</Button>
            </>
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
        <DndProvider backend={HTML5Backend}>
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
        </DndProvider>
      </ThemeProvider>
    </AuthProvider>
  );
};

export default App;
