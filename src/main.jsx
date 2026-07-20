import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './media-layout.css';
import './public.css';

function registerMediaRoomServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    const manifestUrl = document.querySelector('link[rel="manifest"]')?.href;
    if (!manifestUrl) return;
    const workerUrl = new URL('sw.js', manifestUrl);
    const scope = new URL('./', manifestUrl).pathname;
    navigator.serviceWorker.register(workerUrl, { scope }).catch(() => {
      // Installation support is progressive; the web experience remains usable.
    });
  });
}

registerMediaRoomServiceWorker();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
