// Sync session from localStorage to sessionStorage if transferring tabs
(function () {
  try {
    const payloadStr = localStorage.getItem('nesture_session_transfer_payload');
    if (payloadStr) {
      const payload = JSON.parse(payloadStr);
      // Only restore if the payload is fresh (less than 15 seconds old)
      if (payload && typeof payload === 'object' && Date.now() - payload.timestamp < 15000) {
        Object.entries(payload.sessionStorageData || {}).forEach(([key, val]) => {
          sessionStorage.setItem(key, val);
        });
      }
      localStorage.removeItem('nesture_session_transfer_payload');
    }
  } catch (err) {
    console.error('[SessionSync] Failed to sync session:', err);
  }
})();

import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n';
import App from './App';
import { initDB } from './services/localDB.js';

// Open IndexedDB and seed demo data before the app renders.
// The await ensures no component ever races with un-initialised data.
initDB().then(() => {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}).catch((err) => {
  console.error('[NestureAI] Failed to initialise local database:', err);
  // Render the app anyway so the user sees an error rather than a blank screen
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});

