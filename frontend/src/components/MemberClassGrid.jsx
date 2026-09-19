// frontend/src/components/MemberClassGrid.jsx
// Member-facing class booking grid: lists upcoming classes with capacity bars,
// lets the member book / waitlist / cancel. Shared by the standalone class
// booking page and the member portal's Classes tab. Requires a valid
// gym_member_token (attached automatically by api.js for /member/* routes).
import React, { useEffect, useState } from 'react';
import {
    Box, Typography, Button, GridLegacy as Grid, Chip, Stack, Card, CardContent, LinearProgress, Paper, } from '@mui/material';
import { alpha } from '@mui/material/styles';
import Alerts from './Alerts';
import { EventAvailable, CheckCircle, Cancel,
} from '@mui/icons-material';
import api from '../api';
import { log, logError } from '../logger';

const fmtDate = (d) => {
    if (!d) return '—';
    const date = new Date(`${d}T00:00:00`);
    return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};
const fmtTime = (t) => (t ? String(t).slice(0, 5) : '—');

const MemberClassGrid = ({ onSessionExpired }) => {
    const [classes, setClasses] = useState([]);
    const [myBookings, setMyBookings] = useState([]);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [busyClass, setBusyClass] = useState(null);
    const [loading, setLoading] = useState(true);

    const fetchData = async () => {
        try {
            log('MemberClassGrid', 'fetchData', '→ loading classes and my bookings');
            const [cls, mine] = await Promise.all([
                api.get('/member/classes'),
                api.get('/member/classes/my'),
            ]);
            setClasses(cls.data);
            setMyBookings(mine.data);
            setError('');
        } catch (err) {
            logError('MemberClassGrid', 'fetchData', `✗ failed: ${err.response?.data?.error || err.message}`, err);
            if (err.response?.status === 401) {
                if (onSessionExpired) onSessionExpired();
                else setError('Session expired — please log in again.');
            } else {
                setError(err.response?.data?.error || 'Failed to load classes.');
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    const act = async (cls, action) => {
        setBusyClass(cls.id);
        setError('');
        setMessage('');
        log('MemberClassGrid', 'act', `→ ${action} class id=${cls.id}`);
        try {
            const res = await api.post(`/member/classes/${cls.id}/${action}`);
            setMessage(res.data.message);
            fetchData();
        } catch (err) {
            logError('MemberClassGrid', 'act', `✗ ${action} class ${cls.id} failed: ${err.response?.data?.error || err.message}`, err);
            if (err.response?.status === 401 && onSessionExpired) onSessionExpired();
            else setError(err.response?.data?.error || 'Something went wrong.');
        } finally {
            setBusyClass(null);
        }
    };

    if (loading) {
        return <Paper elevation={3} sx={{ p: 4, textAlign: 'center' }}><Typography color="text.secondary">Loading classes…</Typography></Paper>;
    }

    return (
        <Box>
            <Alerts items={[
                message && { severity: 'success', text: message },
                error && { severity: 'error', text: error },
            ]} />

            <Box display="flex" alignItems="center" gap={1} mb={2}>
                <EventAvailable sx={{ color: 'primary.main' }} />
                <Typography variant="h6">Upcoming Classes</Typography>
            </Box>
            {classes.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                    No upcoming classes right now.
                </Typography>
            ) : (
                <Grid container spacing={2}>
                    {classes.map(c => {
                        const full = c.booked >= c.capacity;
                        const mine = c.my_status; // 'booked' | 'waitlisted' | null
                        return (
                            <Grid item xs={12} sm={6} lg={4} key={c.id}>
                                <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', border: mine ? '1px solid' : 'none', borderColor: mine === 'booked' ? 'success.main' : 'warning.main' }}>
                                    <CardContent sx={{ flexGrow: 1 }}>
                                        <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={1}>
                                            <Box>
                                                <Typography fontWeight={700}>{c.name}</Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    {fmtDate(c.class_date)} · {fmtTime(c.start_time)}–{fmtTime(c.end_time)}
                                                </Typography>
                                                <Typography variant="caption" display="block" color="text.secondary">
                                                    Trainer: {c.trainer_name || '—'}
                                                </Typography>
                                            </Box>
                                            <Chip size="small" label={full ? 'Full' : `${c.booked}/${c.capacity}`}
                                                color={full ? 'error' : 'primary'} variant="outlined" />
                                        </Box>
                                        <LinearProgress variant="determinate"
                                            value={c.capacity ? Math.min(100, Math.round((c.booked / c.capacity) * 100)) : 0}
                                            color={full ? 'error' : 'success'} sx={{ height: 7, borderRadius: 4, my: 1.5 }} />
                                        {mine && (
                                            <Chip size="small" sx={{ mb: 1.5 }}
                                                label={mine === 'booked' ? '✓ You are booked' : '⏳ You are on the waitlist'}
                                                color={mine === 'booked' ? 'success' : 'warning'} variant="filled" />
                                        )}
                                    </CardContent>
                                    <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'flex-end' }}>
                                        {mine ? (
                                            <Button size="small" color="error" startIcon={<Cancel />}
                                                disabled={busyClass === c.id}
                                                onClick={() => act(c, 'cancel')}>
                                                {busyClass === c.id ? 'Cancelling…' : 'Cancel booking'}
                                            </Button>
                                        ) : (
                                            <Button size="small" variant="contained" startIcon={<CheckCircle />}
                                                disabled={busyClass === c.id}
                                                onClick={() => act(c, 'book')}>
                                                {busyClass === c.id ? 'Booking…' : (full ? 'Join waitlist' : 'Book now')}
                                            </Button>
                                        )}
                                    </Box>
                                </Card>
                            </Grid>
                        );
                    })}
                </Grid>
            )}

            {myBookings.length > 0 && (
                <Paper elevation={3} sx={{ p: 3, mt: 3 }}>
                    <Typography variant="h6" mb={2}>My Bookings</Typography>
                    <Stack spacing={1}>
                        {myBookings.map(b => (
                            <Box key={b.booking_id} display="flex" justifyContent="space-between" alignItems="center"
                                /* This grid is shared by the standalone booking page AND the
                                   portal's Classes tab, so it renders on paper and on ink. The
                                   plates were flat green-50 / amber-50: on ink the portal painted
                                   the class name #F1F5F9 on top of #f0fdf4 — 1.05:1, the name, the
                                   time and the trainer all invisible. A wash carrying the status
                                   colour composites over whichever ground is actually behind it. */
                                sx={{ p: 1.5, borderRadius: 2, bgcolor: (t) => alpha(
                                    b.booking_status === 'booked' ? t.palette.success.main : t.palette.warning.main,
                                    /* On paper the wash tints the ground the chip label sits on,
                                       and the label is the same hue: at 0.11 amber-on-amber fell to
                                       4.32:1. 0.07 keeps the tint legible and the chip at 4.57. */
                                    t.palette.mode === 'dark' ? 0.14 : 0.07) }}>
                                <Box>
                                    <Typography variant="body2" fontWeight={700}>{b.name}</Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        {fmtDate(b.class_date)} · {fmtTime(b.start_time)} · {b.trainer_name || '—'}
                                    </Typography>
                                </Box>
                                <Chip size="small" label={b.booking_status} color={b.booking_status === 'booked' ? 'success' : 'warning'} variant="outlined" />
                            </Box>
                        ))}
                    </Stack>
                </Paper>
            )}
        </Box>
    );
};

export default MemberClassGrid;
