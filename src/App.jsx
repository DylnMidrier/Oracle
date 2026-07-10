import { HashRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Training from './pages/Training.jsx';
import Health from './pages/Health.jsx';
import WorldWatch from './pages/WorldWatch.jsx';
import Taches from './pages/Taches.jsx';

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/entrainement" element={<Training />} />
        <Route path="/sante" element={<Health />} />
        <Route path="/veille" element={<WorldWatch />} />
        <Route path="/taches" element={<Taches />} />
      </Routes>
    </HashRouter>
  );
}

export default App;
