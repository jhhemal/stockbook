import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ConfirmProvider, ToastProvider } from './ui';
import './app.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </ToastProvider>
  </React.StrictMode>
);
