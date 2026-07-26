import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { initSentry } from './lib/sentry-client';
import App from './App.tsx';
import { LanguageProvider } from './lib/i18n.tsx';
import './index.css';

if (import.meta.env.VITE_SENTRY_DSN) {
  initSentry();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </StrictMode>,
);
