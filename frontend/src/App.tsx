import React from 'react';
import { BrowserRouter as Router, Route, Routes, Link } from 'react-router-dom';
import Dayview from './components/Dayview';
import Signup from './components/Signup';
import Signin from './components/Signin';
import Root from './components/Root';
import './styles/global.css';

const App: React.FC = () => {
  return (
    <Router>
      <nav>
        <ul>
          <li><Link to="/">Dayview</Link></li>
        </ul>
      </nav>
      <Routes>
          <Route path="/calender" element={<Dayview/>} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/signin" element={<Signin />} />
          <Route path="/" element={<Root />} />
      </Routes>
    </Router>
  );
};

export default App;
