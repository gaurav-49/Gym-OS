// frontend/src/components/BillingPage.jsx
// Recurring / auto-renew billing.
// - Settings: global toggle, days-before expiry to charge, retry schedule,
//   max attempts, and the dunning message template.
// - Auto-renew members: who is enrolled, their saved payment method, and the
//   last charge attempt (renewed / failed / retry scheduled / paused).
// - Pending retries: failed charges waiting for the next attempt.
// - Dunning log: every "your payment failed" message we sent.
import React, { useEffect, useState } from 'react';
import {
    Box, Paper, Typography, Button, Stack, Chip, Switch, TextField, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Dialog, DialogTitle, DialogContent, DialogActions, MenuItem, GridLegacy as Grid, Card, CardContent, } from '@mui/material';
import Alerts from './Alerts';
import { Autorenew, Payments, WarningAmber, History, Save, Replay, CheckCircle, PauseCircle, ReceiptLong,
} from '@mui/icons-material';
import api from '../api';
import { log, logError } from '../logger';
import { useToast } from './ui';

const PAYMENT_MODES = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Online'];

const fmtDate = (d) => {
    if (!d) return '—';
    const date = new Date(`${String(d).slice(0, 10)}T00:00:00`);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
// US order and no year — an attempt timestamp from last December read the same
// as one from this December. Day-first with a year, like every other screen.
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-GB',
    { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtMoney = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

const attemptChip = (a) => {
    if (!a) return <Chip size="small" label="No attempt yet" variant="outlined" />;
    if (a === 'success') return <Chip size="small" label="Renewed" color="success" />;
    if (a === 'failed') return <Chip size="small" label="Charge failed" color="error" variant="outlined" />;
    return <Chip size="small" label={a} color="warning" variant="outlined" />;
};

const BillingPage = ({ isAdmin }) => {
    const toast = useToast();
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [busy, setBusy] = useState(null);
    const [payDialog, setPayDialog] = useState(null); // { member, amount, method }

    const fetchData = async () => {
        try {
            const res = await api.get('/billing/overview');
            setData(res.data);
            setError('');
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to load billing data.');
        }
    };
    useEffect(() => { fetchData(); }, []);

    const saveSettings = async () => {
        setSaving(true);
        setError('');
        toast.success('');
        log('BillingPage', 'saveSettings', `→ save settings enabled=${data?.settings?.auto_renew_enabled} daysBefore=${data?.settings?.auto_renew_days_before}`);
        try {
            const res = await api.put('/billing/settings', {
                auto_renew_enabled: data.settings.auto_renew_enabled,
                auto_renew_days_before: Number(data.settings.auto_renew_days_before),
                auto_renew_retry_days: Number(data.settings.auto_renew_retry_days),
                auto_renew_max_attempts: Number(data.settings.auto_renew_max_attempts),
                auto_renew_dunning_message: data.settings.auto_renew_dunning_message,
            });
            setData({ ...data, settings: res.data });
            toast.success('Billing settings saved.');
        } catch (err) {
            logError('BillingPage', 'saveSettings', `✗ failed: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to save settings.');
        } finally {
            setSaving(false);
        }
    };

    const act = async (fn, member, okMsg) => {
        setBusy(member.id);
        setError('');
        toast.success('');
        log('BillingPage', 'act', `→ action on member id=${member?.id} (${member?.name || '?'})`);
        try {
            const res = await fn(member);
            toast.success(res.data.message || okMsg);
            fetchData();
        } catch (err) {
            logError('BillingPage', 'act', `✗ failed for member ${member?.id}: ${err.response?.data?.error || err.response?.data?.message || err.message}`, err);
            setError(err.response?.data?.error || err.response?.data?.message || 'Action failed.');
        } finally {
            setBusy(null);
        }
    };

    const retry = (m) => act(() => api.post(`/billing/members/${m.id}/retry`), m, 'Retry scheduled.');
    const pause = (m) => act(() => api.post(`/billing/members/${m.id}/pause`), m, 'Auto-renew paused.');
    const toggle = async (m, checked) => {
        await act(() => api.put(`/billing/members/${m.id}`, { auto_renew: checked }), m,
            checked ? 'Auto-renew enabled.' : 'Auto-renew disabled.');
    };
    const markPaid = async () => {
        const { member, amount, method } = payDialog;
        setPayDialog(null);
        await act(() => api.post(`/billing/members/${member.id}/mark-paid`, { amount, method }), member, 'Renewal recorded.');
    };

    if (!data) {
        return <Paper elevation={3} sx={{ p: 5, textAlign: 'center' }}><Typography color="text.secondary">Loading billing…</Typography></Paper>;
    }
    const s = data.settings;
    const set = (k, v) => setData({ ...data, settings: { ...data.settings, [k]: v } });

    return (
        <Box>
            <Alerts items={[
                error && { severity: 'error', text: error },
            ]} />

            {/* Stats */}
            <Grid container spacing={2} mb={2}>
                {[
                    { label: 'Auto-renew members', value: data.stats.auto_renew_count, icon: <Autorenew />, color: 'success' },
                    { label: 'Auto-renewed (30d)', value: data.stats.renewed_30d, icon: <CheckCircle />, color: 'info' },
                    { label: 'Failed charges', value: data.stats.failed_attempts, icon: <WarningAmber />, color: 'error' },
                    { label: 'Pending retries', value: data.stats.pending_retries, icon: <Replay />, color: 'warning' },
                ].map(stat => (
                    <Grid item xs={6} sm={3} key={stat.label}>
                        <Card>
                            <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <Box sx={{ width: 40, height: 40, borderRadius: 2.5, bgcolor: `${stat.color}.softBg`, color: `${stat.color}.dark`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {stat.icon}
                                </Box>
                                <Box>
                                    <Typography variant="h5" fontWeight={800}>{stat.value}</Typography>
                                    <Typography variant="caption" color="text.secondary">{stat.label}</Typography>
                                </Box>
                            </CardContent>
                        </Card>
                    </Grid>
                ))}
            </Grid>

            <Grid container spacing={2}>
                {/* Settings */}
                <Grid item xs={12} lg={4}>
                    <Paper elevation={3} sx={{ p: 3 }}>
                        <Box display="flex" alignItems="center" gap={1} mb={2}>
                            <Payments sx={{ color: 'primary.main' }} />
                            <Typography variant="h6">Auto-renew settings</Typography>
                        </Box>
                        <Stack spacing={2}>
                            <Box display="flex" justifyContent="space-between" alignItems="center">
                                <Box>
                                    <Typography variant="body2" fontWeight={600}>Auto-renew billing</Typography>
                                    <Typography variant="caption" color="text.secondary">Charge due memberships automatically</Typography>
                                </Box>
                                <Switch checked={s.auto_renew_enabled} disabled={!isAdmin}
                                    onChange={e => set('auto_renew_enabled', e.target.checked)} />
                            </Box>
                            <TextField fullWidth size="small" type="number" label="Charge this many days before expiry"
                                value={s.auto_renew_days_before} disabled={!isAdmin}
                                onChange={e => set('auto_renew_days_before', e.target.value)}
                                inputProps={{ min: 0, max: 30 }}
                                helperText="0 = charge on the expiry day itself" />
                            {/* Two number fields shared one narrow sidebar column, which left
                                no room for their own labels: "Retry every (days)" rendered as
                                "Retry ..." and "Max attempts" as "Max ...". They stack below sm
                                and each gets the full width it needs. */}
                            <Box sx={{
                                display: 'grid',
                                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                                gap: 1.5,
                            }}>
                                <TextField fullWidth size="small" type="number" label="Retry every (days)"
                                    value={s.auto_renew_retry_days} disabled={!isAdmin}
                                    onChange={e => set('auto_renew_retry_days', e.target.value)}
                                    inputProps={{ min: 1, max: 30 }} />
                                <TextField fullWidth size="small" type="number" label="Max attempts"
                                    value={s.auto_renew_max_attempts} disabled={!isAdmin}
                                    onChange={e => set('auto_renew_max_attempts', e.target.value)}
                                    inputProps={{ min: 1, max: 10 }} />
                            </Box>
                            {/* rows=3 clipped the default message mid-sentence with no scrollbar.
                                minRows lets it grow to the text it actually holds. */}
                            <TextField fullWidth multiline minRows={3} maxRows={10} size="small" label="Dunning message"
                                value={s.auto_renew_dunning_message} disabled={!isAdmin}
                                onChange={e => set('auto_renew_dunning_message', e.target.value)}
                                helperText="Placeholders: {name}, {id}, {amount}, {error}, {attempts}, {max_attempts}" />
                            {isAdmin && (
                                <Button variant="contained" startIcon={<Save />} onClick={saveSettings} disabled={saving}>
                                    {saving ? 'Saving…' : 'Save settings'}
                                </Button>
                            )}
                        </Stack>
                    </Paper>
                </Grid>

                {/* Auto-renew members + pending retries */}
                <Grid item xs={12} lg={8}>
                    <Paper elevation={3} sx={{ p: 3, mb: 2 }}>
                        <Box display="flex" alignItems="center" gap={1} mb={2}>
                            <Autorenew sx={{ color: 'primary.main' }} />
                            <Typography variant="h6">Auto-renew members</Typography>
                            <Chip size="small" label={`${data.members.length} enrolled`} variant="outlined" sx={{ ml: 'auto' }} />
                        </Box>
                        {data.members.length === 0 ? (
                            <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                                No members enrolled in auto-renew yet — enable it on a member's card (Members → Edit) or here once they enroll.
                            </Typography>
                        ) : (
                            <TableContainer>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Member</TableCell>
                                            <TableCell>Plan / Expiry</TableCell>
                                            <TableCell>Recurring method</TableCell>
                                            <TableCell>Last attempt</TableCell>
                                            <TableCell align="right">Actions</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {data.members.map(m => {
                                            const needsAttention = m.attempt_status === 'failed';
                                            return (
                                                <TableRow key={m.id} sx={{ bgcolor: needsAttention ? 'rgba(220,38,38,0.04)' : 'transparent' }}>
                                                    <TableCell>
                                                        <Typography variant="body2" fontWeight={600}>{m.name}</Typography>
                                                        <Typography variant="caption" color="text.secondary">ID {m.member_code}</Typography>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Typography variant="body2">{m.membership_type || '—'}</Typography>
                                                        <Typography variant="caption" color="text.secondary">{fmtDate(m.membership_expiry)}</Typography>
                                                    </TableCell>
                                                    <TableCell>
                                                        {m.recurring_method
                                                            ? <Chip size="small" label={m.recurring_method} color="primary" variant="outlined" />
                                                            : <Chip size="small" label="No method" color="error" variant="outlined" />}
                                                    </TableCell>
                                                    <TableCell>
                                                        {attemptChip(m.attempt_status)}
                                                        {m.attempt_status === 'failed' && (
                                                            <Typography variant="caption" display="block" color="text.secondary">
                                                                {m.attempt_count ? `Attempt ${m.attempt_count}` : ''}
                                                                {m.next_retry_at ? ` · retry ${fmtDateTime(m.next_retry_at)}` : ' · no more retries'}
                                                            </Typography>
                                                        )}
                                                    </TableCell>
                                                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                                        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                                                            {isAdmin && m.attempt_status === 'failed' && (
                                                                <>
                                                                    <Button size="small" startIcon={<Replay />} disabled={busy === m.id}
                                                                        onClick={() => retry(m)}>Retry now</Button>
                                                                    <Button size="small" startIcon={<CheckCircle />} color="success" disabled={busy === m.id}
                                                                        onClick={() => setPayDialog({ member: m, amount: m.membership_fee || '', method: m.recurring_method || 'Cash' })}>
                                                                        Mark paid
                                                                    </Button>
                                                                </>
                                                            )}
                                                            {isAdmin && (
                                                                <Button size="small" startIcon={<PauseCircle />} color="error" disabled={busy === m.id}
                                                                    onClick={() => pause(m)}>Pause</Button>
                                                            )}
                                                            {isAdmin && (
                                                                <Switch size="small" checked={!!m.auto_renew} disabled={busy === m.id}
                                                                    onChange={e => toggle(m, e.target.checked)} />
                                                            )}
                                                        </Stack>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </Paper>

                    {/* Pending retries */}
                    {data.retries.length > 0 && (
                        <Paper elevation={3} sx={{ p: 3, mb: 2, border: '1px solid', borderColor: 'warning.main' }}>
                            <Box display="flex" alignItems="center" gap={1} mb={2}>
                                <Replay sx={{ color: 'warning.main' }} />
                                <Typography variant="h6">Pending retries</Typography>
                                <Chip size="small" label={`${data.retries.length}`} color="warning" sx={{ ml: 'auto' }} />
                            </Box>
                            <TableContainer>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Member</TableCell>
                                            <TableCell>Amount</TableCell>
                                            <TableCell>Attempt</TableCell>
                                            <TableCell>Next retry</TableCell>
                                            <TableCell>Reason</TableCell>
                                            <TableCell align="right"></TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {data.retries.map(b => (
                                            <TableRow key={b.id}>
                                                <TableCell>
                                                    <Typography variant="body2" fontWeight={600}>{b.member_name}</Typography>
                                                    <Typography variant="caption" color="text.secondary">ID {b.member_code}</Typography>
                                                </TableCell>
                                                <TableCell>{fmtMoney(b.amount)}</TableCell>
                                                <TableCell>{b.attempt_count}/{s.auto_renew_max_attempts}</TableCell>
                                                <TableCell>{fmtDateTime(b.next_retry_at)}</TableCell>
                                                {/* A bare dash in a column headed "Reason" on a
                                                    row that is queued for retry reads as missing
                                                    data. The retry has simply not run yet. */}
                                                <TableCell>
                                                    {b.error || (
                                                        <Typography component="span" variant="body2" color="text.secondary">
                                                            Not attempted yet
                                                        </Typography>
                                                    )}
                                                </TableCell>
                                                <TableCell align="right">
                                                    {isAdmin && (
                                                        <Button size="small" startIcon={<Replay />} disabled={busy === b.member_id}
                                                            onClick={() => retry(b)}>Retry now</Button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Paper>
                    )}

                    {/* Dunning log */}
                    <Paper elevation={3} sx={{ p: 3 }}>
                        <Box display="flex" alignItems="center" gap={1} mb={2}>
                            <History sx={{ color: 'text.secondary' }} />
                            <Typography variant="h6">Dunning history</Typography>
                        </Box>
                        {data.dunning.length === 0 ? (
                            <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                                No failed-payment reminders sent yet.
                            </Typography>
                        ) : (
                            <TableContainer>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Member</TableCell>
                                            <TableCell>Message</TableCell>
                                            <TableCell>Channel</TableCell>
                                            <TableCell>Status</TableCell>
                                            <TableCell>Sent</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {data.dunning.map(l => (
                                            <TableRow key={l.id}>
                                                <TableCell>
                                                    <Typography variant="body2" fontWeight={600}>{l.member_name || `Member #${l.member_id}`}</Typography>
                                                    <Typography variant="caption" color="text.secondary">cycle {l.cycle}</Typography>
                                                </TableCell>
                                                <TableCell sx={{ maxWidth: 320 }}>
                                                    <Typography variant="caption" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                                        {l.message}
                                                    </Typography>
                                                </TableCell>
                                                <TableCell>{l.channel}</TableCell>
                                                <TableCell>
                                                    <Chip size="small" label={l.status}
                                                        color={l.status === 'failed' ? 'error' : l.status === 'console' ? 'warning' : 'success'} variant="outlined" />
                                                </TableCell>
                                                <TableCell>{fmtDateTime(l.created_at)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </Paper>
                </Grid>
            </Grid>

            {/* Mark paid dialog */}
            <Dialog open={!!payDialog} onClose={() => setPayDialog(null)} maxWidth="xs" fullWidth>
                <DialogTitle>Mark renewal paid</DialogTitle>
                <DialogContent>
                    {payDialog && (
                        <Stack spacing={2} sx={{ mt: 1 }}>
                            <Typography variant="body2" color="text.secondary">
                                Record the renewal for <b>{payDialog.member.name}</b> as collected — the membership is
                                extended now, regardless of the saved payment method.
                            </Typography>
                            <TextField fullWidth size="small" type="number" label="Amount collected (₹)"
                                value={payDialog.amount}
                                onChange={e => setPayDialog({ ...payDialog, amount: e.target.value })}
                                inputProps={{ min: 0 }} />
                            <TextField select fullWidth size="small" label="Method"
                                value={payDialog.method}
                                onChange={e => setPayDialog({ ...payDialog, method: e.target.value })}>
                                {PAYMENT_MODES.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                            </TextField>
                        </Stack>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPayDialog(null)}>Cancel</Button>
                    <Button variant="contained" startIcon={<ReceiptLong />} onClick={markPaid}>Record payment</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default BillingPage;
