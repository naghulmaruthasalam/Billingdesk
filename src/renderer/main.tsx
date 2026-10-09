import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './index.css';
import { App } from './App';
import { AuthProvider } from './hooks/useAuth';
import { ToastProvider } from './components/ui/toast';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </HashRouter>
  </React.StrictMode>,
);
