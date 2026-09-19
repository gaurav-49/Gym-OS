// frontend/src/components/LeadsPage.jsx
// Lead management (CRM): capture walk-in inquiries at the front desk, move them
// through the pipeline (new → contacted → visited → converted / lost) and
// convert a lead into a full member in one click — a numeric member ID is
// generated automatically and the member appears on the Members page.
import React, { useEffect, useState } from 'react';
import {
    Box, Paper, Typography, Button, Stack, Chip, TextField, MenuItem, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Dialog, DialogTitle, DialogContent, DialogActions, GridLegacy as Grid, Card, CardContent, InputAdornment, Avatar, IconButton, Tooltip, Divider, } from '@mui/material';
import Alerts from './Alerts';
import {
    PersonAdd, Campaign, Search, Delete, Edit, CheckCircle, Groups, FiberNew, PhoneInTalk, DirectionsWalk, HowToReg, DoNotDisturbOn,
} from '@mui/icons-material';
import api from '../api';
import { log, logError } from '../logger';
import { PAYMENT_MODES } from '../constants';
import { usePlans, useConfirm, StatCards, fmtDate, useToast, titleCaseOnBlur } from './ui';

const STATUSES = ['new', 'contacted', 'visited', 'converted', 'lost'];

/** A status from outside the catalogue still reads like a label, not a value. */
const titleCase = (v) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1) : '—');
const SOURCES = ['walk-in', 'website', 'phone', 'social', 'referral'];

const STATUS_COLOR = {
    new: 'info', contacted: 'primary', visited: 'warning', converted: 'success', lost: 'error',
};
const STATUS_ICON = {
    new: <FiberNew />, contacted: <PhoneInTalk />, visited: <DirectionsWalk />,
    converted: <HowToReg />, lost: <DoNotDisturbOn />,
};
const STATUS_LABEL = {
    new: 'New', contacted: 'Contacted', visited: 'Visited', converted: 'Converted', lost: 'Lost',
};

const emptyForm = { name: '', phone: '', email: '', interest: 'Monthly', source: 'walk-in', notes: '' };

const LeadsPage = ({ onOnboard }) => {
    const toast = useToast();
    const [leads, setLeads] = useState([]);
    // Distinguishes "still loading" from "genuinely empty" — without it the
    // table showed its empty state on every page load.
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('');
    const [search, setSearch] = useState('');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(emptyForm);
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState('');
    const [busy, setBusy] = useState(false);
    const { planNames } = usePlans();

    const fetchLeads = async () => {
        try {
            const res = await api.get('/leads', { params: { status: statusFilter || undefined, search: search || undefined } });
            setLeads(res.data);
            setLoadError('');
        } catch (err) {
            setLoadError(err.response?.data?.error || 'Failed to load leads.');
        } finally { setLoading(false); }
    };
    useEffect(() => { fetchLeads(); }, [statusFilter, search]);

    const openCreate = () => {
        setEditing(null);
        setForm(emptyForm);
        setError('');
        setDialogOpen(true);
    };
    const openEdit = (lead) => {
        setEditing(lead);
        setForm({
            name: lead.name, phone: lead.phone || '', email: lead.email || '',
            interest: lead.interest || 'Monthly', source: lead.source || 'walk-in', notes: lead.notes || '',
        });
        setError('');
        setDialogOpen(true);
    };

    const handleSave = async () => {
        if (!form.name.trim()) {
            log('LeadsPage', 'handleSave', '→ validation: name empty');
            setError('Lead name is required.');
            return;
        }
        setBusy(true);
        setError('');
        log('LeadsPage', 'handleSave', `→ ${editing ? 'update' : 'create'} lead name="${form.name}" phone=${form.phone}`);
        try {
            if (editing) {
                await api.put(`/leads/${editing.id}`, form);
                toast.success(`Lead "${form.name}" updated.`);
            } else {
                await api.post('/leads', form);
                toast.success(`Lead "${form.name}" captured.`);
            }
            setDialogOpen(false);
            fetchLeads();
        } catch (err) {
            logError('LeadsPage', 'handleSave', `✗ failed for "${form?.name}": ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to save the lead.');
        } finally {
            setBusy(false);
        }
    };

    const setStatus = async (lead, status) => {
        log('LeadsPage', 'setStatus', `→ lead id=${lead.id} "${lead.name}" → ${status}`);
        try {
            await api.put(`/leads/${lead.id}`, { status });
            toast.success(`"${lead.name}" marked ${STATUS_LABEL[status].toLowerCase()}.`);
            setError('');
            fetchLeads();
        } catch (err) {
            logError('LeadsPage', 'setStatus', `✗ failed for lead ${lead?.id}: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to update the lead.');
        }
    };

    const confirm = useConfirm();

    const handleDelete = async (lead) => {
        if (!await confirm({
            title: `Delete ${lead.name}?`,
            body: <>The enquiry and its follow-up notes are removed from the pipeline.</>,
            confirmLabel: 'Delete lead', danger: true,
        })) return;
        log('LeadsPage', 'handleDelete', `→ delete lead id=${lead.id} name="${lead.name}"`);
        try {
            await api.delete(`/leads/${lead.id}`);
            toast.success(`Lead "${lead.name}" deleted.`);
            setError('');
            fetchLeads();
        } catch (err) {
            logError('LeadsPage', 'handleDelete', `✗ failed for lead ${lead?.id}: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to delete the lead.');
        }
    };

    /**
     * Convert hands the lead to the member onboarding form rather than creating
     * anybody. It used to create the member here and now, from whatever the
     * enquiry happened to carry — so a member arrived with no address, no date
     * of birth and no fee recorded, none of which the onboarding form would
     * have accepted. The lead's details are the starting point, not the whole
     * record.
     */
    const openConvert = (lead) => {
        log('LeadsPage', 'openConvert', `→ onboard lead id=${lead.id} "${lead.name}"`);
        if (onOnboard) onOnboard(lead);
    };

    const counts = {};
    STATUSES.forEach(s => { counts[s] = leads.filter(l => l.status === s).length; });

    return (
        <Box>
            <Alerts items={[
                error && { severity: 'error', text: error },
                loadError && { severity: 'error', text: loadError },
            ]} />

            {/* Pipeline — the tiles are the filter. */}
            <StatCards
                columns={6}
                active={statusFilter}
                onSelect={setStatusFilter}
                allLabel="All leads"
                allValue={leads.length}
                items={STATUSES.map(st => ({
                    key: st,
                    label: STATUS_LABEL[st],
                    value: counts[st],
                    color: STATUS_COLOR[st],
                    icon: STATUS_ICON[st],
                }))}
            />

            <Paper elevation={3} sx={{ p: 3 }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1} mb={2}>
                    <Box display="flex" alignItems="center" gap={1}>
                        <Campaign sx={{ color: 'primary.main' }} />
                        <Typography variant="h6">Leads</Typography>
                        <Chip size="small" label={`${leads.length} shown`} variant="outlined" />
                    </Box>
                    <Button variant="contained" startIcon={<PersonAdd />} onClick={openCreate}>
                        Capture lead
                    </Button>
                </Box>

                {/* Search */}
                <TextField fullWidth size="small" placeholder="Search by name, phone or email…" value={search}
                    onChange={e => setSearch(e.target.value)}
                    sx={{ mb: 2, maxWidth: 420 }}
                    InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }} />

                <TableContainer>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Lead</TableCell>
                                <TableCell>Interest</TableCell>
                                <TableCell>Source</TableCell>
                                <TableCell>Status</TableCell>
                                <TableCell>Captured</TableCell>
                                <TableCell align="right">Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {leads.map(l => {
                                const isConverted = l.status === 'converted';
                                return (
                                    <TableRow key={l.id} sx={{ bgcolor: l.status === 'lost' ? 'rgba(220,38,38,0.04)' : isConverted ? 'rgba(5,150,105,0.05)' : 'transparent' }}>
                                        <TableCell>
                                            <Box display="flex" alignItems="center" gap={1.5}>
                                                <Avatar sx={{ bgcolor: 'success.softBg', color: 'success.dark', width: 32, height: 32, fontSize: 13, fontWeight: 700 }}>
                                                    {l.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                                                </Avatar>
                                                <Box>
                                                    <Typography variant="body2" fontWeight={600}>{l.name}</Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        {l.phone ? `📞 ${l.phone}  ` : ''}{l.email ? `✉ ${l.email}` : ''}
                                                    </Typography>
                                                    {l.notes && (
                                                        <Tooltip title={l.notes}><Typography variant="caption" color="text.secondary" display="block" sx={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {l.notes}
                                                        </Typography></Tooltip>
                                                    )}
                                                </Box>
                                            </Box>
                                        </TableCell>
                                        <TableCell><Chip size="small" label={l.interest || '—'} variant="outlined" /></TableCell>
                                        <TableCell>
                                            <Typography variant="body2" color="text.secondary"
                                                textTransform="capitalize">{l.source || 'walk-in'}</Typography>
                                        </TableCell>
                                        <TableCell>
                                            <Chip size="small" label={STATUS_LABEL[l.status] || titleCase(l.status)}
                                                color={STATUS_COLOR[l.status] || 'default'}
                                                onClick={() => !isConverted && setStatus(l, STATUSES[(STATUSES.indexOf(l.status) + 1) % STATUSES.length])}
                                                sx={{ cursor: isConverted ? 'default' : 'pointer' }}
                                                title={isConverted ? 'Converted' : 'Click to advance status'} />
                                        </TableCell>
                                        <TableCell>
                                            <Typography variant="caption" color="text.secondary">
                                                {fmtDate(l.created_at)} · {l.captured_by || '—'}
                                            </Typography>
                                        </TableCell>
                                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                            {/* Both states share one right-aligned row. A converted lead's
                                                chip used to sit flush to the cell edge while the button and
                                                icons below it stopped short of it, so the column's right
                                                edge stepped in and out down the page. */}
                                            <Stack direction="row" spacing={0.5} justifyContent="flex-end"
                                                alignItems="center" sx={{ minHeight: 30 }}>
                                                {isConverted ? (
                                                    <Chip size="small" color="success" icon={<CheckCircle fontSize="small" />}
                                                        label={l.converted_member_name ? `Member: ${l.converted_member_name}` : 'Converted'} />
                                                ) : (
                                                    <>
                                                        <Button size="small" variant="contained" color="success" startIcon={<Groups />}
                                                            onClick={() => openConvert(l)}>
                                                            Convert
                                                        </Button>
                                                        <IconButton size="small" title="Edit" onClick={() => openEdit(l)}><Edit fontSize="small" /></IconButton>
                                                        <IconButton size="small" color="error" title="Delete" onClick={() => handleDelete(l)}><Delete fontSize="small" /></IconButton>
                                                    </>
                                                )}
                                            </Stack>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                            {leads.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                                        No leads yet — click <b>Capture lead</b> to record a walk-in inquiry.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Paper>

            {/* Add / edit lead dialog */}
            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>{editing ? `Edit Lead — ${editing.name}` : 'Capture a Lead'}</DialogTitle>
                <DialogContent>
                    <Alerts items={[error && { severity: 'error', text: error }]} />
                    <Grid container spacing={2} sx={{ mt: 0.5 }}>
                        <Grid item xs={12}>
                            <TextField fullWidth required label="Name" name="name" value={form.name}
                                onChange={e => setForm({ ...form, name: e.target.value })}
                                onBlur={titleCaseOnBlur(setForm)} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="Phone" value={form.phone}
                                onChange={e => setForm({ ...form, phone: e.target.value })} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="Email" value={form.email}
                                onChange={e => setForm({ ...form, email: e.target.value })} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField select fullWidth label="Interested plan" value={form.interest}
                                onChange={e => setForm({ ...form, interest: e.target.value })}>
                                {planNames.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                            </TextField>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField select fullWidth label="Source" value={form.source}
                                onChange={e => setForm({ ...form, source: e.target.value })}>
                                {SOURCES.map(s => <MenuItem key={s} value={s} sx={{ textTransform: 'capitalize' }}>{s}</MenuItem>)}
                            </TextField>
                        </Grid>
                        <Grid item xs={12}>
                            <TextField fullWidth multiline rows={2} label="Notes" value={form.notes}
                                onChange={e => setForm({ ...form, notes: e.target.value })}
                                placeholder="e.g. walked in with a friend, wants to start next week" />
                        </Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button variant="contained" startIcon={<PersonAdd />} onClick={handleSave} disabled={busy}>
                        {editing ? 'Save changes' : 'Capture lead'}
                    </Button>
                </DialogActions>
            </Dialog>

        </Box>
    );
};

export default LeadsPage;
