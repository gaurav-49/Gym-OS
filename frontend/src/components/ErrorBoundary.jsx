// frontend/src/components/ErrorBoundary.jsx
import React from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';
import { ErrorOutline } from '@mui/icons-material';
import { logError } from '../logger';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        logError('ErrorBoundary', 'componentDidCatch', `✗ UI crashed: ${error?.message || error}`, error, info);
    }

    render() {
        if (this.state.error) {
            return (
                <Box sx={{ minHeight: '100vh', p: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default' }}>
                    <Paper sx={{ p: 5, maxWidth: 480, textAlign: 'center', borderRadius: 4 }}>
                        <ErrorOutline sx={{ fontSize: 56, color: 'error.main', mb: 1 }} />
                        <Typography variant="h6" gutterBottom>Something went wrong</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 3, wordBreak: 'break-word' }}>
                            {String(this.state.error.message || this.state.error)}
                        </Typography>
                        <Button variant="contained" onClick={() => window.location.reload()}>
                            Reload App
                        </Button>
                    </Paper>
                </Box>
            );
        }
        return this.props.children;
    }
}

export default ErrorBoundary;
