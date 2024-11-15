import React from 'react';
import { BrowserRouter as Router, Route, Routes, Link } from 'react-router-dom';
import Dayview from './components/Dayview';
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
          <Route path="/" element={<Dayview/>} />
      </Routes>
    </Router>
  );
};

export default App;