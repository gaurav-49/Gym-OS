// frontend/src/components/MemberBookingPage.jsx
// Public self-service: a member signs in with their Member ID + portal password,
// verifies, then books / waitlists / cancels classes on their own.
import React, { useRef, useState } from 'react';
import {
    Box, Paper, Typography, TextField, Button, Stack, Avatar, } from '@mui/material';
import Alerts from './Alerts';
import { Badge, Lock, Logout,
} from '@mui/icons-material';
import api from '../api';
import { log, logError } from '../logger';
import MemberClassGrid from './MemberClassGrid';
import useBranding from './ui/useBranding';

const MemberBookingPage = () => {
    const brand = useBranding();
    const [token, setToken] = useState(() => localStorage.getItem('gym_member_token') || '');
    const [member, setMember] = useState(() => {
        try { return JSON.parse(localStorage.getItem('gym_member_user') || 'null'); } catch { return null; }
    });
    const [form, setForm] = useState({ member_code: '', password: '' });
    const secretRef = useRef(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleVerify = async () => {
        if (!form.member_code.trim() || !form.password) {
            setError('Enter your Member ID and password.');
            return;
        }
        setError('');
        setLoading(true);
        log('MemberBookingPage', 'handleVerify', `→ member self-service login for member_code="${form.member_code}"`);
        try {
            const res = await api.post('/member/login', form);
            localStorage.setItem('gym_member_token', res.data.token);
            localStorage.setItem('gym_member_user', JSON.stringify({ name: res.data.name, member_code: res.data.member_code }));
            setToken(res.data.token);
            setMember({ name: res.data.name, member_code: res.data.member_code });
        } catch (err) {
            logError('MemberBookingPage', 'handleVerify', `✗ login failed for ${form.member_code}: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Verification failed. Try again.');
            // Same rule as every other login in the app: a rejected credential
            // is cleared rather than left sitting on a shared screen.
            setForm(f => ({ ...f, password: '' }));
            secretRef.current?.focus();
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('gym_member_token');
        localStorage.removeItem('gym_member_user');
        setToken('');
        setMember(null);
        setForm({ member_code: '', password: '' });
    };

    if (!token || !member) {
        return (
            <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2,
                background: 'linear-gradient(135deg, #0f172a 0%, #134e4a 100%)' }}>
                <Paper elevation={8} sx={{ borderRadius: 4, p: 4, maxWidth: 420, width: '100%' }}>
                    <Box display="flex" alignItems="center" gap={1.5} mb={1}>
                        {/* Both of these were the vendor's, on a page members see:
                            a hardcoded barbell where the gym's own logo belongs,
                            and "GYM OS" as the subtitle. */}
                        <Box sx={{ width: 44, height: 44, borderRadius: 3, bgcolor: 'success.softBg',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>
                            {brand.logo}
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                            <Typography variant="h6" fontWeight={800}>Class Booking</Typography>
                            <Typography variant="caption" color="text.secondary" noWrap>
                                {brand.name} member self-service
                            </Typography>
                        </Box>
                    </Box>
                    <Typography variant="body2" color="text.secondary" mb={2}>
                        Sign in with your Member ID and your portal password.
                        Not set one yet? Open the member portal to get started.
                    </Typography>
                    <Alerts items={[error && { severity: 'error', text: error }]} />
                    <Stack spacing={2}>
                        <TextField fullWidth label="Member ID" value={form.member_code}
                            onChange={e => setForm({ ...form, member_code: e.target.value.replace(/\D/g, '') })}
                            inputProps={{ inputMode: 'numeric' }}
                            InputProps={{ startAdornment: <Badge color="disabled" fontSize="small" /> }} />
                        <TextField fullWidth label="Password" type="password" value={form.password} inputRef={secretRef}
                            autoComplete="current-password"
                            onChange={e => setForm({ ...form, password: e.target.value })}
                            onKeyDown={e => { if (e.key === 'Enter') handleVerify(); }}
                            InputProps={{ startAdornment: <Lock color="disabled" fontSize="small" sx={{ mr: 1 }} /> }} />
                        <Button variant="contained" size="large" onClick={handleVerify} disabled={loading}>
                            {loading ? 'Verifying…' : 'Verify & Continue'}
                        </Button>
                    </Stack>
                </Paper>
            </Box>
        );
    }

    return (
        <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', p: { xs: 2, md: 4 } }}>
            <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
                    <Box display="flex" alignItems="center" gap={1.5}>
                        <Avatar sx={{ bgcolor: 'primary.main', fontWeight: 700 }}>{member.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}</Avatar>
                        <Box>
                            <Typography variant="h6" fontWeight={800}>Hi {member.name} 👋</Typography>
                            <Typography variant="caption" color="text.secondary">Member ID {member.member_code}</Typography>
                        </Box>
                    </Box>
                    <Button size="small" startIcon={<Logout />} onClick={handleLogout}>Switch member</Button>
                </Box>
            </Paper>
            <MemberClassGrid />
        </Box>
    );
};

export default MemberBookingPage;
