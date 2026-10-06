import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

// createRoot, not the React 17 ReactDOM.render. The legacy call still works in
// React 18 but logs a deprecation warning and, unlike createRoot, does not
// enable StrictMode's double-mount — which is what had been masking the
// double socket connect in EditorPage's effect.
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

reportWebVitals();