import React from 'react';
import { BrowserRouter as Router, Route, Routes, Link } from 'react-router-dom';
import { ThemeProvider, AppBar, Toolbar, Button, Box } from '@mui/material';
import { theme } from './styles/theme';
import Dayview from './components/Dayview';
import Signup from './components/Signup';
import Signin from './components/Signin';
import Root from './components/Root';
import Goals from './components/Goals';

const App: React.FC = () => {
  return (
    <ThemeProvider theme={theme}>
      <Router>
        <AppBar position="static">
          <Toolbar>
            <Box sx={{ flexGrow: 1, display: 'flex', gap: 2 }}>
              <Button color="inherit" component={Link} to="/">Home</Button>
              <Button color="inherit" component={Link} to="/goals">Goals</Button>
              <Button color="inherit" component={Link} to="/calender">Calendar</Button>
            </Box>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button color="inherit" component={Link} to="/signin">Sign In</Button>
              <Button color="inherit" component={Link} to="/signup">Sign Up</Button>
            </Box>
          </Toolbar>
        </AppBar>
        <Routes>
          <Route path="/calender" element={<Dayview />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/signin" element={<Signin />} />
          <Route path="/" element={<Root />} />
          <Route path="/goals" element={<Goals />} />
        </Routes>
      </Router>
    </ThemeProvider>
  );
};

export default App;
