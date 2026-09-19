// frontend/src/components/FinancePage.jsx
// Expenses and profit & loss. `payments` only ever recorded income, so the app
// could show collections but never profitability. This page adds the outgoing
// side and charts income (memberships + counter sales) against it.

import React, { useEffect, useState } from 'react';
import {
    Box, Paper, TextField, MenuItem, Chip, IconButton, Tabs, Tab, GridLegacy as Grid, TableCell, Typography, Divider, } from '@mui/material';
import {
    Add, Edit, Delete, ReceiptLong, TrendingUp, TrendingDown, AccountBalance, Savings, Today,
} from '@mui/icons-material';
import {
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend, Line, ComposedChart,
} from 'recharts';
import api from '../api';
import { log, logError } from '../logger';
import Alerts from './Alerts';
import { useChartTheme } from './ui/chartTheme';
import { PAYMENT_MODES } from '../constants';
import { PageHeader, StatCards, ModuleTable, FormDialog, useExceptions, money, moneyShort, fmtDate, todayStr, useConfirm, useToast } from './ui';

const CATEGORIES = [
    'Rent', 'Salaries', 'Utilities', 'Equipment', 'Maintenance',
    'Marketing', 'Supplies', 'Insurance', 'Taxes', 'Other',
];

const FALLBACK_RULES = [
    { code: 'E1401', field_name: 'category', field_label: 'Category', message: 'CATEGORY IS MANDATORY', is_mandatory: true },
    { code: 'E1402', field_name: 'description', field_label: 'Description', message: 'DESCRIPTION IS MANDATORY', is_mandatory: true },
    { code: 'E1403', field_name: 'amount', field_label: 'Amount', message: 'AMOUNT IS MANDATORY', format_message: 'NUMBER ONLY ALLOWED', is_mandatory: true, allowed_chars: 'numeric' },
    { code: 'E1404', field_name: 'expense_date', field_label: 'Date', message: 'DATE IS MANDATORY', is_mandatory: true },
    { code: 'E1405', field_name: 'method', field_label: 'Payment Method', message: 'PAYMENT METHOD IS MANDATORY', is_mandatory: true },
];

const emptyForm = () => ({
    category: 'Rent', description: '', amount: '', expense_date: todayStr(),
    method: 'Cash', vendor: '', reference: '',
});

const FinancePage = () => {
    const chart = useChartTheme();
    const toast = useToast();
    const [tab, setTab] = useState(0);
    const [expenses, setExpenses] = useState([]);
    // Distinguishes "still loading" from "genuinely empty" — without it the
    // table showed its empty state on every page load.
    const [loading, setLoading] = useState(true);
    const [summary, setSummary] = useState(null);
    const [search, setSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(emptyForm());
    const [formErrors, setFormErrors] = useState({});
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState('');
    const [busy, setBusy] = useState(false);

    const { validate, liveCheck, isRequired } = useExceptions('expenses', FALLBACK_RULES);

    const fetchExpenses = async () => {
        try {
            const res = await api.get('/expenses', { params: { search: search || undefined, category: categoryFilter || undefined } });
            setExpenses(res.data);
            setLoadError('');
        } catch (err) {
            logError('FinancePage', 'fetchExpenses', `✗ ${err.response?.data?.error || err.message}`, err);
            setLoadError(err.response?.data?.error || 'Failed to load expenses.');
        } finally { setLoading(false); }
    };
    const fetchSummary = async () => {
        try {
            const res = await api.get('/finance/summary', { params: { months: 6 } });
            setSummary(res.data);
        } catch (err) {
            setLoadError(err.response?.data?.error || 'Failed to load the P&L summary.');
        }
    };
    useEffect(() => { fetchExpenses(); }, [search, categoryFilter]);
    useEffect(() => { fetchSummary(); }, []);

    const openCreate = () => { setEditing(null); setForm(emptyForm()); setFormErrors({}); setError(''); setDialogOpen(true); };
    const openEdit = (e) => {
        setEditing(e);
        setForm({
            category: e.category, description: e.description, amount: String(e.amount),
            expense_date: String(e.expense_date).slice(0, 10), method: e.method,
            vendor: e.vendor || '', reference: e.reference || '',
        });
        setFormErrors({}); setError(''); setDialogOpen(true);
    };

    const setField = (name, value) => {
        setForm(f => ({ ...f, [name]: value }));
        const next = { ...formErrors };
        delete next[name];
        const live = liveCheck(name, value);
        if (live) next[name] = live;
        setFormErrors(next);
    };

    const handleSave = async () => {
        const errors = validate(form);
        setFormErrors(errors);
        if (Object.keys(errors).length > 0) {
            log('FinancePage', 'handleSave', `→ validation blocked: ${Object.keys(errors).join(', ')}`);
            return;
        }
        setBusy(true); setError('');
        log('FinancePage', 'handleSave', `→ ${editing ? 'update' : 'create'} ${form.category} expense ₹${form.amount}`);
        const payload = {
            category: form.category, description: form.description.trim(), amount: Number(form.amount),
            expense_date: form.expense_date, method: form.method,
            vendor: form.vendor, reference: form.reference,
        };
        try {
            if (editing) {
                await api.put(`/expenses/${editing.id}`, payload);
                toast.success('Expense updated.');
            } else {
                await api.post('/expenses', payload);
                toast.success(`${payload.category} expense of ${money(payload.amount)} recorded.`);
            }
            setDialogOpen(false);
            fetchExpenses(); fetchSummary();
        } catch (err) {
            logError('FinancePage', 'handleSave', `✗ ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to save the expense.');
        } finally { setBusy(false); }
    };

    const confirm = useConfirm();

    const handleDelete = async (e) => {
        if (!await confirm({
            title: 'Delete this expense?',
            body: <>It comes out of the profit &amp; loss for its month.</>,
            confirmLabel: 'Delete expense', danger: true,
        })) return;
        setError(''); toast.success('');
        try {
            await api.delete(`/expenses/${e.id}`);
            toast.success('Expense deleted.');
            fetchExpenses(); fetchSummary();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to delete the expense.');
        }
    };

    const t = summary?.totals;
    const profitColor = (v) => (Number(v) >= 0 ? 'success' : 'error');

    const columns = [
        { key: 'date', label: 'Date' },
        { key: 'category', label: 'Category' },
        { key: 'description', label: 'Description' },
        { key: 'vendor', label: 'Vendor' },
        { key: 'method', label: 'Method' },
        { key: 'amount', label: 'Amount', align: 'right' },
        { key: 'actions', label: '', align: 'right' },
    ];

    return (
        <Box>
            <Alerts items={[
                error && { severity: 'error', text: error },
                loadError && { severity: 'error', text: loadError },
            ]} />

            <StatCards columns={5} items={[
                { key: 'income', icon: <TrendingUp />, label: 'Income this month', value: moneyShort(t?.month_income ?? 0), color: 'success',
                  hint: t ? `${moneyShort(t.month_membership)} plans · ${moneyShort(t.month_pos)} counter` : undefined },
                { key: 'expenses', icon: <TrendingDown />, label: 'Expenses this month', value: moneyShort(t?.month_expenses ?? 0), color: 'error' },
                { key: 'profit', icon: <AccountBalance />, label: 'Profit this month', value: moneyShort(t?.month_profit ?? 0), color: profitColor(t?.month_profit) },
                { key: 'today-in', icon: <Today />, label: 'Income today', value: moneyShort(t?.today_income ?? 0), color: 'info' },
                { key: 'today-profit', icon: <Savings />, label: 'Profit today', value: moneyShort(t?.today_profit ?? 0), color: profitColor(t?.today_profit) },
            ]} />

            <Paper elevation={3} sx={{ p: 3 }}>
                <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ mb: 2 }}>
                    <Tab icon={<AccountBalance fontSize="small" />} iconPosition="start" label="Profit & Loss" />
                    <Tab icon={<ReceiptLong fontSize="small" />} iconPosition="start" label={`Expenses (${expenses.length})`} />
                </Tabs>

                {tab === 0 && (
                    <>
                        <PageHeader icon={AccountBalance} title="Profit & Loss" />
                        {!summary ? (
                            <Typography variant="body2" color="text.secondary">Loading…</Typography>
                        ) : summary.series.length === 0 ? (
                            <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                                No income or expenses recorded in the last {summary.months} months yet.
                            </Typography>
                        ) : (
                            <>
                                <Typography variant="body2" color="text.secondary" mb={2}>
                                    Income is membership payments plus counter sales. The line is profit —
                                    where it dips below zero the month ran at a loss.
                                </Typography>
                                <Box sx={{ width: '100%', height: 320 }}>
                                    <ResponsiveContainer>
                                        <ComposedChart data={summary.series} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                                            <CartesianGrid {...chart.grid} vertical={false} />
                                            <XAxis dataKey="month" {...chart.axis} />
                                            <YAxis {...chart.axis} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                                            <RTooltip {...chart.tooltip} formatter={(v, n) => [money(v), n]} />
                                            <Legend {...chart.legend} />
                                            <Bar dataKey="income" name="Income" fill="#10b981" radius={[4, 4, 0, 0]} />
                                            <Bar dataKey="expenses" name="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
                                            <Line type="monotone" dataKey="profit" name="Profit" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3 }} />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </Box>

                                <Divider sx={{ my: 3 }} />
                                <Typography variant="subtitle1" mb={1.5}>Where the money went</Typography>
                                {summary.expense_by_category.length === 0 ? (
                                    <Typography variant="body2" color="text.secondary">
                                        No expenses recorded yet — add one on the Expenses tab.
                                    </Typography>
                                ) : (
                                    <Box sx={{ width: '100%', height: 260 }}>
                                        <ResponsiveContainer>
                                            <BarChart data={summary.expense_by_category} layout="vertical"
                                                margin={{ top: 4, right: 24, bottom: 4, left: 24 }}>
                                                <CartesianGrid {...chart.grid} horizontal={false} />
                                                <XAxis type="number" {...chart.axis}
                                                    tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                                                <YAxis type="category" dataKey="category" {...chart.axis} width={90} />
                                                <RTooltip {...chart.tooltip} formatter={(v) => money(v)} />
                                                <Bar dataKey="total" name="Spent" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </Box>
                                )}
                            </>
                        )}
                    </>
                )}

                {tab === 1 && (
                    <>
                        <PageHeader
                            icon={ReceiptLong}
                            title="Expenses"
                            count={expenses.length}
                            search={search}
                            onSearch={setSearch}
                            searchPlaceholder="Search by description or vendor…"
                            actionLabel="Record expense"
                            actionIcon={<Add />}
                            onAction={openCreate}
                            extraActions={
                                <TextField select size="small" label="Category" value={categoryFilter}
                                    onChange={e => setCategoryFilter(e.target.value)} sx={{ minWidth: 150 }}>
                                    <MenuItem value="">All categories</MenuItem>
                                    {CATEGORIES.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                                </TextField>
                            }
                        />
                        <ModuleTable
                            loading={loading}columns={columns}
                            rows={expenses}
                            empty={{
                                icon: TrendingDown,
                                title: 'No expenses recorded',
                                hint: 'Rent, salaries, electricity, equipment — record them here and the profit & loss above starts telling the truth.',
                                actionLabel: 'Record expense',
                                actionIcon: <Add />,
                                onAction: openCreate,
                            }}
                            renderRow={(e) => (
                                <>
                                    <TableCell><Typography variant="caption">{fmtDate(e.expense_date)}</Typography></TableCell>
                                    <TableCell><Chip size="small" variant="outlined" label={e.category} /></TableCell>
                                    <TableCell>
                                        <Typography variant="body2">{e.description}</Typography>
                                        {e.reference && (
                                            <Typography variant="caption" color="text.secondary">Ref {e.reference}</Typography>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="caption" color="text.secondary">{e.vendor || '—'}</Typography>
                                    </TableCell>
                                    <TableCell><Chip size="small" variant="outlined" label={e.method} /></TableCell>
                                    <TableCell align="right">
                                        <Typography variant="body2" fontWeight={700} color="error.main">
                                            −{money(e.amount)}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                        <IconButton size="small" title="Edit" onClick={() => openEdit(e)}>
                                            <Edit fontSize="small" />
                                        </IconButton>
                                        <IconButton size="small" color="error" title="Delete" onClick={() => handleDelete(e)}>
                                            <Delete fontSize="small" />
                                        </IconButton>
                                    </TableCell>
                                </>
                            )}
                        />
                    </>
                )}
            </Paper>

            <FormDialog
                open={dialogOpen}
                title={editing ? 'Edit Expense' : 'Record an Expense'}
                onClose={() => setDialogOpen(false)}
                errors={formErrors} error={error}
                submitLabel={editing ? 'Save changes' : 'Record expense'}
                submitIcon={<Add />} onSubmit={handleSave} busy={busy}
            >
                <Grid item xs={12} sm={6}>
                    <TextField select fullWidth required={isRequired('category')} label="Category" value={form.category}
                        error={!!formErrors.category} onChange={e => setField('category', e.target.value)}>
                        {CATEGORIES.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                    </TextField>
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField fullWidth required={isRequired('expense_date')} type="date" label="Date"
                        value={form.expense_date} error={!!formErrors.expense_date}
                        onChange={e => setField('expense_date', e.target.value)}
                        InputLabelProps={{ shrink: true }} />
                </Grid>
                <Grid item xs={12}>
                    <TextField fullWidth required={isRequired('description')} label="Description"
                        value={form.description} error={!!formErrors.description}
                        onChange={e => setField('description', e.target.value)}
                        placeholder="e.g. September studio rent" />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField fullWidth required={isRequired('amount')} type="number" label="Amount (₹)"
                        value={form.amount} error={!!formErrors.amount}
                        onChange={e => setField('amount', e.target.value)} inputProps={{ min: 0 }} />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField select fullWidth required={isRequired('method')} label="Payment Method"
                        value={form.method} error={!!formErrors.method}
                        onChange={e => setField('method', e.target.value)}>
                        {PAYMENT_MODES.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                    </TextField>
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField fullWidth label="Vendor" value={form.vendor}
                        onChange={e => setField('vendor', e.target.value)} placeholder="Who was paid" />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField fullWidth label="Reference" value={form.reference}
                        onChange={e => setField('reference', e.target.value)}
                        placeholder="Bill / cheque number" />
                </Grid>
            </FormDialog>
        </Box>
    );
};

export default FinancePage;
