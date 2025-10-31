import React from 'react';
import { BrowserRouter as Router, Route, Routes, Link, useNavigate } from 'react-router-dom';
import { ThemeProvider, AppBar, Toolbar, Button, Box, CssBaseline } from '@mui/material';
import { theme } from './shared/styles/theme';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { AuthProvider, useAuth } from './shared/contexts/AuthContext';
import ProtectedRoute from './shared/components/ProtectedRoute';
import { GoalMenuProvider } from './shared/contexts/GoalMenuContext';

// Import CSS files in correct order
import './index.css';
import './shared/styles/global.css';
import './App.css';

import Calendar from './pages/calendar/Calendar';
import Signup from './pages/signup/Signup';
import Signin from './pages/signin/Signin';
// import Root from './pages/root/Root';
import Network from './pages/network/Network';
import List from './pages/list/List';
import Day from './pages/day/Day';
// import Query from './pages/query/Query';
import Achievements from './pages/achievements/Achievements';
import Stats from './pages/stats/Stats';
import GoogleCallback from './pages/auth/GoogleCallback';

const NavBar: React.FC = () => {
  const { isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = () => {
    logout();
    navigate('/');
  };

  return (
    <AppBar position="static">
      <Toolbar sx={{ flexWrap: 'nowrap' }}>
        <Box sx={{ flexGrow: 1, display: 'flex', gap: 2, minWidth: 0 }}>
          <Button color="inherit" component={Link} to="/day">Day</Button>
          <Button color="inherit" component={Link} to="/calendar">Calendar</Button>
          <Button color="inherit" component={Link} to="/network">Network</Button>
          <Button color="inherit" component={Link} to="/achievements">Achievements</Button>
          <Button color="inherit" component={Link} to="/stats">Stats</Button>
          <Button color="inherit" component={Link} to="/list">List</Button>
          {/* <Button color="inherit" component={Link} to="/query">Query</Button> */}
        </Box>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {isAuthenticated ? (
            <>
              {/* <Box sx={{ typography: 'body1', color: 'inherit' }}>{username}</Box> */}
              <Button color="inherit" onClick={handleSignOut} sx={{ whiteSpace: 'nowrap' }}>Sign Out</Button>
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
    <GoogleOAuthProvider clientId={process.env.REACT_APP_GOOGLE_CLIENT_ID || ''}>
      <AuthProvider>
        <GoalMenuProvider>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <DndProvider backend={HTML5Backend}>
              <HotkeysProvider>
                <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
                        <Route path="/auth/callback" element={<GoogleCallback />} />
                        {/* <Route path="/" element={<Root />} /> */}
                        <Route path="/" element={
                          <ProtectedRoute>
                            <Calendar />
                          </ProtectedRoute>
                        } />

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
                        <Route path="/achievements" element={
                          <ProtectedRoute>
                            <Achievements />
                          </ProtectedRoute>
                        } />
                        <Route path="/stats" element={
                          <ProtectedRoute>
                            <Stats />
                          </ProtectedRoute>
                        } />
                        {/* <Route path="/query" element={
                          <ProtectedRoute>
                            <Query />
                          </ProtectedRoute>
                        } /> */}
                      </Routes>
                    </Box>
                  </Box>
                </Router>
              </HotkeysProvider>
            </DndProvider>
          </ThemeProvider>
        </GoalMenuProvider>
      </AuthProvider>
    </GoogleOAuthProvider>
  );
};

export default App;
