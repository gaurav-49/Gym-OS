// frontend/src/components/PlansPage.jsx
// Membership plans master: the packages the gym sells. Durations and prices used
// to be hardcoded in the backend, so this page is what makes them the gym's own.
// Editing a plan's duration changes what every future renewal computes.

import React, { useEffect, useState } from 'react';
import {
    Box, Paper, TextField, MenuItem, Chip, IconButton, Tooltip, Switch, FormControlLabel, GridLegacy as Grid, TableCell, Typography, } from '@mui/material';
import { Add, Edit, Delete, CardMembership, Groups, Schedule, Sell, TrendingUp,
} from '@mui/icons-material';
import api from '../api';
import { log, logError } from '../logger';
import Alerts from './Alerts';
import { PageHeader, StatCards, ModuleTable, FormDialog, useExceptions, money, moneyShort, useConfirm, useToast } from './ui';

const FALLBACK_RULES = [
    { code: 'E1101', field_name: 'name', field_label: 'Plan Name', message: 'PLAN NAME IS MANDATORY', is_mandatory: true },
    { code: 'E1102', field_name: 'duration_days', field_label: 'Duration (days)', message: 'DURATION IS MANDATORY', format_message: 'NUMBER ONLY ALLOWED', is_mandatory: true, allowed_chars: 'numeric' },
    { code: 'E1103', field_name: 'price', field_label: 'Price', message: 'PRICE IS MANDATORY', format_message: 'NUMBER ONLY ALLOWED', is_mandatory: true, allowed_chars: 'numeric' },
];

const emptyForm = { name: '', duration_days: '30', price: '', signup_fee: '0', description: '', sort_order: '0', is_active: true };

const PlansPage = ({ isAdmin }) => {
    const toast = useToast();
    const [plans, setPlans] = useState([]);
    // Distinguishes "still loading" from "genuinely empty" — without it the
    // table showed its empty state on every page load.
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(emptyForm);
    const [formErrors, setFormErrors] = useState({});
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState('');
    const [busy, setBusy] = useState(false);

    const { validate, liveCheck, isRequired } = useExceptions('plans', FALLBACK_RULES);

    const fetchPlans = async () => {
        try {
            const res = await api.get('/plans');
            setPlans(res.data);
            setLoadError('');
        } catch (err) {
            logError('PlansPage', 'fetchPlans', `✗ ${err.response?.data?.error || err.message}`, err);
            setLoadError(err.response?.data?.error || 'Failed to load plans.');
        } finally { setLoading(false); }
    };
    useEffect(() => { fetchPlans(); }, []);

    const openCreate = () => {
        setEditing(null); setForm(emptyForm); setFormErrors({}); setError(''); setDialogOpen(true);
    };
    const openEdit = (plan) => {
        setEditing(plan);
        setForm({
            name: plan.name,
            duration_days: String(plan.duration_days),
            price: String(plan.price),
            signup_fee: String(plan.signup_fee),
            description: plan.description || '',
            sort_order: String(plan.sort_order),
            is_active: plan.is_active,
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
            log('PlansPage', 'handleSave', `→ validation blocked: ${Object.keys(errors).join(', ')}`);
            setError('');
            return;
        }
        setBusy(true); setError('');
        log('PlansPage', 'handleSave', `→ ${editing ? 'update' : 'create'} plan "${form.name}" ${form.duration_days}d ₹${form.price}`);
        const payload = {
            name: form.name.trim(),
            duration_days: Number(form.duration_days),
            price: Number(form.price),
            signup_fee: Number(form.signup_fee || 0),
            description: form.description,
            sort_order: Number(form.sort_order || 0),
            is_active: form.is_active,
        };
        try {
            if (editing) {
                await api.put(`/plans/${editing.id}`, payload);
                toast.success(`Plan "${payload.name}" updated.`);
            } else {
                await api.post('/plans', payload);
                toast.success(`Plan "${payload.name}" added — it can now be sold to members.`);
            }
            setDialogOpen(false);
            fetchPlans();
        } catch (err) {
            logError('PlansPage', 'handleSave', `✗ "${form.name}": ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to save the plan.');
        } finally { setBusy(false); }
    };

    const confirm = useConfirm();

    const handleDelete = async (plan) => {
        if (!await confirm({
            title: `Delete the ${plan.name} plan?`,
            /* This used to promise "Members already on it keep their current
               expiry" — an outcome the server never produces. Deletion is
               refused outright while any member record names the plan, so the
               dialog was describing a path that does not exist. */
            body: <>The plan is removed from the catalogue for good. It is only possible because no member record names it — use Hidden instead if you just want to stop offering it.</>,
            confirmLabel: 'Delete plan', danger: true,
        })) return;
        setError(''); toast.success('');
        log('PlansPage', 'handleDelete', `→ delete plan id=${plan.id} "${plan.name}"`);
        try {
            const res = await api.delete(`/plans/${plan.id}`);
            toast.success(res.data.message);
            fetchPlans();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to delete the plan.');
        }
    };

    const toggleActive = async (plan) => {
        try {
            await api.put(`/plans/${plan.id}`, { is_active: !plan.is_active });
            toast.success(`"${plan.name}" is now ${plan.is_active ? 'hidden from' : 'available for'} new memberships.`);
            fetchPlans();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to update the plan.');
        }
    };

    const filtered = plans.filter(p =>
        !search || p.name.toLowerCase().includes(search.toLowerCase())
        || (p.description || '').toLowerCase().includes(search.toLowerCase()));

    const activeCount = plans.filter(p => p.is_active).length;
    const totalMembers = plans.reduce((s, p) => s + p.active_members, 0);
    const revenue = plans.reduce((s, p) => s + p.active_members * Number(p.price), 0);
    const cheapest = plans.filter(p => p.is_active && Number(p.price) > 0)
        .sort((a, b) => Number(a.price) - Number(b.price))[0];

    const columns = [
        { key: 'name', label: 'Plan' },
        { key: 'duration', label: 'Duration', align: 'right' },
        { key: 'price', label: 'Price', align: 'right' },
        { key: 'signup', label: 'Sign-up fee', align: 'right' },
        { key: 'members', icon: <Groups />, label: 'Active members', align: 'right' },
        { key: 'status', label: 'Status' },
        { key: 'actions', label: 'Actions', align: 'right' },
    ];

    return (
        <Box>
            <Alerts items={[
                error && { severity: 'error', text: error },
                loadError && { severity: 'error', text: loadError },
            ]} />

            <StatCards columns={4} items={[
                { key: 'total', icon: <CardMembership />, label: 'Plans offered', value: activeCount, color: 'primary', hint: plans.length === activeCount ? undefined : `${plans.length} incl. hidden` },
                { key: 'members', label: 'Active members on a plan', value: totalMembers, color: 'info' },
                { key: 'revenue', icon: <TrendingUp />, label: 'Recurring value', value: moneyShort(revenue), color: 'success', hint: 'if all renewed once' },
                { key: 'entry', icon: <Sell />, label: 'Entry price', value: cheapest ? moneyShort(cheapest.price) : '—', color: 'warning', hint: cheapest?.name },
            ]} />

            <Paper elevation={3} sx={{ p: 3 }}>
                <PageHeader
                    icon={CardMembership}
                    title="Membership Plans"
                    count={filtered.length}
                    search={search}
                    onSearch={setSearch}
                    searchPlaceholder="Search plans…"
                    actionLabel={isAdmin ? 'Add plan' : undefined}
                    actionIcon={<Add />}
                    onAction={openCreate}
                />

                <Typography variant="body2" color="text.secondary" mb={2}>
                    A plan's <b>duration</b> drives every expiry the system computes — new memberships,
                    renewals, upgrades and auto-renew all read it from here.
                </Typography>

                <ModuleTable
                    loading={loading}columns={columns}
                    rows={filtered}
                    empty={{
                        icon: CardMembership,
                        title: search ? 'No plans match that search' : 'No membership plans yet',
                        hint: search
                            ? 'Try a shorter search, or clear it to see every plan.'
                            : 'A plan sets the price and the duration that drives every expiry the system calculates.',
                        actionLabel: !search && isAdmin ? 'Add plan' : undefined,
                        actionIcon: <Add />,
                        onAction: openCreate,
                    }}
                    renderRow={(p) => (
                        <>
                            <TableCell>
                                <Typography variant="body2" fontWeight={600}>{p.name}</Typography>
                                {p.description && (
                                    <Typography variant="caption" color="text.secondary">{p.description}</Typography>
                                )}
                            </TableCell>
                            <TableCell align="right">
                                <Chip size="small" variant="outlined" icon={<Schedule fontSize="small" />}
                                    label={`${p.duration_days} days`} />
                            </TableCell>
                            <TableCell align="right">
                                <Typography variant="body2" fontWeight={700}>{money(p.price)}</Typography>
                            </TableCell>
                            <TableCell align="right">
                                <Typography variant="body2" color="text.secondary">
                                    {Number(p.signup_fee) > 0 ? money(p.signup_fee) : '—'}
                                </Typography>
                            </TableCell>
                            <TableCell align="right">
                                <Chip size="small" icon={<Groups fontSize="small" />} label={p.active_members}
                                    color={p.active_members > 0 ? 'info' : 'default'} variant="outlined" />
                            </TableCell>
                            <TableCell>
                                <Chip size="small" label={p.is_active ? 'Offered' : 'Hidden'}
                                    color={p.is_active ? 'success' : 'default'}
                                    onClick={isAdmin ? () => toggleActive(p) : undefined}
                                    sx={{ cursor: isAdmin ? 'pointer' : 'default' }}
                                    title={isAdmin ? 'Click to toggle whether new members can pick this plan' : undefined} />
                            </TableCell>
                            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                {isAdmin && (
                                    <>
                                        <IconButton size="small" title="Edit plan" onClick={() => openEdit(p)}>
                                            <Edit fontSize="small" />
                                        </IconButton>
                                        {/* Gated on total_members, which is what the
                                            server actually enforces. Gated on
                                            active_members, a plan with 96 expired
                                            members and none active offered an enabled
                                            delete button that always failed. */}
                                        <Tooltip title={p.total_members > 0
                                            ? `${p.total_members} member record(s) name this plan — hide it instead`
                                            : 'Delete plan'}>
                                            <span>
                                                <IconButton size="small" color="error" onClick={() => handleDelete(p)}
                                                    disabled={p.total_members > 0}>
                                                    <Delete fontSize="small" />
                                                </IconButton>
                                            </span>
                                        </Tooltip>
                                    </>
                                )}
                            </TableCell>
                        </>
                    )}
                />
            </Paper>

            <FormDialog
                open={dialogOpen}
                title={editing ? `Edit Plan — ${editing.name}` : 'Add a Membership Plan'}
                onClose={() => setDialogOpen(false)}
                errors={formErrors}
                error={error}
                submitLabel={editing ? 'Save changes' : 'Add plan'}
                submitIcon={<Add />}
                onSubmit={handleSave}
                busy={busy}
            >
                <Grid item xs={12} sm={8}>
                    {/* The server refuses a rename while ANY member record names
                        the plan — the name IS the foreign key on
                        clients.membership_type — so the field locks on that count,
                        not on the active subset. */}
                    <TextField fullWidth required={isRequired('name')} label="Plan Name" value={form.name}
                        error={!!formErrors.name} onChange={e => setField('name', e.target.value)}
                        placeholder="e.g. Quarterly"
                        helperText={editing && editing.total_members > 0
                            ? `${editing.total_members} member record(s) name this plan — the name is locked`
                            : ' '}
                        disabled={!!editing && editing.total_members > 0} />
                </Grid>
                <Grid item xs={12} sm={4}>
                    <TextField fullWidth required={isRequired('duration_days')} type="number" label="Duration (days)"
                        value={form.duration_days} error={!!formErrors.duration_days}
                        onChange={e => setField('duration_days', e.target.value)}
                        inputProps={{ min: 1, max: 3650 }} helperText="Drives every expiry" />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField fullWidth required={isRequired('price')} type="number" label="Price (₹)"
                        value={form.price} error={!!formErrors.price}
                        onChange={e => setField('price', e.target.value)} inputProps={{ min: 0 }} />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField fullWidth type="number" label="Sign-up Fee (₹)" value={form.signup_fee}
                        error={!!formErrors.signup_fee}
                        onChange={e => setField('signup_fee', e.target.value)} inputProps={{ min: 0 }}
                        helperText="One-time joining charge" />
                </Grid>
                <Grid item xs={12}>
                    <TextField fullWidth multiline rows={2} label="Description" value={form.description}
                        onChange={e => setField('description', e.target.value)}
                        placeholder="What the member gets — shown on the plan list" />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField fullWidth type="number" label="Sort Order" value={form.sort_order}
                        onChange={e => setField('sort_order', e.target.value)} inputProps={{ min: 0 }}
                        helperText="Lower numbers list first" />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <FormControlLabel
                        sx={{ mt: 1 }}
                        control={<Switch checked={form.is_active}
                            onChange={e => setField('is_active', e.target.checked)} />}
                        label="Offered to new members"
                    />
                </Grid>
            </FormDialog>
        </Box>
    );
};

export default PlansPage;
