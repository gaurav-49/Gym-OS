// frontend/src/components/BranchesPage.jsx
// Multi-branch support. Everything that existed before the migration belongs to
// the seeded "Main Branch", so a single-location gym never has to touch this
// page — it only matters once a second location opens.

import React, { useEffect, useState } from 'react';
import {
    Box, Paper, TextField, Chip, IconButton, Tooltip, Switch, FormControlLabel, GridLegacy as Grid, TableCell, Typography, } from '@mui/material';
import { Add, Edit, Delete, Store, Groups, Badge, Fingerprint,
} from '@mui/icons-material';
import api from '../api';
import { log, logError } from '../logger';
import Alerts from './Alerts';
import { PageHeader, StatCards, ModuleTable, FormDialog, useExceptions, useConfirm, useToast, titleCase } from './ui';

const FALLBACK_RULES = [
    { code: 'E1801', field_name: 'name', field_label: 'Branch Name', message: 'BRANCH NAME IS MANDATORY', is_mandatory: true },
    { code: 'E1802', field_name: 'code', field_label: 'Branch Code', message: 'BRANCH CODE IS MANDATORY', format_message: 'LETTERS AND NUMBERS ONLY ALLOWED', is_mandatory: true, allowed_chars: 'alphanumeric' },
];

const emptyForm = { name: '', code: '', address: '', phone: '', email: '', gst_number: '', is_active: true };

const BranchesPage = ({ isAdmin }) => {
    const toast = useToast();
    const [branches, setBranches] = useState([]);
    // Distinguishes "still loading" from "genuinely empty" — without it the
    // table showed its empty state on every page load.
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(emptyForm);
    const [formErrors, setFormErrors] = useState({});
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState('');
    const [busy, setBusy] = useState(false);

    const { validate, liveCheck, isRequired } = useExceptions('branches', FALLBACK_RULES);

    const fetchBranches = async () => {
        try {
            const res = await api.get('/branches');
            setBranches(res.data);
            setLoadError('');
        } catch (err) {
            logError('BranchesPage', 'fetchBranches', `✗ ${err.response?.data?.error || err.message}`, err);
            setLoadError(err.response?.data?.error || 'Failed to load branches.');
        } finally { setLoading(false); }
    };
    useEffect(() => { fetchBranches(); }, []);

    const openCreate = () => { setEditing(null); setForm(emptyForm); setFormErrors({}); setError(''); setDialogOpen(true); };
    const openEdit = (b) => {
        setEditing(b);
        setForm({
            name: b.name, code: b.code, address: b.address || '', phone: b.phone || '',
            email: b.email || '', gst_number: b.gst_number || '', is_active: b.is_active,
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
            log('BranchesPage', 'handleSave', `→ validation blocked: ${Object.keys(errors).join(', ')}`);
            return;
        }
        setBusy(true); setError('');
        log('BranchesPage', 'handleSave', `→ ${editing ? 'update' : 'create'} branch "${form.name}"`);
        try {
            if (editing) {
                await api.put(`/branches/${editing.id}`, form);
                toast.success(`Branch "${form.name}" updated.`);
            } else {
                await api.post('/branches', form);
                toast.success(`Branch "${form.name}" added.`);
            }
            setDialogOpen(false);
            fetchBranches();
        } catch (err) {
            logError('BranchesPage', 'handleSave', `✗ ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to save the branch.');
        } finally { setBusy(false); }
    };

    const confirm = useConfirm();

    const handleDelete = async (b) => {
        if (!await confirm({
            title: `Delete ${b.name}?`,
            body: <>This is only possible while no members, staff or equipment are attached to the branch.</>,
            confirmLabel: 'Delete branch', danger: true,
        })) return;
        setError(''); toast.success('');
        try {
            const res = await api.delete(`/branches/${b.id}`);
            toast.success(res.data.message);
            fetchBranches();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to delete the branch.');
        }
    };

    const totalMembers = branches.reduce((s, b) => s + b.member_count, 0);
    const totalStaff = branches.reduce((s, b) => s + b.staff_count, 0);
    const totalDevices = branches.reduce((s, b) => s + b.device_count, 0);

    return (
        <Box>
            <Alerts items={[
                error && { severity: 'error', text: error },
                loadError && { severity: 'error', text: loadError },
            ]} />

            <StatCards columns={4} items={[
                { key: 'branches', icon: <Store />, label: 'Branches', value: branches.filter(b => b.is_active).length, color: 'primary',
                  hint: `${branches.length} total` },
                { key: 'members', icon: <Groups />, label: 'Members', value: totalMembers, color: 'info' },
                { key: 'staff', icon: <Badge />, label: 'Staff', value: totalStaff, color: 'secondary' },
                { key: 'devices', icon: <Fingerprint />, label: 'Devices', value: totalDevices, color: 'success' },
            ]} />

            <Paper elevation={3} sx={{ p: 3 }}>
                <PageHeader
                    icon={Store}
                    title="Branches"
                    count={branches.length}
                    actionLabel={isAdmin ? 'Add branch' : undefined}
                    actionIcon={<Add />}
                    onAction={openCreate}
                />
                <Typography variant="body2" color="text.secondary" mb={2}>
                    Members, staff, devices, expenses, products, lockers and invoices each belong to
                    a branch. Everything that predates this module sits on <b>Main Branch</b>.
                </Typography>

                <ModuleTable
                    loading={loading}columns={[
                        { key: 'name', label: 'Branch' },
                        { key: 'contact', label: 'Contact' },
                        { key: 'gst', label: 'GSTIN' },
                        { key: 'members', label: 'Members', align: 'right' },
                        { key: 'staff', label: 'Staff', align: 'right' },
                        { key: 'devices', label: 'Devices', align: 'right' },
                        { key: 'status', label: 'Status' },
                        { key: 'actions', label: '', align: 'right' },
                    ]}
                    rows={branches}
                    empty={{
                        icon: Store,
                        title: 'No branches yet',
                        hint: 'Add a branch to keep members, staff and takings reported per location.',
                        actionLabel: 'Add branch',
                        actionIcon: <Add />,
                        onAction: openCreate,
                    }}
                    renderRow={(b) => (
                        <>
                            <TableCell>
                                <Box display="flex" alignItems="center" gap={1}>
                                    <Store fontSize="small" color={b.is_active ? 'primary' : 'disabled'} />
                                    <Box>
                                        <Typography variant="body2" fontWeight={600}>{b.name}</Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {b.code}{b.address ? ` · ${b.address}` : ''}
                                        </Typography>
                                    </Box>
                                </Box>
                            </TableCell>
                            <TableCell>
                                <Typography variant="caption" color="text.secondary" display="block">{b.phone || '—'}</Typography>
                                <Typography variant="caption" color="text.secondary">{b.email || ''}</Typography>
                            </TableCell>
                            <TableCell>
                                <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{b.gst_number || '—'}</Typography>
                            </TableCell>
                            <TableCell align="right">
                                <Chip size="small" variant="outlined" icon={<Groups fontSize="small" />}
                                    label={b.member_count} title={`${b.active_members} active`} />
                            </TableCell>
                            <TableCell align="right">
                                <Chip size="small" variant="outlined" icon={<Badge fontSize="small" />} label={b.staff_count} />
                            </TableCell>
                            <TableCell align="right">
                                <Chip size="small" variant="outlined" icon={<Fingerprint fontSize="small" />} label={b.device_count} />
                            </TableCell>
                            <TableCell>
                                <Chip size="small" label={b.is_active ? 'Active' : 'Closed'}
                                    color={b.is_active ? 'success' : 'default'} />
                            </TableCell>
                            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                {isAdmin && (
                                    <>
                                        <IconButton size="small" title="Edit" onClick={() => openEdit(b)}>
                                            <Edit fontSize="small" />
                                        </IconButton>
                                        <Tooltip title={b.code === 'MAIN'
                                            ? 'The main branch is permanent'
                                            : (b.member_count + b.staff_count + b.device_count > 0
                                                ? 'Move its records first'
                                                : 'Delete branch')}>
                                            <span>
                                                <IconButton size="small" color="error" onClick={() => handleDelete(b)}
                                                    disabled={b.code === 'MAIN' || b.member_count + b.staff_count + b.device_count > 0}>
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
                title={editing ? `Edit Branch — ${editing.name}` : 'Add a Branch'}
                onClose={() => setDialogOpen(false)}
                errors={formErrors} error={error}
                submitLabel={editing ? 'Save changes' : 'Add branch'}
                submitIcon={<Add />} onSubmit={handleSave} busy={busy}
            >
                <Grid item xs={12} sm={8}>
                    <TextField fullWidth required={isRequired('name')} label="Branch Name" value={form.name}
                        error={!!formErrors.name} onChange={e => setField('name', e.target.value)}
                        placeholder="e.g. North Branch" 
                        onBlur={e => setField('name', titleCase(e.target.value))} />
                </Grid>
                <Grid item xs={12} sm={4}>
                    <TextField fullWidth required={isRequired('code')} label="Branch Code" value={form.code}
                        error={!!formErrors.code} onChange={e => setField('code', e.target.value)}
                        disabled={!!editing} placeholder="e.g. NORTH"
                        helperText={editing ? 'Fixed once created' : 'Letters and digits only'} />
                </Grid>
                <Grid item xs={12}>
                    <TextField fullWidth label="Address" value={form.address}
                        onChange={e => setField('address', e.target.value)}
                        onBlur={e => setField('address', titleCase(e.target.value))} />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField fullWidth label="Phone" value={form.phone}
                        onChange={e => setField('phone', e.target.value)} />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField fullWidth label="Email" value={form.email}
                        onChange={e => setField('email', e.target.value)} />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField fullWidth label="GSTIN" value={form.gst_number}
                        onChange={e => setField('gst_number', e.target.value)}
                        helperText="Printed on this branch's tax invoices" />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <FormControlLabel sx={{ mt: 1 }}
                        control={<Switch checked={form.is_active}
                            onChange={e => setField('is_active', e.target.checked)} />}
                        label="Branch is open" />
                </Grid>
            </FormDialog>
        </Box>
    );
};

export default BranchesPage;
