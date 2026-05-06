import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { installScrollProofNumberInputs } from './utils/scrollProofNumberInputs.js';

// S81 — globally blur focused <input type="number"> on wheel events so
// touchpad / mouse-wheel scrolls don't silently mutate price/qty fields.
installScrollProofNumberInputs();

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
);
