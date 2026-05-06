import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/global.css';
import App from './App';
import { installScrollProofNumberInputs } from './utils/scrollProofNumberInputs.js';

// S81 — globally blur focused <input type="number"> on wheel events so
// touchpad / mouse-wheel scrolls don't silently mutate price/qty fields.
installScrollProofNumberInputs();

const root = document.getElementById('root');
if (!root) throw new Error('Admin app: #root element not found in index.html');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
