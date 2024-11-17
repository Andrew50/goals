import React from 'react';
import { BrowserRouter as Router, Route, Routes, Link } from 'react-router-dom';
import Dayview from './components/Dayview';
import Signup from './components/Signup';
import Signin from './components/Signin';
import Root from './components/Root';
import Goals from './components/Goals';
import './styles/global.css';

const App: React.FC = () => {
  return (
    <Router>
      <nav style={{
        backgroundColor: '#333',
        padding: '1rem',
        marginBottom: '20px'
      }}>
        <ul style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', gap: '20px' }}>
            <li><Link to="/" style={linkStyle}>Home</Link></li>
            <li><Link to="/goals" style={linkStyle}>Goals</Link></li>
            <li><Link to="/calender" style={linkStyle}>Calendar</Link></li>
          </div>
          <div style={{ display: 'flex', gap: '20px' }}>
            <li><Link to="/signin" style={linkStyle}>Sign In</Link></li>
            <li><Link to="/signup" style={linkStyle}>Sign Up</Link></li>
          </div>
        </ul>
      </nav>
      <Routes>
        <Route path="/calender" element={<Dayview />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/signin" element={<Signin />} />
        <Route path="/" element={<Root />} />
        <Route path="/goals" element={<Goals />} />
      </Routes>
    </Router>
  );
};

const linkStyle = {
  color: 'white',
  textDecoration: 'none',
  ':hover': {
    textDecoration: 'underline'
  }
};

export default App;
