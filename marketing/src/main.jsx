import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.jsx';
import { installScrollProofNumberInputs } from './utils/scrollProofNumberInputs.js';

// S81 — globally blur focused <input type="number"> on wheel events so
// touchpad / mouse-wheel scrolls don't silently mutate price/qty fields.
installScrollProofNumberInputs();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
