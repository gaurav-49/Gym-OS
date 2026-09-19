// frontend/src/components/PaymentsPage.jsx
import React, { useEffect, useState } from 'react';
import {
    Paper, Typography, TextField, Button, MenuItem, GridLegacy as Grid, Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Dialog, DialogTitle, DialogContent, DialogActions, IconButton, Chip, Avatar, Stack
} from '@mui/material';
import Alerts from './Alerts';
import { Add, Delete, Payments as PaymentsIcon, TrendingUp, Today, ReceiptLong, Download,
} from '@mui/icons-material';
import api from '../api';
import { log, logError } from '../logger';
import { PAYMENT_MODES } from '../constants';
import { useConfirm, money, fmtDate, useToast, useBranding } from './ui';
import { printReceipt, receiptNo, describePayment } from './ui/receipt';

const initialsOf = (name) => (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

// `color` is a palette role, not a literal pair. It used to be
// {tint:'#ecfdf5', main:'#10b981'} — both mixed for paper, so on ink these
// four tiles were the brightest things on the page. softBg/dark are the same
// pairing every other stat tile in the app already uses, and they flip.
const MiniStat = ({ icon, label, value, color }) => (
    <Paper sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{
            width: 40, height: 40, borderRadius: 2.5, flexShrink: 0,
            bgcolor: `${color}.softBg`, color: `${color}.dark`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
            {icon}
        </Box>
        <Box>
            <Typography variant="h6" fontWeight={800} sx={{ lineHeight: 1.1 }}>{value}</Typography>
            <Typography variant="caption" color="text.secondary" fontWeight={500}>{label}</Typography>
        </Box>
    </Paper>
);

const PaymentsPage = ({ isAdmin }) => {
    const toast = useToast();
    const brand = useBranding();
    const [payments, setPayments] = useState([]);
    const [members, setMembers] = useState([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [form, setForm] = useState({ member_id: '', amount: '', method: 'Cash', payment_date: '', note: '' });
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState('');

    const fetchPayments = async () => {
        try {
            const res = await api.get('/payments');
            setPayments(res.data);
            setLoadError('');
        } catch (err) {
            console.error('Error fetching payments:', err);
            setLoadError(err.response?.data?.error || 'Failed to load payments.');
        }
    };

    // Reprinting last month's receipt at the counter is the single most common
    // thing a member walks in and asks for, and until now the only way to do it
    // was to log in as them. The list already carries their details for it.
    const openReceipt = (p) => {
        const ok = printReceipt(p, {
            name: p.member_name,
            member_code: p.member_code,
            phone: p.member_phone,
            amount_due: p.member_amount_due,
        }, brand);
        if (!ok) toast.error('The browser blocked the receipt window — allow pop-ups for this site.');
    };

    const fetchMembers = async () => {
        try {
            const res = await api.get('/clients');
            setMembers(res.data);
        } catch (err) {
            console.error('Error fetching members:', err);
        }
    };

    useEffect(() => {
        fetchPayments();
        fetchMembers();
    }, []);

    const openAdd = () => {
        const now = new Date();
        const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        setForm({ member_id: '', amount: '', method: 'Cash', payment_date: todayLocal, note: '' });
        setError('');
        setDialogOpen(true);
    };

    const handleSave = async () => {
        if (!form.member_id || !form.amount || Number(form.amount) <= 0) {
            log('PaymentsPage', 'handleSave', `→ validation: member=${form.member_id} amount=${form.amount}`);
            setError('Select a member and enter a positive amount.');
            return;
        }
        log('PaymentsPage', 'handleSave', `→ record payment member=${form.member_id} amount=${form.amount} method=${form.method}`);
        try {
            await api.post('/payments', form);
            setDialogOpen(false);
            toast.success('Payment recorded.');
            setError('');
            fetchPayments();
        } catch (err) {
            logError('PaymentsPage', 'handleSave', `✗ failed: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to record payment.');
        }
    };

    const confirm = useConfirm();

    const handleDelete = async (id) => {
        if (!await confirm({
            title: 'Delete this payment?',
            body: <>The amount comes off the member's paid total and back onto their dues.</>,
            confirmLabel: 'Delete payment', danger: true,
        })) return;
        log('PaymentsPage', 'handleDelete', `→ delete payment id=${id}`);
        try {
            await api.delete(`/payments/${id}`);
            fetchPayments();
        } catch (err) {
            logError('PaymentsPage', 'handleDelete', `✗ failed for payment ${id}: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to delete payment.');
        }
    };

    const handleCollect = async (member) => {
        if (!await confirm({
            title: `Collect from ${member.name}?`,
            body: <>Records <b>{money(member.amount_due)}</b> as received and clears their outstanding balance.</>,
            confirmLabel: `Collect ${money(member.amount_due)}`, tone: 'money',
        })) return;
        log('PaymentsPage', 'handleCollect', `→ collect dues member=${member.id} amount=${member.amount_due}`);
        try {
            const res = await api.post(`/payments/${member.id}/collect`, {});
            toast.success(res.data.message);
            setError('');
            await Promise.all([fetchPayments(), fetchMembers()]);
        } catch (err) {
            logError('PaymentsPage', 'handleCollect', `✗ failed for member ${member?.id}: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to collect dues.');
        }
    };

    const handleCollectAll = async () => {
        if (!await confirm({
            title: `Collect from all ${dues.length} members?`,
            body: <>Records <b>{fmt(duesTotal)}</b> across {dues.length} member{dues.length === 1 ? '' : 's'} in one go. Each one is written as a separate payment, so any single entry can be reversed afterwards.</>,
            confirmLabel: `Collect ${fmt(duesTotal)}`, tone: 'money',
        })) return;
        log('PaymentsPage', 'handleCollectAll', `→ collect all dues: ${dues.length} members, ${fmt(duesTotal)}`);
        try {
            const res = await api.post('/payments/collect-all', {});
            toast.success(res.data.message);
            setError('');
            await Promise.all([fetchPayments(), fetchMembers()]);
        } catch (err) {
            logError('PaymentsPage', 'handleCollectAll', `✗ failed: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to collect all dues.');
        }
    };

    const total = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const thisMonth = today.slice(0, 7);
    const todayTotal = payments.filter(p => p.payment_date === today).reduce((s, p) => s + Number(p.amount), 0);
    const monthTotal = payments.filter(p => (p.payment_date || '').startsWith(thisMonth)).reduce((s, p) => s + Number(p.amount), 0);

    const methodCounts = PAYMENT_MODES
        .map(m => ({ method: m, count: payments.filter(p => p.method === m).length }))
        .filter(x => x.count > 0);

    const dues = members
        .filter(m => Number(m.amount_due) > 0)
        .sort((a, b) => Number(b.amount_due) - Number(a.amount_due));
    const duesTotal = dues.reduce((s, m) => s + Number(m.amount_due), 0);

    const fmt = (n) => `₹${Number(n).toLocaleString()}`;

    return (
        <Box>
            <Alerts items={[
                error && { severity: 'error', text: error },
                loadError && { severity: 'error', text: loadError },
            ]} />

            {/* Summary */}
            <Grid container spacing={2} mb={3}>
                <Grid item xs={6} md={3}>
                    <MiniStat icon={<ReceiptLong />} label="Total Collected" value={fmt(total)} color="secondary" />
                </Grid>
                <Grid item xs={6} md={3}>
                    <MiniStat icon={<TrendingUp />} label="This Month" value={fmt(monthTotal)} color="success" />
                </Grid>
                <Grid item xs={6} md={3}>
                    <MiniStat icon={<Today />} label="Today" value={fmt(todayTotal)} color="warning" />
                </Grid>
                <Grid item xs={6} md={3}>
                    <MiniStat icon={<PaymentsIcon />} label="Payments" value={payments.length} color="info" />
                </Grid>
            </Grid>

            {/* Outstanding dues */}
            {isAdmin && (
                <Paper sx={{ p: 3, mb: 3, border: '1px solid', borderColor: dues.length ? 'warning.main' : 'divider' }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1} mb={2}>
                        <Stack direction="row" alignItems="center" spacing={1}>
                            <Typography variant="h6">Outstanding Dues</Typography>
                            <Chip
                                size="small"
                                label={dues.length === 0 ? 'All clear' : `${dues.length} member(s) · ${fmt(duesTotal)}`}
                                color={dues.length ? 'warning' : 'success'}
                                variant="outlined"
                            />
                        </Stack>
                        {dues.length > 0 && (
                            <Button
                                variant="outlined" color="warning" startIcon={<PaymentsIcon />}
                                onClick={handleCollectAll}
                            >
                                Collect All
                            </Button>
                        )}
                    </Box>

                    {dues.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                            No outstanding balances. 🎉
                        </Typography>
                    ) : (
                        <TableContainer>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Member</TableCell>
                                        <TableCell>Phone</TableCell>
                                        <TableCell>Membership</TableCell>
                                        <TableCell>Due</TableCell>
                                        <TableCell align="right">Actions</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {dues.map(m => (
                                        <TableRow key={m.id}>
                                            <TableCell>
                                                <Box display="flex" alignItems="center" gap={1.5}>
                                                    <Avatar sx={{ bgcolor: 'warning.softBg', color: 'warning.dark', width: 30, height: 30, fontSize: 12, fontWeight: 700 }}>
                                                        {initialsOf(m.name)}
                                                    </Avatar>
                                                    <Box>
                                                        <Typography variant="body2" fontWeight={600}>{m.name}</Typography>
                                                        <Typography variant="caption" color="text.secondary">ID {m.member_code}</Typography>
                                                    </Box>
                                                </Box>
                                            </TableCell>
                                            <TableCell>{m.phone || '—'}</TableCell>
                                            <TableCell>
                                                <Typography variant="body2">{m.membership_type || '—'}</Typography>
                                                <Typography variant="caption" color="text.secondary">exp {m.membership_expiry || '—'}</Typography>
                                            </TableCell>
                                            <TableCell>
                                                <Typography variant="body1" fontWeight={800} color="error.main">
                                                    {fmt(m.amount_due)}
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="right">
                                                <Button size="small" variant="contained" color="warning" startIcon={<Add />}
                                                    onClick={() => handleCollect(m)}>
                                                    Collect
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}
                </Paper>
            )}

            <Paper sx={{ p: 3 }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1} mb={2}>
                    <Box>
                        <Typography variant="h6">Payment History</Typography>
                        {methodCounts.length > 0 && (
                            <Stack direction="row" spacing={1} mt={0.5} flexWrap="wrap">
                                {methodCounts.map(x => (
                                    <Chip key={x.method} size="small" label={`${x.method} × ${x.count}`} variant="outlined" />
                                ))}
                            </Stack>
                        )}
                    </Box>
                    {isAdmin && (
                        <Button variant="contained" startIcon={<Add />} onClick={openAdd}>
                            Record Payment
                        </Button>
                    )}
                </Box>

                <TableContainer>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>Receipt</TableCell>
                                <TableCell>Member</TableCell>
                                <TableCell>Amount</TableCell>
                                <TableCell>Date</TableCell>
                                <TableCell>Method</TableCell>
                                <TableCell>For</TableCell>
                                <TableCell align="right">Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {payments.map(p => (
                                <TableRow key={p.id} hover>
                                    <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                                        {receiptNo(p)}
                                    </TableCell>
                                    <TableCell>
                                        <Box display="flex" alignItems="center" gap={1.5}>
                                            <Avatar sx={{ bgcolor: 'secondary.softBg', color: 'secondary.dark', width: 30, height: 30, fontSize: 12, fontWeight: 700 }}>
                                                {initialsOf(p.member_name)}
                                            </Avatar>
                                            <Box>
                                                <Typography variant="body2" fontWeight={600}>
                                                    {p.member_name || `Member #${p.member_id}`}
                                                </Typography>
                                                {p.member_code && (
                                                    <Typography variant="caption" color="text.secondary">
                                                        ID {p.member_code}
                                                    </Typography>
                                                )}
                                            </Box>
                                        </Box>
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="body1" fontWeight={800} color="success.main">
                                            {fmt(p.amount)}
                                        </Typography>
                                    </TableCell>
                                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(p.payment_date)}</TableCell>
                                    <TableCell>
                                        <Chip size="small" label={p.method} variant="outlined" />
                                    </TableCell>
                                    <TableCell sx={{ maxWidth: 300 }}>
                                        {/* Read off the payment row, so this and its printed
                                            receipt can never say two different things. */}
                                        {(() => {
                                            const d = describePayment(p);
                                            return (
                                                <>
                                                    <Typography variant="body2" fontWeight={600}>{d.title}</Typography>
                                                    {d.period && (
                                                        <Typography variant="caption" color="text.secondary" display="block">
                                                            {d.period}
                                                        </Typography>
                                                    )}
                                                    {Number(p.discount) > 0 && (
                                                        <Typography variant="caption" color="success.main" display="block">
                                                            Referral reward {fmt(p.discount)} off
                                                        </Typography>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </TableCell>
                                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                        <Button size="small" startIcon={<Download />} onClick={() => openReceipt(p)}>
                                            Receipt
                                        </Button>
                                        {isAdmin && (
                                            <IconButton onClick={() => handleDelete(p.id)} title="Delete" color="error">
                                                <Delete />
                                            </IconButton>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                            {payments.length === 0 && (
                                <TableRow><TableCell colSpan={7} align="center">No payments recorded yet.</TableCell></TableRow>
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Paper>

            {/* Record payment dialog */}
            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Record Payment</DialogTitle>
                <DialogContent>
                    <Alerts items={[error && { severity: 'error', text: error }]} />
                    <Grid container spacing={2} sx={{ mt: 0.5 }}>
                        <Grid item xs={12}>
                            <TextField
                                select fullWidth label="Member" name="member_id" value={form.member_id}
                                onChange={e => setForm({ ...form, member_id: e.target.value })}
                            >
                                {members.map(m => (
                                    <MenuItem key={m.id} value={m.id}>{m.name} (ID {m.member_code})</MenuItem>
                                ))}
                            </TextField>
                        </Grid>
                        <Grid item xs={6}>
                            <TextField fullWidth type="number" label="Amount (₹)" name="amount" value={form.amount}
                                onChange={e => setForm({ ...form, amount: e.target.value })} />
                        </Grid>
                        <Grid item xs={6}>
                            <TextField select fullWidth label="Method" name="method" value={form.method}
                                onChange={e => setForm({ ...form, method: e.target.value })}>
                                {PAYMENT_MODES.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                            </TextField>
                        </Grid>
                        <Grid item xs={12}>
                            <TextField fullWidth type="date" label="Payment Date" name="payment_date" value={form.payment_date}
                                onChange={e => setForm({ ...form, payment_date: e.target.value })} InputLabelProps={{ shrink: true }} />
                        </Grid>
                        <Grid item xs={12}>
                            <TextField fullWidth label="Note" name="note" value={form.note}
                                onChange={e => setForm({ ...form, note: e.target.value })} />
                        </Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleSave}>Save Payment</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default PaymentsPage;
