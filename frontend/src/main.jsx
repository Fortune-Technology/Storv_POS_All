import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import store from './store'
import './index.css'
import App from './App.jsx'
import { installScrollProofNumberInputs } from './utils/scrollProofNumberInputs.js'

// S81 — globally blur focused <input type="number"> on wheel events so
// touchpad / mouse-wheel scrolls don't silently mutate price/qty fields.
installScrollProofNumberInputs()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>,
)
