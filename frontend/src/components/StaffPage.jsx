// frontend/src/components/StaffPage.jsx
// Staff operations: employee attendance, shift rosters and monthly payroll.
// Members had all three; employees had none. Payroll is generated from staff
// attendance plus pending trainer commissions, never typed in by hand.

import React, { useEffect, useState } from 'react';
import {
    Box, Paper, TextField, MenuItem, Chip, IconButton, Button, Tooltip, Tabs, Tab, GridLegacy as Grid, TableCell, Typography, Avatar, Divider, } from '@mui/material';
import {
    Add, Delete, Badge, EventAvailable, Payments, AccessTime, CheckCircle, Edit, PlayArrow, AccountBalanceWallet, HowToReg, Redeem,
} from '@mui/icons-material';
import api from '../api';
import { log, logError } from '../logger';
import Alerts from './Alerts';
import { PAYMENT_MODES } from '../constants';
import { PageHeader, StatCards, ModuleTable, FormDialog, useExceptions, money, moneyShort, fmtDate, todayStr, initialsOf, useConfirm, useToast } from './ui';

const ATTENDANCE_STATUSES = ['Present', 'Absent', 'Half-day', 'Leave', 'Holiday'];
const STATUS_COLOR = { Present: 'success', Absent: 'error', 'Half-day': 'warning', Leave: 'info', Holiday: 'secondary' };
const PAYROLL_COLOR = { draft: 'default', approved: 'info', paid: 'success' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

const FALLBACK_RULES = [
    { code: 'E1601', field_name: 'user_id', field_label: 'Staff Member', message: 'STAFF MEMBER IS MANDATORY', is_mandatory: true },
    { code: 'E1602', field_name: 'work_date', field_label: 'Date', message: 'DATE IS MANDATORY', is_mandatory: true },
    { code: 'E1603', field_name: 'status', field_label: 'Status', message: 'STATUS IS MANDATORY', is_mandatory: true },
];

const StaffPage = () => {
    const toast = useToast();
    const [tab, setTab] = useState(0);
    const [staff, setStaff] = useState([]);
    const [attendance, setAttendance] = useState([]);
    const [shifts, setShifts] = useState([]);
    const [payroll, setPayroll] = useState([]);
    const [period, setPeriod] = useState({ month: new Date().getMonth() + 1, year: new Date().getFullYear() });

    const [markOpen, setMarkOpen] = useState(false);
    const [markForm, setMarkForm] = useState({ user_id: '', work_date: todayStr(), status: 'Present', check_in: '', check_out: '', notes: '' });
    const [markErrors, setMarkErrors] = useState({});

    const [shiftOpen, setShiftOpen] = useState(false);
    const [shiftForm, setShiftForm] = useState({ user_id: '', shift_date: todayStr(), start_time: '09:00', end_time: '17:00', role_note: '' });

    const [employmentOpen, setEmploymentOpen] = useState(false);
    const [employmentStaff, setEmploymentStaff] = useState(null);
    const [employmentForm, setEmploymentForm] = useState({ monthly_salary: '', commission_percent: '', joined_on: '' });

    const [payOpen, setPayOpen] = useState(false);
    const [payRow, setPayRow] = useState(null);
    const [payForm, setPayForm] = useState({ deductions: '0', method: 'Bank Transfer', notes: '' });
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState('');
    const [busy, setBusy] = useState(false);

    const { validate, isRequired } = useExceptions('staff', FALLBACK_RULES);

    const fetchStaff = () => api.get('/staff').then(r => setStaff(r.data)).catch(e => setLoadError(e.response?.data?.error || 'Failed to load staff.'));
    const fetchAttendance = () => api.get('/staff/attendance').then(r => setAttendance(r.data)).catch(() => {});
    const fetchShifts = () => api.get('/staff/shifts').then(r => setShifts(r.data)).catch(() => {});
    const fetchPayroll = () => api.get('/staff/payroll', { params: period }).then(r => setPayroll(r.data)).catch(() => {});

    useEffect(() => { fetchStaff(); fetchAttendance(); fetchShifts(); }, []);
    useEffect(() => { fetchPayroll(); }, [period.month, period.year]);

    // ── Attendance ──
    const openMark = () => {
        setMarkForm({ user_id: '', work_date: todayStr(), status: 'Present', check_in: '', check_out: '', notes: '' });
        setMarkErrors({}); setError(''); setMarkOpen(true);
    };
    const handleMark = async () => {
        const errors = validate(markForm);
        setMarkErrors(errors);
        if (Object.keys(errors).length > 0) {
            log('StaffPage', 'handleMark', `→ validation blocked: ${Object.keys(errors).join(', ')}`);
            return;
        }
        setBusy(true); setError('');
        log('StaffPage', 'handleMark', `→ mark staff ${markForm.user_id} ${markForm.status} on ${markForm.work_date}`);
        try {
            const res = await api.post('/staff/attendance', markForm);
            setMarkOpen(false);
            toast.success(res.data.message);
            fetchAttendance(); fetchStaff();
        } catch (err) {
            logError('StaffPage', 'handleMark', `✗ ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to mark attendance.');
        } finally { setBusy(false); }
    };
    const confirm = useConfirm();

    const deleteAttendance = async (row) => {
        if (!await confirm({
            title: 'Remove this attendance record?',
            body: <>Hours worked will be recalculated, which can change the payroll figure for the month.</>,
            confirmLabel: 'Remove record', danger: true,
        })) return;
        try {
            await api.delete(`/staff/attendance/${row.id}`);
            toast.success('Attendance record removed.');
            fetchAttendance(); fetchStaff();
        } catch (err) { setError(err.response?.data?.error || 'Failed to remove the record.'); }
    };

    // ── Shifts ──
    const openShift = () => {
        setShiftForm({ user_id: '', shift_date: todayStr(), start_time: '09:00', end_time: '17:00', role_note: '' });
        setError(''); setShiftOpen(true);
    };
    const handleShift = async () => {
        if (!shiftForm.user_id) { setError('Pick a staff member.'); return; }
        setBusy(true); setError('');
        log('StaffPage', 'handleShift', `→ roster staff ${shiftForm.user_id} on ${shiftForm.shift_date}`);
        try {
            await api.post('/staff/shifts', shiftForm);
            setShiftOpen(false);
            toast.success('Shift added to the roster.');
            fetchShifts();
        } catch (err) {
            logError('StaffPage', 'handleShift', `✗ ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to create the shift.');
        } finally { setBusy(false); }
    };
    const deleteShift = async (row) => {
        if (!await confirm({
            title: 'Remove this shift?',
            body: <>The staff member will no longer be rostered for it.</>,
            confirmLabel: 'Remove shift', danger: true,
        })) return;
        try {
            await api.delete(`/staff/shifts/${row.id}`);
            toast.success('Shift removed.');
            fetchShifts();
        } catch (err) { setError(err.response?.data?.error || 'Failed to remove the shift.'); }
    };

    // ── Employment terms ──
    const openEmployment = (person) => {
        setEmploymentStaff(person);
        setEmploymentForm({
            monthly_salary: String(person.monthly_salary || 0),
            commission_percent: String(person.commission_percent || 0),
            joined_on: person.joined_on ? String(person.joined_on).slice(0, 10) : '',
        });
        setError(''); setEmploymentOpen(true);
    };
    const handleEmployment = async () => {
        setBusy(true); setError('');
        try {
            await api.put(`/staff/${employmentStaff.id}/employment`, {
                monthly_salary: Number(employmentForm.monthly_salary || 0),
                commission_percent: Number(employmentForm.commission_percent || 0),
                joined_on: employmentForm.joined_on || undefined,
            });
            setEmploymentOpen(false);
            toast.success(`Employment terms updated for ${employmentStaff.name}.`);
            fetchStaff();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to update employment terms.');
        } finally { setBusy(false); }
    };

    // ── Payroll ──
    const handleGenerate = async () => {
        setBusy(true); setError('');
        log('StaffPage', 'handleGenerate', `→ generate payroll ${period.month}/${period.year}`);
        try {
            const res = await api.post('/staff/payroll/generate', period);
            toast.success(res.data.message);
            fetchPayroll();
        } catch (err) {
            logError('StaffPage', 'handleGenerate', `✗ ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to generate payroll.');
        } finally { setBusy(false); }
    };
    const openPay = (row) => {
        setPayRow(row);
        setPayForm({ deductions: String(row.deductions), method: row.method || 'Bank Transfer', notes: row.notes || '' });
        setError(''); setPayOpen(true);
    };
    const handlePay = async () => {
        setBusy(true); setError('');
        try {
            await api.put(`/staff/payroll/${payRow.id}`, {
                deductions: Number(payForm.deductions || 0),
                status: 'paid',
                method: payForm.method,
                notes: payForm.notes,
            });
            setPayOpen(false);
            toast.success(`${payRow.staff_name}'s salary marked paid.`);
            fetchPayroll(); fetchStaff();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to record the payment.');
        } finally { setBusy(false); }
    };

    const presentToday = staff.filter(s => s.today_status === 'Present').length;
    const salaryBill = staff.reduce((s, p) => s + Number(p.monthly_salary), 0);
    const pendingCommission = staff.reduce((s, p) => s + Number(p.pending_commission), 0);
    const payrollDue = payroll.filter(p => p.status !== 'paid').reduce((s, p) => s + Number(p.net_pay), 0);

    return (
        <Box>
            <Alerts items={[
                error && { severity: 'error', text: error },
                loadError && { severity: 'error', text: loadError },
            ]} />

            <StatCards columns={5} items={[
                { key: 'staff', icon: <Badge />, label: 'Staff', value: staff.length, color: 'primary' },
                { key: 'present', icon: <HowToReg />, label: 'Present today', value: presentToday, color: 'success' },
                { key: 'salary', icon: <Payments />, label: 'Monthly salary bill', value: moneyShort(salaryBill), color: 'info' },
                { key: 'commission', icon: <Redeem />, label: 'Commission owed', value: moneyShort(pendingCommission), color: 'warning' },
                { key: 'due', icon: <AccountBalanceWallet />, label: 'Payroll unpaid', value: moneyShort(payrollDue), color: payrollDue ? 'error' : 'success',
                  hint: `${MONTHS[period.month - 1]} ${period.year}` },
            ]} />

            <Paper elevation={3} sx={{ p: 3 }}>
                <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ mb: 2 }} variant="scrollable" allowScrollButtonsMobile>
                    <Tab icon={<Badge fontSize="small" />} iconPosition="start" label="Directory" />
                    <Tab icon={<EventAvailable fontSize="small" />} iconPosition="start" label="Attendance" />
                    <Tab icon={<AccessTime fontSize="small" />} iconPosition="start" label="Shifts" />
                    <Tab icon={<Payments fontSize="small" />} iconPosition="start" label="Payroll" />
                </Tabs>

                {tab === 0 && (
                    <>
                        <PageHeader icon={Badge} title="Staff Directory" count={staff.length} countLabel="employees" />
                        <Typography variant="body2" color="text.secondary" mb={2}>
                            Salary and commission set here drive the payroll run. Accounts themselves
                            are created on the <b>Users</b> page.
                        </Typography>
                        <ModuleTable
                            columns={[
                                { key: 'name', label: 'Employee' },
                                { key: 'role', label: 'Role' },
                                { key: 'salary', label: 'Monthly salary', align: 'right' },
                                { key: 'commission', label: 'Commission %', align: 'right' },
                                { key: 'present', label: 'Present this month', align: 'right' },
                                { key: 'owed', label: 'Commission owed', align: 'right' },
                                { key: 'actions', label: '', align: 'right' },
                            ]}
                            rows={staff}
                            empty={{
                                icon: Badge,
                                title: 'No staff accounts yet',
                                hint: 'Staff are created on the Users page; once they exist you can roster shifts and run payroll for them here.',
                            }}
                            renderRow={(p) => (
                                <>
                                    <TableCell>
                                        <Box display="flex" alignItems="center" gap={1.5}>
                                            <Avatar sx={{ bgcolor: 'info.softBg', color: 'info.dark', width: 32, height: 32, fontSize: 13, fontWeight: 700 }}>
                                                {initialsOf(p.name || p.username)}
                                            </Avatar>
                                            <Box>
                                                <Typography variant="body2" fontWeight={600}>{p.name || p.username}</Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    @{p.username}{p.joined_on ? ` · joined ${fmtDate(p.joined_on)}` : ''}
                                                </Typography>
                                            </Box>
                                        </Box>
                                    </TableCell>
                                    <TableCell>
                                        <Chip size="small" variant="outlined" label={p.role} sx={{ textTransform: 'capitalize' }} />
                                    </TableCell>
                                    <TableCell align="right">{money(p.monthly_salary)}</TableCell>
                                    <TableCell align="right">{Number(p.commission_percent)}%</TableCell>
                                    <TableCell align="right">
                                        <Chip size="small" label={p.present_this_month}
                                            color={p.today_status === 'Present' ? 'success' : 'default'} variant="outlined" />
                                    </TableCell>
                                    <TableCell align="right">
                                        <Typography variant="body2" color={Number(p.pending_commission) > 0 ? 'warning.main' : 'text.secondary'}>
                                            {money(p.pending_commission)}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="right">
                                        <Tooltip title="Set salary & commission">
                                            <IconButton size="small" onClick={() => openEmployment(p)}>
                                                <Edit fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    </TableCell>
                                </>
                            )}
                        />
                    </>
                )}

                {tab === 1 && (
                    <>
                        <PageHeader icon={EventAvailable} title="Staff Attendance" count={attendance.length}
                            countLabel="records" actionLabel="Mark attendance" actionIcon={<Add />} onAction={openMark} />
                        <ModuleTable
                            columns={[
                                { key: 'date', label: 'Date' },
                                { key: 'name', label: 'Employee' },
                                { key: 'status', label: 'Status' },
                                { key: 'in', label: 'In' },
                                { key: 'out', label: 'Out' },
                                { key: 'notes', label: 'Notes' },
                                { key: 'actions', label: '', align: 'right' },
                            ]}
                            rows={attendance}
                            empty={{
                                icon: HowToReg,
                                title: 'No attendance marked',
                                hint: 'Hours recorded here feed the payroll draft for the month.',
                                actionLabel: 'Mark attendance',
                                actionIcon: <Add />,
                                onAction: openMark,
                            }}
                            renderRow={(a) => (
                                <>
                                    <TableCell><Typography variant="caption">{fmtDate(a.work_date)}</Typography></TableCell>
                                    <TableCell>
                                        <Typography variant="body2" fontWeight={600}>{a.staff_name}</Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>{a.role}</Typography>
                                    </TableCell>
                                    <TableCell><Chip size="small" label={a.status} color={STATUS_COLOR[a.status] || 'default'} /></TableCell>
                                    <TableCell><Typography variant="caption">{a.check_in || '—'}</Typography></TableCell>
                                    <TableCell><Typography variant="caption">{a.check_out || '—'}</Typography></TableCell>
                                    <TableCell><Typography variant="caption" color="text.secondary">{a.notes || '—'}</Typography></TableCell>
                                    <TableCell align="right">
                                        <IconButton size="small" color="error" title="Remove" onClick={() => deleteAttendance(a)}>
                                            <Delete fontSize="small" />
                                        </IconButton>
                                    </TableCell>
                                </>
                            )}
                        />
                    </>
                )}

                {tab === 2 && (
                    <>
                        <PageHeader icon={AccessTime} title="Shift Roster" count={shifts.length} countLabel="shifts"
                            actionLabel="Add shift" actionIcon={<Add />} onAction={openShift} />
                        <ModuleTable
                            columns={[
                                { key: 'date', label: 'Date' },
                                { key: 'name', label: 'Employee' },
                                { key: 'time', label: 'Shift' },
                                { key: 'note', label: 'Covering' },
                                { key: 'actions', label: '', align: 'right' },
                            ]}
                            rows={shifts}
                            empty={{
                                icon: EventAvailable,
                                title: 'No shifts rostered',
                                hint: 'Roster who is on the floor and when, so cover gaps are obvious before they happen.',
                                actionLabel: 'Add shift',
                                actionIcon: <Add />,
                                onAction: openShift,
                            }}
                            renderRow={(s) => (
                                <>
                                    <TableCell><Typography variant="caption">{fmtDate(s.shift_date)}</Typography></TableCell>
                                    <TableCell>
                                        <Typography variant="body2" fontWeight={600}>{s.staff_name}</Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Chip size="small" variant="outlined" icon={<AccessTime fontSize="small" />}
                                            label={`${String(s.start_time).slice(0, 5)} – ${String(s.end_time).slice(0, 5)}`} />
                                    </TableCell>
                                    <TableCell><Typography variant="caption" color="text.secondary">{s.role_note || '—'}</Typography></TableCell>
                                    <TableCell align="right">
                                        <IconButton size="small" color="error" title="Remove" onClick={() => deleteShift(s)}>
                                            <Delete fontSize="small" />
                                        </IconButton>
                                    </TableCell>
                                </>
                            )}
                        />
                    </>
                )}

                {tab === 3 && (
                    <>
                        <PageHeader
                            icon={Payments}
                            title="Payroll"
                            count={payroll.length}
                            countLabel="rows"
                            actionLabel="Generate drafts"
                            actionIcon={<PlayArrow />}
                            onAction={handleGenerate}
                            actionDisabled={busy}
                            extraActions={
                                <>
                                    <TextField select size="small" label="Month" value={period.month} sx={{ minWidth: 130 }}
                                        onChange={e => setPeriod({ ...period, month: Number(e.target.value) })}>
                                        {MONTHS.map((m, i) => <MenuItem key={m} value={i + 1}>{m}</MenuItem>)}
                                    </TextField>
                                    <TextField select size="small" label="Year" value={period.year} sx={{ minWidth: 100 }}
                                        onChange={e => setPeriod({ ...period, year: Number(e.target.value) })}>
                                        {[period.year - 1, period.year, period.year + 1].map(y => (
                                            <MenuItem key={y} value={y}>{y}</MenuItem>
                                        ))}
                                    </TextField>
                                </>
                            }
                        />
                        <Typography variant="body2" color="text.secondary" mb={2}>
                            Salary is pro-rated from days present (26-day month) and pending
                            commissions are added. Re-generating refreshes drafts and never
                            touches a row already paid.
                        </Typography>
                        <ModuleTable
                            columns={[
                                { key: 'name', label: 'Employee' },
                                { key: 'days', label: 'Days present', align: 'right' },
                                { key: 'base', label: 'Base salary', align: 'right' },
                                { key: 'commission', label: 'Commission', align: 'right' },
                                { key: 'deductions', label: 'Deductions', align: 'right' },
                                { key: 'net', label: 'Net pay', align: 'right' },
                                { key: 'status', label: 'Status' },
                                { key: 'actions', label: '', align: 'right' },
                            ]}
                            rows={payroll}
                            emptyText={<>Nothing drafted for {MONTHS[period.month - 1]} {period.year} — click <b>Generate drafts</b>.</>}
                            renderRow={(p) => (
                                <>
                                    <TableCell>
                                        <Typography variant="body2" fontWeight={600}>{p.staff_name}</Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>{p.role}</Typography>
                                    </TableCell>
                                    <TableCell align="right">{p.days_present}</TableCell>
                                    <TableCell align="right">{money(p.base_salary)}</TableCell>
                                    <TableCell align="right">
                                        <Typography variant="body2" color={Number(p.commission) > 0 ? 'success.main' : 'text.secondary'}>
                                            {money(p.commission)}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="right">
                                        <Typography variant="body2" color={Number(p.deductions) > 0 ? 'error.main' : 'text.secondary'}>
                                            {Number(p.deductions) > 0 ? `−${money(p.deductions)}` : '—'}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="right">
                                        <Typography variant="body2" fontWeight={700}>{money(p.net_pay)}</Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Chip size="small" label={p.status} color={PAYROLL_COLOR[p.status]}
                                            sx={{ textTransform: 'capitalize' }} />
                                        {p.paid_on && (
                                            <Typography variant="caption" color="text.secondary" display="block">
                                                {fmtDate(p.paid_on)}
                                            </Typography>
                                        )}
                                    </TableCell>
                                    <TableCell align="right">
                                        {p.status !== 'paid' && (
                                            <Button size="small" variant="contained" color="success"
                                                startIcon={<CheckCircle />} onClick={() => openPay(p)}>
                                                Pay
                                            </Button>
                                        )}
                                    </TableCell>
                                </>
                            )}
                        />
                    </>
                )}
            </Paper>

            {/* Mark attendance */}
            <FormDialog open={markOpen} title="Mark Staff Attendance" onClose={() => setMarkOpen(false)}
                errors={markErrors} error={error} submitLabel="Mark" submitIcon={<Add />}
                onSubmit={handleMark} busy={busy}>
                <Grid item xs={12} sm={6}>
                    <TextField select fullWidth required={isRequired('user_id')} label="Staff Member"
                        value={markForm.user_id} error={!!markErrors.user_id}
                        onChange={e => setMarkForm({ ...markForm, user_id: e.target.value })}>
                        {staff.map(s => <MenuItem key={s.id} value={s.id}>{s.name || s.username} ({s.role})</MenuItem>)}
                    </TextField>
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField fullWidth required={isRequired('work_date')} type="date" label="Date"
                        value={markForm.work_date} error={!!markErrors.work_date}
                        onChange={e => setMarkForm({ ...markForm, work_date: e.target.value })}
                        InputLabelProps={{ shrink: true }} />
                </Grid>
                <Grid item xs={12} sm={4}>
                    <TextField select fullWidth required={isRequired('status')} label="Status" value={markForm.status}
                        error={!!markErrors.status} onChange={e => setMarkForm({ ...markForm, status: e.target.value })}>
                        {ATTENDANCE_STATUSES.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                    </TextField>
                </Grid>
                <Grid item xs={6} sm={4}>
                    <TextField fullWidth type="time" label="Check in" value={markForm.check_in}
                        onChange={e => setMarkForm({ ...markForm, check_in: e.target.value })}
                        InputLabelProps={{ shrink: true }} />
                </Grid>
                <Grid item xs={6} sm={4}>
                    <TextField fullWidth type="time" label="Check out" value={markForm.check_out}
                        onChange={e => setMarkForm({ ...markForm, check_out: e.target.value })}
                        InputLabelProps={{ shrink: true }} />
                </Grid>
                <Grid item xs={12}>
                    <TextField fullWidth label="Notes" value={markForm.notes}
                        onChange={e => setMarkForm({ ...markForm, notes: e.target.value })} />
                </Grid>
                <Grid item xs={12}>
                    <Typography variant="caption" color="text.secondary">
                        Re-marking the same employee and date updates that record.
                    </Typography>
                </Grid>
            </FormDialog>

            {/* Add shift */}
            <FormDialog open={shiftOpen} title="Add a Shift" onClose={() => setShiftOpen(false)}
                error={error} submitLabel="Add shift" submitIcon={<Add />} onSubmit={handleShift} busy={busy}>
                <Grid item xs={12} sm={6}>
                    <TextField select fullWidth required label="Staff Member" value={shiftForm.user_id}
                        onChange={e => setShiftForm({ ...shiftForm, user_id: e.target.value })}>
                        {staff.map(s => <MenuItem key={s.id} value={s.id}>{s.name || s.username} ({s.role})</MenuItem>)}
                    </TextField>
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField fullWidth required type="date" label="Date" value={shiftForm.shift_date}
                        onChange={e => setShiftForm({ ...shiftForm, shift_date: e.target.value })}
                        InputLabelProps={{ shrink: true }} />
                </Grid>
                <Grid item xs={6} sm={4}>
                    <TextField fullWidth required type="time" label="Start" value={shiftForm.start_time}
                        onChange={e => setShiftForm({ ...shiftForm, start_time: e.target.value })}
                        InputLabelProps={{ shrink: true }} />
                </Grid>
                <Grid item xs={6} sm={4}>
                    <TextField fullWidth required type="time" label="End" value={shiftForm.end_time}
                        onChange={e => setShiftForm({ ...shiftForm, end_time: e.target.value })}
                        InputLabelProps={{ shrink: true }} />
                </Grid>
                <Grid item xs={12} sm={4}>
                    <TextField fullWidth label="Covering" value={shiftForm.role_note}
                        onChange={e => setShiftForm({ ...shiftForm, role_note: e.target.value })}
                        placeholder="e.g. Front desk" />
                </Grid>
            </FormDialog>

            {/* Employment terms */}
            <FormDialog open={employmentOpen} title={`Employment — ${employmentStaff?.name || ''}`}
                onClose={() => setEmploymentOpen(false)} error={error}
                submitLabel="Save terms" submitIcon={<Edit />} onSubmit={handleEmployment} busy={busy} maxWidth="xs">
                <Grid item xs={12}>
                    <TextField fullWidth type="number" label="Monthly Salary (₹)" value={employmentForm.monthly_salary}
                        onChange={e => setEmploymentForm({ ...employmentForm, monthly_salary: e.target.value })}
                        inputProps={{ min: 0 }} helperText="Pro-rated by days present in the payroll run" />
                </Grid>
                <Grid item xs={12}>
                    <TextField fullWidth type="number" label="Commission (%)" value={employmentForm.commission_percent}
                        onChange={e => setEmploymentForm({ ...employmentForm, commission_percent: e.target.value })}
                        inputProps={{ min: 0, max: 100 }}
                        helperText="Default rate; PT packages carry their own rate" />
                </Grid>
                <Grid item xs={12}>
                    <TextField fullWidth type="date" label="Joined on" value={employmentForm.joined_on}
                        onChange={e => setEmploymentForm({ ...employmentForm, joined_on: e.target.value })}
                        InputLabelProps={{ shrink: true }} />
                </Grid>
            </FormDialog>

            {/* Pay salary */}
            <FormDialog open={payOpen} title={`Pay ${payRow?.staff_name || ''}`} onClose={() => setPayOpen(false)}
                error={error} submitLabel="Mark paid" submitColor="success" submitIcon={<CheckCircle />}
                onSubmit={handlePay} busy={busy} maxWidth="xs">
                <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary">
                        Base {money(payRow?.base_salary || 0)} + commission {money(payRow?.commission || 0)}
                    </Typography>
                </Grid>
                <Grid item xs={12}>
                    <TextField fullWidth type="number" label="Deductions (₹)" value={payForm.deductions}
                        onChange={e => setPayForm({ ...payForm, deductions: e.target.value })} inputProps={{ min: 0 }} />
                </Grid>
                <Grid item xs={12}>
                    <TextField select fullWidth label="Paid via" value={payForm.method}
                        onChange={e => setPayForm({ ...payForm, method: e.target.value })}>
                        {PAYMENT_MODES.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                    </TextField>
                </Grid>
                <Grid item xs={12}>
                    <TextField fullWidth label="Notes" value={payForm.notes}
                        onChange={e => setPayForm({ ...payForm, notes: e.target.value })} />
                </Grid>
                <Grid item xs={12}>
                    <Divider sx={{ mb: 1 }} />
                    <Box display="flex" justifyContent="space-between" alignItems="baseline">
                        <Typography variant="body2" color="text.secondary">Net pay</Typography>
                        <Typography variant="h6" color="primary.main">
                            {money(Number(payRow?.base_salary || 0) + Number(payRow?.commission || 0) - Number(payForm.deductions || 0))}
                        </Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                        Marking paid also settles this month's pending commissions for this employee.
                    </Typography>
                </Grid>
            </FormDialog>
        </Box>
    );
};

export default StaffPage;
