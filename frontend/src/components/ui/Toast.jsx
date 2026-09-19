// frontend/src/components/ui/Toast.jsx
// Transient success/error feedback.
//
// Every page used to report success through an inline <Alert> that pushed the
// table down the moment it appeared and then stayed on screen forever — so the
// content jumped on every save and the page slowly filled with stale banners.
// A toast says the same thing without moving anything and clears itself.
//
//   const toast = useToast();
//   toast.success('Payment recorded.');
//   toast.error('Could not reach the server.');
//
// Inline <Alerts> is still the right control for *validation* messages that
// belong next to the field they describe — this is only for outcomes.

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Snackbar, Alert } from '@mui/material';

const ToastContext = createContext({ success() {}, error() {}, info() {} });

export const useToast = () => useContext(ToastContext);

export const ToastProvider = ({ children }) => {
    const [queue, setQueue] = useState([]);
    const current = queue[0];

    const push = useCallback((severity, text) => {
        if (!text) return;
        setQueue(q => [...q, { severity, text, key: Date.now() + Math.random() }]);
    }, []);

    const api = useMemo(() => ({
        success: t => push('success', t),
        error: t => push('error', t),
        info: t => push('info', t),
        warning: t => push('warning', t),
    }), [push]);

    const close = (_e, reason) => {
        // Don't steal a message the user may still be reading because they
        // happened to click elsewhere.
        if (reason === 'clickaway') return;
        setQueue(q => q.slice(1));
    };

    return (
        <ToastContext.Provider value={api}>
            {children}
            <Snackbar
                key={current?.key}
                open={!!current}
                autoHideDuration={current?.severity === 'error' ? 8000 : 4000}
                onClose={close}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert
                    onClose={() => setQueue(q => q.slice(1))}
                    severity={current?.severity || 'info'}
                    variant="filled"
                    sx={{ borderRadius: 2, boxShadow: '0 8px 24px rgba(15,23,42,0.18)', alignItems: 'center' }}
                >
                    {current?.text}
                </Alert>
            </Snackbar>
        </ToastContext.Provider>
    );
};

export default ToastProvider;
