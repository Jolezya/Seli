import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Register the service worker. A new one takes over as soon as it is ready, so
// a deploy actually reaches an installed PWA instead of sitting behind a stale
// cache (spec §10, §14 trap #2).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            // New code is ready and an old worker was in charge: take over now.
            installing.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    }).catch(() => { /* offline support is a bonus, never a blocker */ });

    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  });
}
