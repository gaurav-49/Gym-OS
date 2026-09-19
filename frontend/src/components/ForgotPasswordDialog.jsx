// frontend/src/components/ForgotPasswordDialog.jsx
import React, { useEffect, useState } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button,
    Alert, Stepper, Step, StepLabel, Box, Typography, FormControlLabel, Radio, RadioGroup,
} from '@mui/material';
import Alerts from './Alerts';
import api from '../api';
import { log, logError } from '../logger';

const ForgotPasswordDialog = ({ open, onClose, forced = false, initialUsername = '', onDone }) => {
    const [step, setStep] = useState(1); // 1 username, 2 method, 3 otp+password, 4 done
    const [username, setUsername] = useState('');
    const [options, setOptions] = useState({ email: null, phone: null });
    const [method, setMethod] = useState('email');
    const [sentInfo, setSentInfo] = useState(null); // { destination_masked, dev_otp, expires_minutes }
    const [otp, setOtp] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [sending, setSending] = useState(false);
    const [verifying, setVerifying] = useState(false);
    // Seconds until "Resend OTP" becomes available again. The server decides
    // the length — it climbs with each send — and this just counts it down so
    // the wait is visible rather than a button that silently refuses.
    const [resendIn, setResendIn] = useState(0);

    // A forced reset already knows who is resetting — skip straight to
    // choosing where the OTP goes rather than asking for the username the
    // user just typed on the screen behind this dialog.
    useEffect(() => {
        if (!open || !forced || !initialUsername) return;
        setUsername(initialUsername);
        api.get(`/auth/recovery-options/${encodeURIComponent(initialUsername.trim())}`)
            .then(res => {
                const { email, phone } = res.data;
                if (!email && !phone) {
                    setError('No email or phone is linked to this account. Contact your gym admin.');
                    return;
                }
                setOptions({ email, phone });
                setMethod(email ? 'email' : 'sms');
                setStep(2);
            })
            .catch(() => { /* stay on step 1 and let the user proceed by hand */ });
    }, [open, forced, initialUsername]);

    const reset = () => {
        setStep(1);
        setUsername('');
        setOptions({ email: null, phone: null });
        setMethod('email');
        setSentInfo(null);
        setOtp('');
        setNewPassword('');
        setConfirmPassword('');
        setError('');
        setSending(false);
        setVerifying(false);
        setResendIn(0);
    };

    const handleClose = () => {
        reset();
        onClose();
    };

    const finish = () => {
        reset();
        if (onDone) onDone();
        onClose();
    };

    useEffect(() => {
        if (resendIn <= 0) return undefined;
        const t = setInterval(() => setResendIn(n => (n <= 1 ? 0 : n - 1)), 1000);
        return () => clearInterval(t);
    }, [resendIn > 0]);

    const mmss = (total) => {
        const m = Math.floor(total / 60);
        const sec = total % 60;
        if (m >= 60) {
            const h = Math.floor(m / 60);
            return `${h}h ${m % 60}m`;
        }
        return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `${sec}s`;
    };

    const handleLookup = async () => {
        if (!username.trim()) {
            setError('Enter your username.');
            return;
        }
        setError('');
        log('ForgotPasswordDialog', 'handleLookup', `→ lookup recovery options for username="${username.trim()}"`);
        try {
            const res = await api.get(`/auth/recovery-options/${encodeURIComponent(username.trim())}`);
            const { email, phone } = res.data;
            if (!email && !phone) {
                setError('No email or phone is linked to this account. Contact your gym admin.');
                return;
            }
            setOptions({ email, phone });
            setMethod(email ? 'email' : 'sms');
            setStep(2);
        } catch (err) {
            logError('ForgotPasswordDialog', 'handleLookup', `✗ failed: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Something went wrong. Try again.');
        }
    };

    const handleSend = async () => {
        setError('');
        setSending(true);
        log('ForgotPasswordDialog', 'handleSend', `→ send OTP for username="${username.trim()}" method=${method}`);
        try {
            const res = await api.post('/auth/forgot', { username: username.trim(), method });
            setSentInfo(res.data);
            setResendIn(Number(res.data.resend_after_seconds) || 0);
            setOtp('');
            setStep(3);
        } catch (err) {
            logError('ForgotPasswordDialog', 'handleSend', `✗ failed: ${err.response?.data?.error || err.message}`, err);
            const msg = err.response?.data?.error || 'Failed to send OTP.';
            setError(msg);
            // A refusal names the remaining wait — mirror it into the counter so
            // the button and the message never disagree.
            const m = /([0-9]+)\s*(second|minute|hour)/i.exec(msg);
            if (m) {
                const n = Number(m[1]);
                const unit = m[2].toLowerCase();
                setResendIn(unit === 'hour' ? n * 3600 : unit === 'minute' ? n * 60 : n);
            }
        } finally {
            setSending(false);
        }
    };

    const handleVerify = async () => {
        if (otp.trim().length !== 6) {
            setError('Enter the 6-digit OTP.');
            return;
        }
        if (newPassword.length < 6) {
            setError('New password must be at least 6 characters.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }
        setError('');
        setVerifying(true);
        log('ForgotPasswordDialog', 'handleVerify', `→ verify OTP for username="${username.trim()}"`);
        try {
            await api.post('/auth/verify-otp', {
                username: username.trim(),
                otp: otp.trim(),
                new_password: newPassword,
            });
            setStep(4);
            log('ForgotPasswordDialog', 'handleVerify', '← password reset accepted');
        } catch (err) {
            logError('ForgotPasswordDialog', 'handleVerify', `✗ failed: ${err.response?.data?.error || err.message}`, err);
            const msg = err.response?.data?.error || 'Verification failed. Try again.';
            setError(msg);
            // A rejected new password is cleared so it cannot be nudged through
            // by pressing the button again; the OTP survives a password
            // rejection because the server no longer spends it in that case,
            // and only clears when the OTP itself was what failed.
            setNewPassword('');
            setConfirmPassword('');
            if (msg.toLowerCase().includes('otp')) setOtp('');
        } finally {
            setVerifying(false);
        }
    };

    const availableMethods = [
        ...(options.email ? [{ id: 'email', label: `Email — ${options.email}` }] : []),
        ...(options.phone ? [{ id: 'sms', label: `Phone (SMS) — ${options.phone}` }] : []),
    ];

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
            <DialogTitle>{forced ? 'Set a new password' : 'Forgot Password'}</DialogTitle>
            <DialogContent>
                {forced && step !== 4 && (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        Too many failed sign-in attempts, so this account needs a new password
                        before it can be used again — there is no waiting period, just set one now.
                        It cannot be a password you have used recently.
                    </Alert>
                )}
                <Stepper activeStep={step - 1} alternativeLabel sx={{ mb: 3, mt: 1 }}>
                    <Step><StepLabel>Username</StepLabel></Step>
                    <Step><StepLabel>Method</StepLabel></Step>
                    <Step><StepLabel>OTP</StepLabel></Step>
                    <Step><StepLabel>Done</StepLabel></Step>
                </Stepper>

                {step === 1 && (
                    <Box>
                        <Typography variant="body2" color="text.secondary" mb={2}>
                            Enter your username. We'll send a one-time password (OTP) to your registered
                            email or phone.
                        </Typography>
                        <Alerts items={[error && { severity: 'error', text: error }]} />
                        <TextField
                            fullWidth autoFocus label="Username" value={username}
                            onChange={e => setUsername(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleLookup(); }}
                        />
                    </Box>
                )}

                {step === 2 && (
                    <Box>
                        <Alerts items={[error && { severity: 'error', text: error }]} />
                        <Typography variant="body2" color="text.secondary" mb={1}>
                            Where should we send the OTP?
                        </Typography>
                        <RadioGroup value={method} onChange={e => setMethod(e.target.value)}>
                            {availableMethods.map(m => (
                                <FormControlLabel key={m.id} value={m.id} control={<Radio />} label={m.label} />
                            ))}
                        </RadioGroup>
                        {sentInfo && (
                            <Alert severity="info" sx={{ mt: 2 }}>
                                OTP sent to {sentInfo.destination_masked}. Valid for {sentInfo.expires_minutes} minutes.
                                {sentInfo.dev_otp && (
                                    <Box component="span" display="block" mt={0.5}>
                                        Dev mode — your OTP is <b>{sentInfo.dev_otp}</b>
                                    </Box>
                                )}
                            </Alert>
                        )}
                    </Box>
                )}

                {step === 3 && (
                    <Box>
                        <Alerts items={[error && { severity: 'error', text: error }]} />
                        <Alert severity="info" sx={{ mb: 2 }}>
                            OTP sent to {sentInfo?.destination_masked}. Valid for {sentInfo?.expires_minutes} minutes.
                            {sentInfo?.dev_otp && (
                                <Box component="span" display="block" mt={0.5}>
                                    Dev mode — your OTP is <b>{sentInfo.dev_otp}</b>
                                </Box>
                            )}
                        </Alert>
                        <TextField
                            fullWidth autoFocus label="6-digit OTP" value={otp}
                            onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            inputProps={{ inputMode: 'numeric' }} sx={{ mb: 2 }}
                        />
                        <TextField
                            fullWidth type="password" label="New Password (min 6 chars)" value={newPassword}
                            onChange={e => setNewPassword(e.target.value)} sx={{ mb: 2 }}
                        />
                        <TextField
                            fullWidth type="password" label="Confirm New Password" value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleVerify(); }}
                        />
                        <Button
                            size="small" sx={{ mt: 1 }} onClick={handleSend}
                            disabled={sending || resendIn > 0}
                        >
                            {resendIn > 0 ? `Resend OTP in ${mmss(resendIn)}` : 'Resend OTP'}
                        </Button>
                        {resendIn > 0 && (
                            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                                Each resend waits a little longer than the last.
                            </Typography>
                        )}
                    </Box>
                )}

                {step === 4 && (
                    <Alert severity="success">
                        Password reset successful. You can now log in with your new password —
                        the earlier lockout has been cleared.
                    </Alert>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={step === 4 ? finish : handleClose}>
                    {step === 4 ? 'Close' : 'Cancel'}
                </Button>
                {step === 1 && (
                    <Button variant="contained" onClick={handleLookup}>Continue</Button>
                )}
                {step === 2 && (
                    <Button variant="contained" onClick={handleSend} disabled={sending || resendIn > 0}>
                        {resendIn > 0 ? `Wait ${mmss(resendIn)}` : sending ? 'Sending…' : 'Send OTP'}
                    </Button>
                )}
                {step === 3 && (
                    <Button variant="contained" onClick={handleVerify} disabled={verifying}>
                        {verifying ? 'Verifying…' : 'Reset Password'}
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    );
};

export default ForgotPasswordDialog;
