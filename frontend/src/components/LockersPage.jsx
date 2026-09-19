// frontend/src/components/LockersPage.jsx
// Locker management: which lockers exist, who holds each one, until when, and
// what it rents for. Stat tiles double as status filters.

import React, { useEffect, useState } from 'react';
import {
    Box, Paper, TextField, MenuItem, Chip, IconButton, Tooltip, Button, GridLegacy as Grid, TableCell, Typography, Autocomplete, FormControlLabel, Switch } from '@mui/material';
import {
    Add, Edit, Delete, Lock, LockOpen, Build, PersonAdd, PersonRemove, EventBusy, Payments,
} from '@mui/icons-material';
import api from '../api';
import { PAYMENT_MODES } from '../constants';
import { log, logError } from '../logger';
import Alerts from './Alerts';
import { PageHeader, StatCards, ModuleTable, FormDialog, useExceptions, money, fmtDate, useConfirm, useToast } from './ui';

const SIZES = ['Small', 'Medium', 'Large'];

const FALLBACK_RULES = [
    { code: 'E1201', field_name: 'locker_number', field_label: 'Locker Number', message: 'LOCKER NUMBER IS MANDATORY', is_mandatory: true },
    { code: 'E1202', field_name: 'size', field_label: 'Size', message: 'SIZE IS MANDATORY', is_mandatory: true },
];

const emptyForm = { locker_number: '', location: '', size: 'Medium', monthly_rent: '0', notes: '' };

const STATUS_COLOR = { free: 'success', occupied: 'info', maintenance: 'warning' };
const STATUS_LABEL = { free: 'Free', occupied: 'Occupied', maintenance: 'Maintenance' };

const LockersPage = ({ isAdmin }) => {
    const toast = useToast();
    const [lockers, setLockers] = useState([]);
    // Distinguishes "still loading" from "genuinely empty" — without it the
    // table showed its empty state on every page load.
    const [loading, setLoading] = useState(true);
    const [members, setMembers] = useState([]);
    const [statusFilter, setStatusFilter] = useState('');
    const [search, setSearch] = useState('');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(emptyForm);
    const [formErrors, setFormErrors] = useState({});
    const [assignOpen, setAssignOpen] = useState(false);
    const [assignLocker, setAssignLocker] = useState(null);
    const [assignForm, setAssignForm] = useState({ member: null, months: '1', collect: true, method: 'Cash' });
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState('');
    const [busy, setBusy] = useState(false);

    const { validate, liveCheck, isRequired } = useExceptions('lockers', FALLBACK_RULES);

    const [allLockers, setAllLockers] = useState([]);

    // Tiles summarise the whole set, so they read from an unfiltered copy.
    // The list request sends `status` and `search` to the server, so building
    // the tiles from its result made a search change the totals the tiles
    // report — and clicking a status tile made that tile's own count the only
    // non-zero one on the row.
    const fetchAllLockers = () => api.get('/lockers')
        .then(res => setAllLockers(res.data))
        .catch(() => setAllLockers([]));

    const fetchLockers = async () => {
        try {
            const res = await api.get('/lockers', { params: { status: statusFilter || undefined, search: search || undefined } });
            setLockers(res.data);
            setLoadError('');
            fetchAllLockers();
        } catch (err) {
            logError('LockersPage', 'fetchLockers', `✗ ${err.response?.data?.error || err.message}`, err);
            setLoadError(err.response?.data?.error || 'Failed to load lockers.');
        } finally { setLoading(false); }
    };
    useEffect(() => { fetchLockers(); }, [statusFilter, search]);

    useEffect(() => {
        api.get('/clients')
            .then(res => setMembers(res.data.filter(m => m.status === 'active')))
            .catch(() => setMembers([]));
    }, []);

    const openCreate = () => { setEditing(null); setForm(emptyForm); setFormErrors({}); setError(''); setDialogOpen(true); };
    const openEdit = (l) => {
        setEditing(l);
        setForm({
            locker_number: l.locker_number, location: l.location || '', size: l.size,
            monthly_rent: String(l.monthly_rent), notes: l.notes || '',
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
            log('LockersPage', 'handleSave', `→ validation blocked: ${Object.keys(errors).join(', ')}`);
            return;
        }
        setBusy(true); setError('');
        log('LockersPage', 'handleSave', `→ ${editing ? 'update' : 'create'} locker ${form.locker_number}`);
        const payload = {
            locker_number: form.locker_number.trim(), location: form.location,
            size: form.size, monthly_rent: Number(form.monthly_rent || 0), notes: form.notes,
        };
        try {
            if (editing) {
                await api.put(`/lockers/${editing.id}`, payload);
                toast.success(`Locker ${editing.locker_number} updated.`);
            } else {
                await api.post('/lockers', payload);
                toast.success(`Locker ${payload.locker_number.toUpperCase()} added.`);
            }
            setDialogOpen(false);
            fetchLockers();
        } catch (err) {
            logError('LockersPage', 'handleSave', `✗ ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to save the locker.');
        } finally { setBusy(false); }
    };

    const openAssign = (l) => {
        setAssignLocker(l);
        setAssignForm({ member: null, months: '1', collect: Number(l?.monthly_rent || 0) > 0, method: 'Cash' });
        setError('');
        setAssignOpen(true);
    };

    const handleAssign = async () => {
        if (!assignForm.member) { setError('Pick a member to assign the locker to.'); return; }
        setBusy(true); setError('');
        log('LockersPage', 'handleAssign', `→ assign locker ${assignLocker?.locker_number} to member ${assignForm.member.id}`);
        try {
            const months = Number(assignForm.months || 1);
            const due = Number(assignLocker?.monthly_rent || 0) * months;
            const res = await api.post(`/lockers/${assignLocker.id}/assign`, {
                member_id: assignForm.member.id,
                months,
                // Taking the rent here books the payment and raises the
                // invoice, the same as assigning one on the onboarding form.
                ...(assignForm.collect && due > 0 ? { amount: due, method: assignForm.method } : {}),
            });
            setAssignOpen(false);
            toast.success(res.data.message);
            fetchLockers();
        } catch (err) {
            logError('LockersPage', 'handleAssign', `✗ ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to assign the locker.');
        } finally { setBusy(false); }
    };

    const handleRelease = async (l) => {
        setError(''); toast.success('');
        try {
            const res = await api.post(`/lockers/${l.id}/release`);
            toast.success(res.data.message);
            fetchLockers();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to release the locker.');
        }
    };

    const confirm = useConfirm();

    const handleDelete = async (l) => {
        if (!await confirm({
            title: `Delete locker ${l.locker_number}?`,
            body: <>The locker and its rental history are removed. Release it instead if you only want to free it up.</>,
            confirmLabel: 'Delete locker', danger: true,
        })) return;
        setError(''); toast.success('');
        try {
            const res = await api.delete(`/lockers/${l.id}`);
            toast.success(res.data.message);
            fetchLockers();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to delete the locker.');
        }
    };

    const toggleMaintenance = async (l) => {
        setError(''); toast.success('');
        try {
            await api.put(`/lockers/${l.id}`, { status: l.status === 'maintenance' ? 'free' : 'maintenance' });
            toast.success(`Locker ${l.locker_number} is now ${l.status === 'maintenance' ? 'available' : 'under maintenance'}.`);
            fetchLockers();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to update the locker.');
        }
    };

    // Status counts come from the unfiltered set so the tiles stay stable while
    // one of them is active as a filter. (`lockers` is what the server returned
    // for the current filter — this comment used to sit above code that read it.)
    const counts = { free: 0, occupied: 0, maintenance: 0 };
    allLockers.forEach(l => { counts[l.status] = (counts[l.status] || 0) + 1; });
    const overdue = allLockers.filter(l => l.is_overdue).length;
    const rentRoll = allLockers.filter(l => l.status === 'occupied').reduce((s, l) => s + Number(l.monthly_rent), 0);

    const columns = [
        { key: 'locker', label: 'Locker' },
        { key: 'size', label: 'Size' },
        { key: 'rent', icon: <Payments />, label: 'Rent / month', align: 'right' },
        { key: 'holder', label: 'Held by' },
        { key: 'until', label: 'Until' },
        { key: 'status', label: 'Status' },
        { key: 'actions', label: 'Actions', align: 'right' },
    ];

    return (
        <Box>
            <Alerts items={[
                error && { severity: 'error', text: error },
                loadError && { severity: 'error', text: loadError },
                overdue > 0 && { severity: 'warning', text: `${overdue} locker rental(s) past their end date.` },
            ]} />

            <StatCards columns={6} active={statusFilter} onSelect={setStatusFilter}
                allLabel="All lockers" allValue={lockers.length} items={[
                { key: 'free', icon: <LockOpen />, label: 'Free', value: counts.free, color: 'success' },
                { key: 'occupied', icon: <Lock />, label: 'Occupied', value: counts.occupied, color: 'info' },
                { key: 'maintenance', icon: <Build />, label: 'Maintenance', value: counts.maintenance, color: 'warning' },
            ]} />
            <StatCards columns={5} items={[
                { key: 'overdue', icon: <EventBusy />, label: 'Past end date', value: overdue, color: overdue ? 'error' : 'success' },
                { key: 'rent', label: 'Monthly rent roll', value: money(rentRoll), color: 'primary' },
            ]} />

            <Paper elevation={3} sx={{ p: 3 }}>
                <PageHeader
                    icon={Lock}
                    title="Lockers"
                    count={lockers.length}
                    search={search}
                    onSearch={setSearch}
                    searchPlaceholder="Search by locker number, location or member…"
                    actionLabel={isAdmin ? 'Add locker' : undefined}
                    actionIcon={<Add />}
                    onAction={openCreate}
                />

                <ModuleTable
                    loading={loading}columns={columns}
                    rows={lockers}
                    emptyText={statusFilter
                        ? <>No {STATUS_LABEL[statusFilter]?.toLowerCase()} lockers.</>
                        : <>No lockers yet — click <b>Add locker</b> to set up your bank.</>}
                    renderRow={(l) => (
                        <>
                            <TableCell>
                                <Box display="flex" alignItems="center" gap={1}>
                                    {l.status === 'occupied' ? <Lock fontSize="small" color="info" />
                                        : l.status === 'maintenance' ? <Build fontSize="small" color="warning" />
                                        : <LockOpen fontSize="small" color="success" />}
                                    <Box>
                                        <Typography variant="body2" fontWeight={700}>{l.locker_number}</Typography>
                                        {l.location && <Typography variant="caption" color="text.secondary">{l.location}</Typography>}
                                    </Box>
                                </Box>
                            </TableCell>
                            <TableCell><Chip size="small" variant="outlined" label={l.size} /></TableCell>
                            <TableCell align="right">{money(l.monthly_rent)}</TableCell>
                            <TableCell>
                                {l.member_name ? (
                                    <Box>
                                        <Typography variant="body2" fontWeight={600}>{l.member_name}</Typography>
                                        <Typography variant="caption" color="text.secondary">ID {l.member_code}</Typography>
                                    </Box>
                                ) : <Typography variant="caption" color="text.secondary">—</Typography>}
                            </TableCell>
                            <TableCell>
                                {l.assigned_until ? (
                                    <Typography variant="caption" color={l.is_overdue ? 'error.main' : 'text.secondary'}
                                        fontWeight={l.is_overdue ? 700 : 400}>
                                        {fmtDate(l.assigned_until)}{l.is_overdue ? ' · overdue' : ''}
                                    </Typography>
                                ) : <Typography variant="caption" color="text.secondary">—</Typography>}
                            </TableCell>
                            <TableCell>
                                <Chip size="small" label={STATUS_LABEL[l.status]} color={STATUS_COLOR[l.status]} />
                            </TableCell>
                            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                {isAdmin && (
                                    <>
                                        {l.status === 'free' && (
                                            <Button size="small" variant="contained" startIcon={<PersonAdd />}
                                                onClick={() => openAssign(l)}>Assign</Button>
                                        )}
                                        {l.status === 'occupied' && (
                                            <Button size="small" variant="outlined" color="warning" startIcon={<PersonRemove />}
                                                onClick={() => handleRelease(l)}>Release</Button>
                                        )}
                                        <Tooltip title={l.status === 'maintenance' ? 'Return to service' : 'Mark under maintenance'}>
                                            <span>
                                                <IconButton size="small" onClick={() => toggleMaintenance(l)}
                                                    disabled={l.status === 'occupied'}>
                                                    <Build fontSize="small" />
                                                </IconButton>
                                            </span>
                                        </Tooltip>
                                        <IconButton size="small" title="Edit" onClick={() => openEdit(l)}>
                                            <Edit fontSize="small" />
                                        </IconButton>
                                        <Tooltip title={l.member_id ? 'Release it first' : 'Delete locker'}>
                                            <span>
                                                <IconButton size="small" color="error" onClick={() => handleDelete(l)}
                                                    disabled={!!l.member_id}>
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
                title={editing ? `Edit Locker — ${editing.locker_number}` : 'Add a Locker'}
                onClose={() => setDialogOpen(false)}
                errors={formErrors} error={error}
                submitLabel={editing ? 'Save changes' : 'Add locker'}
                submitIcon={<Add />} onSubmit={handleSave} busy={busy}
            >
                <Grid item xs={12} sm={4}>
                    <TextField fullWidth required={isRequired('locker_number')} label="Locker Number"
                        value={form.locker_number} error={!!formErrors.locker_number}
                        onChange={e => setField('locker_number', e.target.value)}
                        disabled={!!editing} placeholder="e.g. A-12"
                        helperText={editing ? 'Fixed once created' : 'Stored in upper case'} />
                </Grid>
                <Grid item xs={12} sm={8}>
                    <TextField fullWidth label="Location" value={form.location}
                        onChange={e => setField('location', e.target.value)}
                        placeholder="e.g. Ground floor, men's changing room" />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField select fullWidth required={isRequired('size')} label="Size" value={form.size}
                        error={!!formErrors.size} onChange={e => setField('size', e.target.value)}>
                        {SIZES.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                    </TextField>
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField fullWidth type="number" label="Monthly Rent (₹)" value={form.monthly_rent}
                        error={!!formErrors.monthly_rent}
                        onChange={e => setField('monthly_rent', e.target.value)} inputProps={{ min: 0 }} />
                </Grid>
                <Grid item xs={12}>
                    <TextField fullWidth multiline rows={2} label="Notes" value={form.notes}
                        onChange={e => setField('notes', e.target.value)}
                        placeholder="e.g. key #12, lock replaced March" />
                </Grid>
            </FormDialog>

            <FormDialog
                open={assignOpen}
                title={`Assign Locker ${assignLocker?.locker_number || ''}`}
                onClose={() => setAssignOpen(false)}
                error={error}
                submitLabel="Assign locker" submitIcon={<PersonAdd />}
                onSubmit={handleAssign} busy={busy} maxWidth="xs"
            >
                <Grid item xs={12}>
                    <Autocomplete
                        options={members}
                        value={assignForm.member}
                        onChange={(e, v) => setAssignForm({ ...assignForm, member: v })}
                        getOptionLabel={(m) => `${m.name} (ID ${m.member_code})`}
                        isOptionEqualToValue={(o, v) => o.id === v.id}
                        renderInput={(params) => <TextField {...params} required label="Member" placeholder="Search by name or ID…" />}
                    />
                </Grid>
                <Grid item xs={12}>
                    <TextField select fullWidth label="Rental period" value={assignForm.months}
                        onChange={e => setAssignForm({ ...assignForm, months: e.target.value })}>
                        {[1, 2, 3, 6, 12].map(m => (
                            <MenuItem key={m} value={String(m)}>{m} month{m > 1 ? 's' : ''}</MenuItem>
                        ))}
                    </TextField>
                </Grid>
                <Grid item xs={12}>
                    <FormControlLabel
                        control={
                            <Switch checked={!!assignForm.collect}
                                onChange={e => setAssignForm({ ...assignForm, collect: e.target.checked })} />
                        }
                        label="Collect the rent now"
                    />
                </Grid>
                {assignForm.collect && (
                    <Grid item xs={12}>
                        <TextField select fullWidth label="Mode of payment" value={assignForm.method}
                            onChange={e => setAssignForm({ ...assignForm, method: e.target.value })}>
                            {PAYMENT_MODES.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                        </TextField>
                    </Grid>
                )}
                <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary">
                        Rent: <b>{money(Number(assignLocker?.monthly_rent || 0) * Number(assignForm.months || 1))}</b>
                        {' '}for {assignForm.months} month{Number(assignForm.months) > 1 ? 's' : ''}.
                        {assignForm.collect
                            ? ' It goes into the member\u2019s payments and raises an invoice.'
                            : ' Nothing is charged — use this when the locker comes with the membership.'}
                        {' '}A member can hold one locker at a time.
                    </Typography>
                </Grid>
            </FormDialog>
        </Box>
    );
};

export default LockersPage;
