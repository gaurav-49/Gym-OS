// frontend/src/components/ClassesPage.jsx
import React, { useEffect, useState } from 'react';
import {
    Paper, Typography, TextField, Button, MenuItem, GridLegacy as Grid, Box, Chip, Stack, Dialog, DialogTitle, DialogContent, DialogActions, Alert, Card, CardContent, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, LinearProgress, IconButton, Avatar, Divider, InputAdornment, } from '@mui/material';
import Alerts from './Alerts';
import {
    EventAvailable, Add, Delete, Edit, Visibility, PersonAdd, History, DateRange,
} from '@mui/icons-material';
import api from '../api';
import { log, logError } from '../logger';
import { useConfirm, useToast } from './ui';

const WEEKDAYS = [
    { value: 0, label: 'Sunday' }, { value: 1, label: 'Monday' }, { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' }, { value: 4, label: 'Thursday' }, { value: 5, label: 'Friday' },
    { value: 6, label: 'Saturday' },
];

const fmtDate = (d) => {
    if (!d) return '—';
    const date = new Date(`${d}T00:00:00`);
    return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};
const fmtTime = (t) => (t ? String(t).slice(0, 5) : '—');
const initialsOf = (name) => (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

const emptyClass = { name: '', description: '', trainer_id: '', class_date: '', start_time: '07:00', end_time: '08:00', capacity: 20 };
const emptySeries = { name: '', description: '', trainer_id: '', weekday: 1, start_date: '', end_date: '', start_time: '18:00', end_time: '19:00', capacity: 20 };

const ClassesPage = ({ isAdmin }) => {
    const toast = useToast();
    const [classes, setClasses] = useState([]);
    const [trainers, setTrainers] = useState([]);
    const [members, setMembers] = useState([]);
    const [showPast, setShowPast] = useState(false);
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState('');

    const [addOpen, setAddOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(emptyClass);

    const [seriesOpen, setSeriesOpen] = useState(false);
    const [series, setSeries] = useState(emptySeries);

    const [detail, setDetail] = useState(null); // class with bookings
    const [detailOpen, setDetailOpen] = useState(false);

    const [bookClass, setBookClass] = useState(null);
    const [bookMember, setBookMember] = useState('');
    const [bookOpen, setBookOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    const fetchAll = async (past = showPast) => {
        try {
            const res = await api.get('/classes', { params: past ? { include_past: 1 } : {} });
            setClasses(res.data);
            setLoadError('');
        } catch (err) {
            setLoadError(err.response?.data?.error || 'Failed to load classes.');
        }
    };

    useEffect(() => {
        fetchAll(false);
        api.get('/classes/trainers').then(r => setTrainers(r.data)).catch(() => { /* optional */ });
        api.get('/clients').then(r => setMembers(r.data.filter(c => c.status === 'active'))).catch(() => { /* optional */ });
    }, []);

    const openAdd = (cls) => {
        setEditing(cls || null);
        setForm(cls ? {
            name: cls.name, description: cls.description || '', trainer_id: cls.trainer_id ? String(cls.trainer_id) : '',
            class_date: cls.class_date || '', start_time: String(cls.start_time || '').slice(0, 5),
            end_time: cls.end_time ? String(cls.end_time).slice(0, 5) : '', capacity: cls.capacity,
        } : emptyClass);
        setError('');
        toast.success('');
        setAddOpen(true);
    };

    const handleSaveClass = async () => {
        if (!form.name.trim()) { setError('Class name is required.'); return; }
        if (!form.class_date) { setError('Pick a class date.'); return; }
        if (!form.start_time) { setError('Pick a start time.'); return; }
        const cap = Number(form.capacity);
        if (!form.capacity || isNaN(cap) || cap < 1) { setError('Capacity must be at least 1.'); return; }
        setSaving(true);
        setError('');
        log('ClassesPage', 'handleSaveClass', `→ ${editing ? 'update' : 'create'} class name="${form.name}" date=${form.class_date} cap=${cap}`);
        try {
            const payload = {
                name: form.name.trim(), description: form.description || null,
                trainer_id: form.trainer_id || null, class_date: form.class_date,
                start_time: form.start_time, end_time: form.end_time || null, capacity: cap,
            };
            if (editing) {
                await api.put(`/classes/${editing.id}`, payload);
                toast.success('Class updated.');
            } else {
                await api.post('/classes', payload);
                toast.success('Class scheduled.');
            }
            setAddOpen(false);
            fetchAll();
        } catch (err) {
            logError('ClassesPage', 'handleSaveClass', `✗ failed: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to save the class.');
        } finally {
            setSaving(false);
        }
    };

    const handleSaveSeries = async () => {
        if (!series.name.trim()) { setError('Class name is required.'); return; }
        if (!series.start_date || !series.end_date) { setError('Pick start and end dates.'); return; }
        if (series.end_date < series.start_date) { setError('End date must be after the start date.'); return; }
        const cap = Number(series.capacity);
        if (!series.capacity || isNaN(cap) || cap < 1) { setError('Capacity must be at least 1.'); return; }
        setSaving(true);
        setError('');
        log('ClassesPage', 'handleSaveSeries', `→ create series name="${series.name}" ${series.start_date}..${series.end_date} weekday=${series.weekday}`);
        try {
            const res = await api.post('/classes/series', {
                name: series.name.trim(), description: series.description || null,
                trainer_id: series.trainer_id || null, weekday: Number(series.weekday),
                start_date: series.start_date, end_date: series.end_date,
                start_time: series.start_time, end_time: series.end_time || null, capacity: cap,
            });
            toast.success(res.data.message || 'Series created.');
            setSeriesOpen(false);
            setSeries(emptySeries);
            fetchAll();
        } catch (err) {
            logError('ClassesPage', 'handleSaveSeries', `✗ failed: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to create the series.');
        } finally {
            setSaving(false);
        }
    };

    const openDetail = async (cls) => {
        try {
            const res = await api.get(`/classes/${cls.id}`);
            setDetail(res.data);
            setDetailOpen(true);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to load class details.');
        }
    };

    const confirm = useConfirm();

    const handleCancelClass = async (cls) => {
        if (!await confirm({
            title: `Cancel ${cls.name}?`,
            body: <>The class on {fmtDate(cls.class_date)} is called off. Bookings are kept for history, and booked members should be told.</>,
            confirmLabel: 'Cancel class', danger: true,
        })) return;
        log('ClassesPage', 'handleCancelClass', `→ cancel class id=${cls.id} "${cls.name}"`);
        try {
            const res = await api.delete(`/classes/${cls.id}`);
            toast.success(res.data.message || 'Class cancelled.');
            setDetailOpen(false);
            fetchAll();
        } catch (err) {
            logError('ClassesPage', 'handleCancelClass', `✗ failed for class ${cls?.id}: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to cancel the class.');
        }
    };

    const openBook = (cls) => {
        setBookClass(cls);
        setBookMember('');
        setError('');
        setBookOpen(true);
    };

    const handleBook = async () => {
        if (!bookMember) { setError('Select a member to book.'); return; }
        setSaving(true);
        setError('');
        log('ClassesPage', 'handleBook', `→ book member ${bookMember} into class id=${bookClass?.id}`);
        try {
            const res = await api.post(`/classes/${bookClass.id}/book`, { member_id: bookMember });
            toast.success(res.data.message);
            setBookOpen(false);
            fetchAll();
        } catch (err) {
            logError('ClassesPage', 'handleBook', `✗ failed: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to book the member.');
        } finally {
            setSaving(false);
        }
    };

    const handleCancelBooking = async (classId, memberId) => {
        log('ClassesPage', 'handleCancelBooking', `→ cancel booking class=${classId} member=${memberId}`);
        try {
            const res = await api.post(`/classes/${classId}/cancel-booking`, { member_id: memberId });
            toast.success(res.data.message);
            openDetail({ id: classId });
            fetchAll();
        } catch (err) {
            logError('ClassesPage', 'handleCancelBooking', `✗ failed: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to cancel the booking.');
        }
    };

    const statusChip = (status) => (
        <Chip
            size="small"
            label={status}
            color={status === 'booked' ? 'success' : status === 'waitlisted' ? 'warning' : 'default'}
            variant="outlined"
        />
    );

    return (
        <>
            <Paper elevation={3} sx={{ p: 3 }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
                    <Box display="flex" alignItems="center" gap={1}>
                        <EventAvailable sx={{ color: 'primary.main' }} />
                        <Typography variant="h6">Classes & Bookings</Typography>
                        {/* The list swaps to past classes behind "Show past",
                            but the chip kept counting them as upcoming — so
                            the screen said "56 upcoming" over a table of
                            classes that had already happened. */}
                        <Chip size="small" variant="outlined"
                            label={`${classes.length} ${showPast ? 'shown' : 'upcoming'}`} />
                    </Box>
                    <Stack direction="row" spacing={1}>
                        <Button variant="outlined" startIcon={<History />} onClick={() => { setShowPast(s => !s); fetchAll(!showPast); }}>
                            {showPast ? 'Upcoming only' : 'Show past'}
                        </Button>
                        <Button variant="outlined" startIcon={<DateRange />} onClick={() => { setSeries(emptySeries); setError(''); setSeriesOpen(true); }}>
                            Add Series
                        </Button>
                        <Button variant="contained" startIcon={<Add />} onClick={() => openAdd(null)}>
                            Add Class
                        </Button>
                    </Stack>
                </Box>

                <Alerts items={[
                    error && { severity: 'error', text: error },
                    loadError && { severity: 'error', text: loadError },
                ]} />

                {classes.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                        {showPast ? 'No classes found.' : 'No upcoming classes — schedule the first one with "Add Class" or "Add Series".'}
                    </Typography>
                ) : (
                    <Grid container spacing={2}>
                        {classes.map(c => {
                            const pct = c.capacity ? Math.min(100, Math.round((c.booked / c.capacity) * 100)) : 0;
                            const full = c.booked >= c.capacity;
                            return (
                                <Grid item xs={12} sm={6} lg={4} key={c.id}>
                                    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                                        <CardContent sx={{ flexGrow: 1, pb: 1 }}>
                                            <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={1}>
                                                <Box>
                                                    <Typography fontWeight={700}>{c.name}</Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        {fmtDate(c.class_date)} · {fmtTime(c.start_time)}–{fmtTime(c.end_time)}
                                                    </Typography>
                                                </Box>
                                                <Chip
                                                    size="small"
                                                    label={full ? 'Full' : `${c.booked}/${c.capacity}`}
                                                    color={full ? 'error' : 'primary'}
                                                    variant="outlined"
                                                />
                                            </Box>
                                            <Box sx={{ mt: 1.5, mb: 0.5 }}>
                                                <LinearProgress
                                                    variant="determinate"
                                                    value={pct}
                                                    color={full ? 'error' : 'success'}
                                                    sx={{ height: 8, borderRadius: 4 }}
                                                />
                                            </Box>
                                            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                                                <Typography variant="caption" color="text.secondary">
                                                    Trainer: {c.trainer_name || '—'}
                                                </Typography>
                                                {c.waitlisted > 0 && (
                                                    <Chip size="small" label={`${c.waitlisted} waiting`} color="warning" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                                                )}
                                            </Stack>
                                        </CardContent>
                                        <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                                            <Button size="small" startIcon={<Visibility />} onClick={() => openDetail(c)}>View</Button>
                                            <Button size="small" startIcon={<PersonAdd />} onClick={() => openBook(c)}>Book</Button>
                                            <Button size="small" startIcon={<Edit />} onClick={() => openAdd(c)}>Edit</Button>
                                            {isAdmin && (
                                                <Button size="small" color="error" startIcon={<Delete />} onClick={() => handleCancelClass(c)}>Cancel</Button>
                                            )}
                                        </Box>
                                    </Card>
                                </Grid>
                            );
                        })}
                    </Grid>
                )}
            </Paper>

            {/* Add / Edit class */}
            <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>{editing ? `Edit Class — ${editing.name}` : 'Add Class'}</DialogTitle>
                <DialogContent>
                    <Alerts items={[error && { severity: 'error', text: error }]} />
                    <Grid container spacing={2} sx={{ mt: 0.5 }}>
                        <Grid item xs={12}>
                            <TextField fullWidth label="Class Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField select fullWidth label="Trainer" value={form.trainer_id} onChange={e => setForm({ ...form, trainer_id: e.target.value })}>
                                <MenuItem value=""><em>Unassigned</em></MenuItem>
                                {trainers.map(t => <MenuItem key={t.id} value={t.id}>{t.name || t.username}</MenuItem>)}
                            </TextField>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth type="date" label="Class Date" value={form.class_date}
                                onChange={e => setForm({ ...form, class_date: e.target.value })} InputLabelProps={{ shrink: true }} />
                        </Grid>
                        <Grid item xs={12} sm={4}>
                            <TextField fullWidth type="time" label="Start" value={form.start_time}
                                onChange={e => setForm({ ...form, start_time: e.target.value })} InputLabelProps={{ shrink: true }} />
                        </Grid>
                        <Grid item xs={12} sm={4}>
                            <TextField fullWidth type="time" label="End" value={form.end_time}
                                onChange={e => setForm({ ...form, end_time: e.target.value })} InputLabelProps={{ shrink: true }} />
                        </Grid>
                        <Grid item xs={12} sm={4}>
                            <TextField fullWidth type="number" label="Capacity" value={form.capacity}
                                onChange={e => setForm({ ...form, capacity: e.target.value })} inputProps={{ min: 1 }} />
                        </Grid>
                        <Grid item xs={12}>
                            <TextField fullWidth multiline rows={2} label="Description" value={form.description}
                                onChange={e => setForm({ ...form, description: e.target.value })} />
                        </Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAddOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleSaveClass} disabled={saving}>
                        {editing ? 'Save Changes' : 'Schedule Class'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Weekly series */}
            <Dialog open={seriesOpen} onClose={() => setSeriesOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Add Weekly Series</DialogTitle>
                <DialogContent>
                    <Alerts items={[error && { severity: 'error', text: error }]} />
                    <Grid container spacing={2} sx={{ mt: 0.5 }}>
                        <Grid item xs={12}>
                            <TextField fullWidth label="Class Name" value={series.name} onChange={e => setSeries({ ...series, name: e.target.value })} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField select fullWidth label="Trainer" value={series.trainer_id} onChange={e => setSeries({ ...series, trainer_id: e.target.value })}>
                                <MenuItem value=""><em>Unassigned</em></MenuItem>
                                {trainers.map(t => <MenuItem key={t.id} value={t.id}>{t.name || t.username}</MenuItem>)}
                            </TextField>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField select fullWidth label="Repeat every" value={series.weekday} onChange={e => setSeries({ ...series, weekday: e.target.value })}>
                                {WEEKDAYS.map(d => <MenuItem key={d.value} value={d.value}>{d.label}</MenuItem>)}
                            </TextField>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth type="date" label="Start Date" value={series.start_date}
                                onChange={e => setSeries({ ...series, start_date: e.target.value })} InputLabelProps={{ shrink: true }} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth type="date" label="End Date" value={series.end_date}
                                onChange={e => setSeries({ ...series, end_date: e.target.value })} InputLabelProps={{ shrink: true }} />
                        </Grid>
                        <Grid item xs={12} sm={4}>
                            <TextField fullWidth type="time" label="Start" value={series.start_time}
                                onChange={e => setSeries({ ...series, start_time: e.target.value })} InputLabelProps={{ shrink: true }} />
                        </Grid>
                        <Grid item xs={12} sm={4}>
                            <TextField fullWidth type="time" label="End" value={series.end_time}
                                onChange={e => setSeries({ ...series, end_time: e.target.value })} InputLabelProps={{ shrink: true }} />
                        </Grid>
                        <Grid item xs={12} sm={4}>
                            <TextField fullWidth type="number" label="Capacity" value={series.capacity}
                                onChange={e => setSeries({ ...series, capacity: e.target.value })} inputProps={{ min: 1 }} />
                        </Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setSeriesOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleSaveSeries} disabled={saving}>Create Series</Button>
                </DialogActions>
            </Dialog>

            {/* Book a member */}
            <Dialog open={bookOpen} onClose={() => setBookOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Book Member — {bookClass?.name}</DialogTitle>
                <DialogContent>
                    <Alerts items={[error && { severity: 'error', text: error }]} />
                    <TextField select fullWidth label="Member" value={bookMember} onChange={e => setBookMember(e.target.value)} sx={{ mt: 1 }}>
                        {members.map(m => (
                            <MenuItem key={m.id} value={m.id}>{m.name} (ID {m.member_code})</MenuItem>
                        ))}
                    </TextField>
                    {bookClass && bookClass.booked >= bookClass.capacity && (
                        <Alert severity="warning" sx={{ mt: 2 }}>
                            This class is full ({bookClass.booked}/{bookClass.capacity}) — the member will be added to the waitlist.
                        </Alert>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setBookOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleBook} disabled={saving}>Book</Button>
                </DialogActions>
            </Dialog>

            {/* Class detail / bookings */}
            <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>
                    {detail?.name}
                    <Typography variant="caption" display="block" color="text.secondary">
                        {detail ? `${fmtDate(detail.class_date)} · ${fmtTime(detail.start_time)}–${fmtTime(detail.end_time)} · Trainer: ${detail.trainer_name || '—'}` : ''}
                    </Typography>
                </DialogTitle>
                <DialogContent>
                    {detail && (
                        <>
                            <Box display="flex" gap={1} mb={2} flexWrap="wrap">
                                <Chip label={`${detail.booked}/${detail.capacity} booked`} color={detail.booked >= detail.capacity ? 'error' : 'success'} variant="outlined" />
                                {detail.waitlisted > 0 && <Chip label={`${detail.waitlisted} on waitlist`} color="warning" variant="outlined" />}
                                <Chip label={detail.status} variant="outlined" />
                                <Button size="small" startIcon={<PersonAdd />} onClick={() => { setDetailOpen(false); openBook(detail); }}>
                                    Book Member
                                </Button>
                            </Box>
                            <Divider sx={{ mb: 2 }} />
                            {detail.bookings.length === 0 ? (
                                <Typography variant="body2" color="text.secondary">No bookings yet.</Typography>
                            ) : (
                                <TableContainer>
                                    <Table size="small">
                                        <TableHead>
                                            <TableRow>
                                                <TableCell>Member</TableCell>
                                                <TableCell>Status</TableCell>
                                                <TableCell align="right" />
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {detail.bookings.map(b => (
                                                <TableRow key={b.id}>
                                                    <TableCell>
                                                        <Box display="flex" alignItems="center" gap={1}>
                                                            <Avatar sx={{ width: 28, height: 28, fontSize: 11, fontWeight: 700, bgcolor: 'secondary.softBg', color: 'secondary.dark' }}>
                                                                {initialsOf(b.member_name)}
                                                            </Avatar>
                                                            <Box>
                                                                <Typography variant="body2" fontWeight={600}>{b.member_name}</Typography>
                                                                <Typography variant="caption" color="text.secondary">ID {b.member_code}</Typography>
                                                            </Box>
                                                        </Box>
                                                    </TableCell>
                                                    <TableCell>{statusChip(b.status)}</TableCell>
                                                    <TableCell align="right">
                                                        <IconButton size="small" color="error" title="Cancel booking" onClick={() => handleCancelBooking(b.class_id || detail.id, b.member_id)}>
                                                            <Delete fontSize="small" />
                                                        </IconButton>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            )}
                        </>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDetailOpen(false)}>Close</Button>
                </DialogActions>
            </Dialog>
        </>
    );
};

export default ClassesPage;
