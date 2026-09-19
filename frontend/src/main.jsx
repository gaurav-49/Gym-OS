import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from './theme';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { ToastProvider } from './components/ui/Toast.jsx';
import { ConfirmProvider } from './components/ui/ConfirmDialog.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* Toast and Confirm sit above the error boundary so a page that throws
          still tears down cleanly, and below the theme so both are styled. */}
      <ErrorBoundary>
        <ToastProvider>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </ToastProvider>
      </ErrorBoundary>
    </ThemeProvider>
  </React.StrictMode>
);
