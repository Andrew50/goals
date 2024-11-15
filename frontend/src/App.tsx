import React from 'react';
import { BrowserRouter as Router, Route, Switch, Link } from 'react-router-dom';
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
      <Switch>
          <Route exact path="/" component={Dayview} />
      </Switch>
    </Router>
  );
};

export default App;