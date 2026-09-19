// frontend/src/components/PtPage.jsx
// Personal training: the plans a gym sells, who is on one, and the trainer
// commission each sale books. A plan is a term — a month, a quarter, six
// months, a year — exactly like a membership, never a block of sessions.
// Selling records the payment in the same ledger membership fees use.

import React, { useEffect, useState } from 'react';
import {
    Box, Paper, TextField, MenuItem, Chip, IconButton, Button, Tooltip, Tabs, Tab, GridLegacy as Grid, TableCell, Typography, Autocomplete, Divider, LinearProgress, } from '@mui/material';
import {
    Add, Edit, Delete, FitnessCenter, Sell, PlaylistAddCheck, Paid, CheckCircle, EventAvailable, Payments, Redeem, Verified,
} from '@mui/icons-material';
import api from '../api';
import { log, logError } from '../logger';
import Alerts from './Alerts';
import { PAYMENT_MODES } from '../constants';
import { PageHeader, StatCards, ModuleTable, FormDialog, useExceptions, money, moneyShort, fmtDate, useConfirm, useToast } from './ui';

const SUB_COLOR = { active: 'success', completed: 'info', expired: 'warning', cancelled: 'default' };

const FALLBACK_RULES = [
    { code: 'E1701', field_name: 'name', field_label: 'Package Name', message: 'PACKAGE NAME IS MANDATORY', is_mandatory: true },
    { code: 'E1702', field_name: 'plan_type', field_label: 'Plan', message: 'PLAN LENGTH IS MANDATORY', is_mandatory: true },
    { code: 'E1703', field_name: 'price', field_label: 'Price', message: 'PRICE IS MANDATORY', format_message: 'NUMBER ONLY ALLOWED', is_mandatory: true, allowed_chars: 'numeric' },
];

// Personal training is sold by duration, like membership: a member buys three
// months of a trainer's time. There is no per-session product, so nothing here
// counts visits down — sessions are logged as a record of what was delivered.
const PT_PLAN_TYPES = [
    { value: 'Monthly', label: 'Monthly (30 days)', days: 30 },
    { value: 'Quarterly', label: '3 months (90 days)', days: 90 },
    { value: 'Half-Yearly', label: '6 months (180 days)', days: 180 },
    { value: 'Yearly', label: 'Yearly (365 days)', days: 365 },
];

const emptyPackage = {
    name: '', plan_type: 'Monthly', price: '',
    validity_days: '30', trainer_commission_percent: '10',
};

const PtPage = ({ isAdmin }) => {
    const toast = useToast();
    const [tab, setTab] = useState(0);
    const [packages, setPackages] = useState([]);
    const [subscriptions, setSubscriptions] = useState([]);
    const [commissions, setCommissions] = useState([]);
    const [members, setMembers] = useState([]);
    const [trainers, setTrainers] = useState([]);

    const [pkgOpen, setPkgOpen] = useState(false);
    const [editingPkg, setEditingPkg] = useState(null);
    const [pkgForm, setPkgForm] = useState(emptyPackage);
    const [pkgErrors, setPkgErrors] = useState({});

    const [sellOpen, setSellOpen] = useState(false);
    const [sellForm, setSellForm] = useState({ member: null, package: null, trainer: '', method: 'Cash', price: '' });
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState('');
    const [busy, setBusy] = useState(false);

    const { validate, liveCheck, isRequired } = useExceptions('pt', FALLBACK_RULES);

    const fetchPackages = () => api.get('/pt/packages').then(r => setPackages(r.data))
        .catch(e => setLoadError(e.response?.data?.error || 'Failed to load packages.'));
    const fetchSubscriptions = () => api.get('/pt/subscriptions').then(r => setSubscriptions(r.data)).catch(() => {});
    const fetchCommissions = () => api.get('/pt/commissions').then(r => setCommissions(r.data)).catch(() => setCommissions([]));

    useEffect(() => {
        fetchPackages(); fetchSubscriptions();
        if (isAdmin) fetchCommissions();
        api.get('/clients').then(r => setMembers(r.data.filter(m => m.status === 'active'))).catch(() => setMembers([]));
        api.get('/users').then(r => setTrainers(r.data.filter(u => u.role === 'trainer'))).catch(() => setTrainers([]));
    }, [isAdmin]);

    // ── Packages ──
    const openPkgCreate = () => { setEditingPkg(null); setPkgForm(emptyPackage); setPkgErrors({}); setError(''); setPkgOpen(true); };
    const openPkgEdit = (p) => {
        setEditingPkg(p);
        setPkgForm({
            name: p.name, plan_type: p.plan_type || 'Monthly',
            price: String(p.price),
            validity_days: String(p.validity_days), trainer_commission_percent: String(p.trainer_commission_percent),
        });
        setPkgErrors({}); setError(''); setPkgOpen(true);
    };
    const setPkgField = (name, value) => {
        setPkgForm(f => ({ ...f, [name]: value }));
        const next = { ...pkgErrors };
        delete next[name];
        const live = liveCheck(name, value);
        if (live) next[name] = live;
        setPkgErrors(next);
    };
    const handlePkgSave = async () => {
        const errors = validate(pkgForm);
        setPkgErrors(errors);
        if (Object.keys(errors).length > 0) {
            log('PtPage', 'handlePkgSave', `→ validation blocked: ${Object.keys(errors).join(', ')}`);
            return;
        }
        setBusy(true); setError('');
        log('PtPage', 'handlePkgSave', `→ ${editingPkg ? 'update' : 'create'} PT package "${pkgForm.name}"`);
        const payload = {
            name: pkgForm.name.trim(), plan_type: pkgForm.plan_type,
            price: Number(pkgForm.price),
            validity_days: Number(pkgForm.validity_days || 90),
            trainer_commission_percent: Number(pkgForm.trainer_commission_percent || 0),
        };
        try {
            if (editingPkg) {
                await api.put(`/pt/packages/${editingPkg.id}`, payload);
                toast.success(`"${payload.name}" updated.`);
            } else {
                await api.post('/pt/packages', payload);
                toast.success(`"${payload.name}" added — it can now be sold.`);
            }
            setPkgOpen(false);
            fetchPackages();
        } catch (err) {
            logError('PtPage', 'handlePkgSave', `✗ ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to save the package.');
        } finally { setBusy(false); }
    };
    const confirm = useConfirm();

    const handlePkgDelete = async (p) => {
        if (!await confirm({
            title: `Delete the ${p.name} package?`,
            body: <>It stops being sellable. Members part-way through a term keep it until it ends.</>,
            confirmLabel: 'Delete package', danger: true,
        })) return;
        setError(''); toast.success('');
        try {
            const res = await api.delete(`/pt/packages/${p.id}`);
            toast.success(res.data.message);
            fetchPackages();
        } catch (err) { setError(err.response?.data?.error || 'Failed to delete the package.'); }
    };

    // ── Sell ──
    const openSell = (pkg = null) => {
        setSellForm({ member: null, package: pkg, trainer: '', method: 'Cash', price: pkg ? String(pkg.price) : '' });
        setError(''); setSellOpen(true);
    };
    const handleSell = async () => {
        if (!sellForm.member) { setError('Pick the member buying the package.'); return; }
        if (!sellForm.package) { setError('Pick a package to sell.'); return; }
        setBusy(true); setError('');
        log('PtPage', 'handleSell', `→ sell "${sellForm.package.name}" to member ${sellForm.member.id}`);
        try {
            const res = await api.post('/pt/subscriptions', {
                member_id: sellForm.member.id,
                package_id: sellForm.package.id,
                trainer_id: sellForm.trainer || null,
                method: sellForm.method,
                price: sellForm.price === '' ? undefined : Number(sellForm.price),
            });
            setSellOpen(false);
            toast.success(res.data.message);
            fetchSubscriptions(); fetchPackages();
            if (isAdmin) fetchCommissions();
        } catch (err) {
            logError('PtPage', 'handleSell', `✗ ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to sell the package.');
        } finally { setBusy(false); }
    };

    const logSession = async (sub) => {
        setError(''); toast.success('');
        log('PtPage', 'logSession', `→ log session for subscription ${sub.id}`);
        try {
            const res = await api.post(`/pt/subscriptions/${sub.id}/session`, {});
            toast.success(res.data.message);
            fetchSubscriptions();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to log the session.');
        }
    };

    const cancelSub = async (sub) => {
        setError(''); toast.success('');
        try {
            await api.put(`/pt/subscriptions/${sub.id}`, { status: 'cancelled' });
            toast.success(`${sub.member_name}'s package cancelled.`);
            fetchSubscriptions();
        } catch (err) { setError(err.response?.data?.error || 'Failed to cancel.'); }
    };

    const activeSubs = subscriptions.filter(s => s.status === 'active');
    // Every session ever logged against every package, live or finished. The
    // name said "this month" and the tile's hint said "live plans"; it is
    // neither — sessions_used is a running total on the package and nothing
    // here filters by date or by status. Named for what it counts.
    const sessionsAllTime = subscriptions.reduce((n, x) => n + (Number(x.sessions_used) || 0), 0);
    const ptRevenue = subscriptions.filter(s => s.status !== 'cancelled').reduce((s, x) => s + Number(x.price), 0);
    const pendingComm = commissions.filter(c => c.status === 'pending').reduce((s, c) => s + Number(c.amount), 0);

    return (
        <Box>
            <Alerts items={[
                error && { severity: 'error', text: error },
                loadError && { severity: 'error', text: loadError },
            ]} />

            <StatCards columns={5} items={[
                { key: 'packages', icon: <FitnessCenter />, label: 'Packages offered', value: packages.filter(p => p.is_active).length, color: 'primary' },
                { key: 'active', icon: <Verified />, label: 'Active subscriptions', value: activeSubs.length, color: 'success' },
                { key: 'sessions', icon: <EventAvailable />, label: 'Sessions delivered', value: sessionsAllTime, color: 'info', hint: 'all time, every package' },
                { key: 'revenue', icon: <Payments />, label: 'PT revenue', value: moneyShort(ptRevenue), color: 'secondary' },
                ...(isAdmin ? [{ key: 'comm', icon: <Redeem />, label: 'Commission owed', value: moneyShort(pendingComm), color: pendingComm ? 'warning' : 'success' }] : []),
            ]} />

            <Paper elevation={3} sx={{ p: 3 }}>
                <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ mb: 2 }} variant="scrollable" allowScrollButtonsMobile>
                    <Tab icon={<FitnessCenter fontSize="small" />} iconPosition="start" label="Packages" />
                    <Tab icon={<PlaylistAddCheck fontSize="small" />} iconPosition="start" label={`Subscriptions (${subscriptions.length})`} />
                    {isAdmin && <Tab icon={<Paid fontSize="small" />} iconPosition="start" label={`Commissions (${commissions.length})`} />}
                </Tabs>

                {tab === 0 && (
                    <>
                        <PageHeader
                            icon={FitnessCenter}
                            title="PT Packages"
                            count={packages.length}
                            actionLabel={isAdmin ? 'Add package' : undefined}
                            actionIcon={<Add />}
                            onAction={openPkgCreate}
                            extraActions={<Button variant="outlined" startIcon={<Sell />} onClick={() => openSell()}>Sell a package</Button>}
                        />
                        <ModuleTable
                            columns={[
                                { key: 'name', label: 'Package' },
                                { key: 'plan_type', label: 'Term' },
                                { key: 'price', label: 'Fee for the term', align: 'right' },
                                { key: 'per', label: 'Per month', align: 'right' },
                                { key: 'validity', label: 'Runs for', align: 'right' },
                                { key: 'commission', label: 'Trainer cut', align: 'right' },
                                { key: 'active', label: 'Sold (active)', align: 'right' },
                                { key: 'actions', label: '', align: 'right' },
                            ]}
                            rows={packages}
                            empty={{
                                icon: FitnessCenter,
                                title: 'No PT packages yet',
                                hint: 'A plan sets how long the training runs, the fee for that term and the trainer commission earned on each sale.',
                                actionLabel: isAdmin ? 'Add package' : undefined,
                                actionIcon: <Add />,
                                onAction: openPkgCreate,
                            }}
                            renderRow={(p) => (
                                <>
                                    <TableCell>
                                        <Typography variant="body2" fontWeight={600}
                                            sx={{ textDecoration: p.is_active ? 'none' : 'line-through' }}>{p.name}</Typography>
                                    </TableCell>
                                    <TableCell>{p.plan_type || '—'}</TableCell>
                                    <TableCell align="right">
                                        <Typography variant="body2" fontWeight={700}>{money(p.price)}</Typography>
                                    </TableCell>
                                    <TableCell align="right">
                                        {/* Always per month, never per session: the plan is a term now,
                                            and a monthly rate is the only figure that compares one
                                            plan to another — or to the membership next to it. */}
                                        <Typography variant="caption" color="text.secondary">
                                            {money((Number(p.price) / Math.max(1, p.validity_days)) * 30)}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="right">
                                        <Chip size="small" variant="outlined" label={`${p.validity_days} days`} />
                                    </TableCell>
                                    <TableCell align="right">{Number(p.trainer_commission_percent)}%</TableCell>
                                    <TableCell align="right">
                                        <Chip size="small" label={p.active_subscriptions}
                                            color={p.active_subscriptions > 0 ? 'info' : 'default'} variant="outlined" />
                                    </TableCell>
                                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                        <Button size="small" variant="contained" startIcon={<Sell />}
                                            onClick={() => openSell(p)} disabled={!p.is_active}>Sell</Button>
                                        {isAdmin && (
                                            <>
                                                <IconButton size="small" title="Edit" onClick={() => openPkgEdit(p)}>
                                                    <Edit fontSize="small" />
                                                </IconButton>
                                                <Tooltip title={p.active_subscriptions > 0 ? 'Has subscriptions — deactivate instead' : 'Delete'}>
                                                    <span>
                                                        <IconButton size="small" color="error" onClick={() => handlePkgDelete(p)}
                                                            disabled={p.active_subscriptions > 0}>
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
                    </>
                )}

                {tab === 1 && (
                    <>
                        <PageHeader icon={PlaylistAddCheck} title="Member Subscriptions" count={subscriptions.length}
                            actionLabel="Sell a package" actionIcon={<Sell />} onAction={() => openSell()} />
                        <ModuleTable
                            columns={[
                                { key: 'member', label: 'Member' },
                                { key: 'package', label: 'Package' },
                                { key: 'trainer', label: 'Trainer' },
                                { key: 'progress', label: 'Term remaining' },
                                { key: 'expiry', label: 'Valid until' },
                                { key: 'status', label: 'Status' },
                                { key: 'actions', label: '', align: 'right' },
                            ]}
                            rows={subscriptions}
                            empty={{
                                icon: Verified,
                                title: 'No PT subscriptions yet',
                                hint: 'Sell a plan to a member and it runs here until its term ends.',
                            }}
                            renderRow={(s) => (
                                <>
                                    <TableCell>
                                        <Typography variant="body2" fontWeight={600}>{s.member_name}</Typography>
                                        <Typography variant="caption" color="text.secondary">ID {s.member_code}</Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="body2">{s.package_name}</Typography>
                                        <Typography variant="caption" color="text.secondary">{money(s.price)}</Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="caption">{s.trainer_name || '—'}</Typography>
                                    </TableCell>
                                    <TableCell sx={{ minWidth: 160 }}>
                                        {/* What the member bought is a term, so the bar tracks the term.
                                            Sessions sit underneath as a record of what the trainer has
                                            delivered — nothing counts down towards a cap. */}
                                        <Typography variant="caption" color="text.secondary">
                                            {s.days_left > 0
                                                ? `${s.days_left} of ${s.term_days} days left`
                                                : 'Term ended'}
                                        </Typography>
                                        <LinearProgress variant="determinate"
                                            value={Math.max(0, Math.min(100,
                                                (Number(s.days_left || 0) / Math.max(1, Number(s.term_days || 1))) * 100))}
                                            color={s.days_left > 14 ? 'primary' : s.days_left > 0 ? 'warning' : 'error'}
                                            sx={{ mt: 0.5, height: 6, borderRadius: 3 }} />
                                        <Typography variant="caption" color="text.secondary">
                                            {s.sessions_used} session{s.sessions_used === 1 ? '' : 's'} logged
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="caption" color={s.is_expired ? 'error.main' : 'text.secondary'}
                                            fontWeight={s.is_expired ? 700 : 400}>
                                            {fmtDate(s.expiry_date)}{s.is_expired ? ' · expired' : ''}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Chip size="small" label={s.status} color={SUB_COLOR[s.status]}
                                            sx={{ textTransform: 'capitalize' }} />
                                    </TableCell>
                                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                        {s.status === 'active' && (
                                            <>
                                                <Button size="small" variant="contained" startIcon={<CheckCircle />}
                                                    onClick={() => logSession(s)}
                                                    disabled={s.is_expired}>
                                                    Log session
                                                </Button>
                                                <IconButton size="small" color="error" title="Cancel package"
                                                    onClick={() => cancelSub(s)}>
                                                    <Delete fontSize="small" />
                                                </IconButton>
                                            </>
                                        )}
                                    </TableCell>
                                </>
                            )}
                        />
                    </>
                )}

                {tab === 2 && isAdmin && (
                    <>
                        <PageHeader icon={Paid} title="Trainer Commissions" count={commissions.length} />
                        <Typography variant="body2" color="text.secondary" mb={2}>
                            Booked when a package is sold and settled automatically when that
                            trainer's payroll for the month is marked paid.
                        </Typography>
                        <ModuleTable
                            columns={[
                                { key: 'earned', label: 'Earned' },
                                { key: 'trainer', label: 'Trainer' },
                                { key: 'member', label: 'From member' },
                                { key: 'base', label: 'Sale value', align: 'right' },
                                { key: 'percent', label: 'Rate', align: 'right' },
                                { key: 'amount', label: 'Commission', align: 'right' },
                                { key: 'status', label: 'Status' },
                            ]}
                            rows={commissions}
                            empty={{
                                icon: Redeem,
                                title: 'No commissions booked',
                                hint: 'A commission is booked automatically each time a trainer sells a package.',
                            }}
                            renderRow={(c) => (
                                <>
                                    <TableCell><Typography variant="caption">{fmtDate(c.earned_on)}</Typography></TableCell>
                                    <TableCell><Typography variant="body2" fontWeight={600}>{c.trainer_name}</Typography></TableCell>
                                    <TableCell>
                                        <Typography variant="caption">{c.member_name || '—'}</Typography>
                                    </TableCell>
                                    <TableCell align="right">{money(c.base_amount)}</TableCell>
                                    <TableCell align="right">{Number(c.percent)}%</TableCell>
                                    <TableCell align="right">
                                        <Typography variant="body2" fontWeight={700}>{money(c.amount)}</Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Chip size="small" label={c.status} color={c.status === 'paid' ? 'success' : 'warning'}
                                            sx={{ textTransform: 'capitalize' }} />
                                        {c.paid_on && (
                                            <Typography variant="caption" color="text.secondary" display="block">
                                                {fmtDate(c.paid_on)}
                                            </Typography>
                                        )}
                                    </TableCell>
                                </>
                            )}
                        />
                    </>
                )}
            </Paper>

            {/* Package dialog */}
            <FormDialog open={pkgOpen} title={editingPkg ? `Edit Package — ${editingPkg.name}` : 'Add a PT Package'}
                onClose={() => setPkgOpen(false)} errors={pkgErrors} error={error}
                submitLabel={editingPkg ? 'Save changes' : 'Add package'} submitIcon={<Add />}
                onSubmit={handlePkgSave} busy={busy}>
                <Grid item xs={12} sm={8}>
                    <TextField fullWidth required={isRequired('name')} label="Package Name" value={pkgForm.name}
                        error={!!pkgErrors.name} onChange={e => setPkgField('name', e.target.value)}
                        placeholder="e.g. Strength Coaching" />
                </Grid>
                <Grid item xs={12} sm={4}>
                    <TextField select fullWidth required label="Plan length" value={pkgForm.plan_type}
                        error={!!pkgErrors.plan_type}
                        onChange={e => {
                            const chosen = PT_PLAN_TYPES.find(t => t.value === e.target.value);
                            setPkgForm(f => ({
                                ...f, plan_type: e.target.value,
                                // The term drives the validity, the same way a
                                // membership plan drives a membership expiry.
                                validity_days: String(chosen ? chosen.days : f.validity_days),
                            }));
                        }}>
                        {PT_PLAN_TYPES.map(t => (
                            <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
                        ))}
                    </TextField>
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField fullWidth required={isRequired('price')} type="number" label="Fee for the term (₹)"
                        value={pkgForm.price} error={!!pkgErrors.price}
                        onChange={e => setPkgField('price', e.target.value)} inputProps={{ min: 0 }}
                        helperText={pkgForm.price && pkgForm.validity_days
                            ? `${money((Number(pkgForm.price) / Number(pkgForm.validity_days)) * 30)} per month`
                            : ' '} />
                </Grid>
                <Grid item xs={12} sm={6}>
                </Grid>
                <Grid item xs={12}>
                    <TextField fullWidth type="number" label="Trainer Commission (%)"
                        value={pkgForm.trainer_commission_percent}
                        onChange={e => setPkgField('trainer_commission_percent', e.target.value)}
                        inputProps={{ min: 0, max: 100 }}
                        helperText={pkgForm.price
                            ? `Trainer earns ${money(Number(pkgForm.price) * Number(pkgForm.trainer_commission_percent || 0) / 100)} per sale`
                            : 'Booked as a pending commission on every sale'} />
                </Grid>
            </FormDialog>

            {/* Sell dialog */}
            <FormDialog open={sellOpen} title="Sell a PT Package" onClose={() => setSellOpen(false)}
                error={error} submitLabel="Sell package" submitIcon={<Sell />} onSubmit={handleSell} busy={busy}>
                <Grid item xs={12}>
                    <Autocomplete
                        options={members}
                        value={sellForm.member}
                        onChange={(e, v) => setSellForm({ ...sellForm, member: v })}
                        getOptionLabel={(m) => `${m.name} (ID ${m.member_code})`}
                        isOptionEqualToValue={(o, v) => o.id === v.id}
                        renderInput={(params) => <TextField {...params} required label="Member" placeholder="Search by name or ID…" />}
                    />
                </Grid>
                <Grid item xs={12} sm={7}>
                    <Autocomplete
                        options={packages.filter(p => p.is_active)}
                        value={sellForm.package}
                        onChange={(e, v) => setSellForm({ ...sellForm, package: v, price: v ? String(v.price) : '' })}
                        getOptionLabel={(p) => `${p.name} — ${p.plan_type || 'plan'}, ${money(p.price)}`
                            + ` (${money((Number(p.price) / Math.max(1, p.validity_days)) * 30)}/month)`}
                        isOptionEqualToValue={(o, v) => o.id === v.id}
                        renderInput={(params) => <TextField {...params} required label="Package" />}
                    />
                </Grid>
                <Grid item xs={12} sm={5}>
                    <TextField fullWidth type="number" label="Price (₹)" value={sellForm.price}
                        onChange={e => setSellForm({ ...sellForm, price: e.target.value })} inputProps={{ min: 0 }}
                        helperText="Override for a negotiated price" />
                </Grid>
                <Grid item xs={12} sm={7}>
                    <TextField select fullWidth label="Trainer" value={sellForm.trainer}
                        onChange={e => setSellForm({ ...sellForm, trainer: e.target.value })}
                        helperText="Who delivers the sessions and earns the commission">
                        <MenuItem value="">Not assigned</MenuItem>
                        {trainers.map(t => <MenuItem key={t.id} value={t.id}>{t.name || t.username}</MenuItem>)}
                    </TextField>
                </Grid>
                <Grid item xs={12} sm={5}>
                    <TextField select fullWidth label="Payment method" value={sellForm.method}
                        onChange={e => setSellForm({ ...sellForm, method: e.target.value })}>
                        {PAYMENT_MODES.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                    </TextField>
                </Grid>
                {sellForm.package && (
                    <Grid item xs={12}>
                        <Divider sx={{ mb: 1.5 }} />
                        <Typography variant="body2" color="text.secondary">
                            {sellForm.package.plan_type} plan, valid {sellForm.package.validity_days} days.
                            The payment is recorded in the member's ledger
                            {sellForm.trainer && Number(sellForm.package.trainer_commission_percent) > 0
                                ? ` and ${money(Number(sellForm.price || sellForm.package.price) * Number(sellForm.package.trainer_commission_percent) / 100)} commission is booked for the trainer`
                                : ''}.
                            A member can hold one active package at a time.
                        </Typography>
                    </Grid>
                )}
            </FormDialog>
        </Box>
    );
};

export default PtPage;
