// frontend/src/components/AttendanceForm.jsx

import React, { useState, useEffect } from 'react';
import api from '../api';
import {
    log, logError } from '../logger';
import {
    TextField, Button, MenuItem, GridLegacy as Grid, Box, Typography, Paper, Alert, Switch, FormControlLabel, Stack, Chip
} from '@mui/material';
import Alerts from './Alerts';
import { FactCheck,
} from '@mui/icons-material';
import { patternError } from '../validation';
import { useToast } from './ui';

const AttendanceForm = ({ onAttendanceMarked }) => {
    const toast = useToast();
    const [formData, setFormData] = useState({
        member_id: '',
        member_name: '',
        status: 'Present'
    });
    const [members, setMembers] = useState([]);
    const [allMembers, setAllMembers] = useState([]);
    const [manual, setManual] = useState(false);
    const [membersLoaded, setMembersLoaded] = useState(false);
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState('');
    // { status: 'found', member } | { status: 'notfound', id } | null
    const [lookup, setLookup] = useState(null);
    // Exceptions master table (module = attendance) — alert texts come from the
    // DB as "[E-code] MESSAGE." so they can be edited without touching code.
    const [exceptions, setExceptions] = useState([]);

    // Fallbacks only apply before the exceptions fetch resolves.
    const notRegEx = exceptions.find(e => e.field_name === 'member_id') || {
        code: 'E2001',
        message: 'MEMBER ID IS NOT REGISTERED. USE THE LEADS FEATURE FOR WALK-INS.',
        format_message: 'NUMBER ONLY ALLOWED'
    };

    useEffect(() => {
        api.get('/exceptions?module=attendance')
            .then(res => { if (Array.isArray(res.data) && res.data.length) setExceptions(res.data); })
            .catch(err => console.error('[AttendanceForm] exceptions load failed (using fallback):', err?.message));
    }, []);

    useEffect(() => {
        api.get('/clients')
            .then(res => {
                setAllMembers(res.data);
                setMembers(res.data.filter(c => c.status === 'active'));
                setMembersLoaded(true);
            })
            .catch(err => {
                console.error('Error fetching members:', err);
                setLoadError('Failed to load members. Check that the backend is running.');
                setMembersLoaded(true);
            });
    }, []);

    // In manual mode, look up the typed Member ID against registered members.
    useEffect(() => {
        if (!manual) { setLookup(null); return; }
        const id = formData.member_id;
        if (!id || allMembers.length === 0) { setLookup(null); return; }
        const member = allMembers.find(m => String(m.member_code) === String(id));
        if (member) {
            setLookup({ status: 'found', member });
            // Auto-fill the member's registered name — the operator can still edit it.
            setFormData(prev => ({ ...prev, member_name: member.name.toUpperCase() }));
        } else {
            setLookup({ status: 'notfound', id });
            // An unregistered ID must never keep a stale autofilled name — manual
            // marking is only allowed for registered members.
            setFormData(prev => ({ ...prev, member_name: '' }));
        }
    }, [formData.member_id, manual, allMembers]);

    // Manual marking stays OFF by default. It only auto-enables when the member
    // list has genuinely loaded and there are no registered members to select —
    // not while the list is still fetching (which used to flip the switch on
    // every page load).
    useEffect(() => {
        if (membersLoaded && members.length === 0) setManual(true);
    }, [membersLoaded, members]);

    const handleChange = (e) => {
        const { name, value } = e.target;

        if (name === 'member_id') {
            // Keep the typed value so the format error is visible; validation
            // ("Number only allowed") shows live and blocks submit.
            setFormData({ ...formData, [name]: value });
        } else if (name === 'member_name') {
            if (/^[a-zA-Z ]*$/.test(value)) {
                setFormData({ ...formData, [name]: value.toUpperCase() });
            }
        } else {
            setFormData({ ...formData, [name]: value });
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        // The Manual switch is the master switch for this form: when it's off,
        // no attendance may be marked here (members use the machine or QR).
        if (!manual) {
            setError('Manual attendance is turned off — turn the switch on to mark attendance.');
            toast.success('');
            return;
        }
        if (patternError(formData.member_id, 'numeric')) {
            setError(`[${notRegEx.code}] ${notRegEx.format_message}.`);
            toast.success('');
            return;
        }
        if (lookup?.status === 'notfound') {
            setError(`[${notRegEx.code}] ${notRegEx.message}.`);
            toast.success('');
            return;
        }
        const now = new Date();
        const formattedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const formattedTime = now.toLocaleTimeString('en-GB', { hour12: false });

        const payload = {
            ...formData,
            date: formattedDate,
            time: formattedTime
        };
        log('AttendanceForm', 'handleSubmit', `→ mark attendance id=${formData.member_id} name="${formData.member_name}" status=${formData.status}`);

        try {
            const res = await api.post('/attendance/mark', payload);
            log('AttendanceForm', 'handleSubmit', `← marked: ${res.data.message}`);

            toast.success(res.data.message);
            setError('');
            onAttendanceMarked();
            setFormData({ member_id: '', member_name: '', status: 'Present' });

        } catch (error) {
            logError('AttendanceForm', 'handleSubmit', `✗ mark failed for id=${formData.member_id}: ${error.response?.data?.message || error.response?.data?.error || error.message}`, error);
            if (error.response && error.response.data && error.response.data.message) {
                setError(error.response.data.message);
            } else {
                setError(error.response?.data?.error || 'Failed to mark attendance.');
            }
            toast.success('');
        }
    };

    return (
        <Paper sx={{ p: 3, mb: 3 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
                <Box display="flex" alignItems="center" gap={1}>
                    <FactCheck sx={{ color: 'primary.main' }} />
                    <Typography variant="h6">Mark Attendance</Typography>
                </Box>
                {manual && (
                    <Chip size="small" label="Manual entry on" color="warning" variant="outlined" />
                )}
            </Stack>

            <Alerts items={[
                error && { severity: 'error', text: error },
                loadError && { severity: 'error', text: loadError },
                manual && !!patternError(formData.member_id, 'numeric') && {
                    severity: 'error',
                    text: `[${notRegEx.code}] ${notRegEx.format_message}.`,
                },
                manual && lookup?.status === 'notfound' && {
                    severity: 'error',
                    text: `[${notRegEx.code}] ${notRegEx.message}.`,
                },
            ]} />

            <form onSubmit={handleSubmit}>
                <Grid container spacing={2} alignItems="center">
                    <Grid item xs={12} sm={2} md={1.5} sx={{ alignSelf: { sm: 'flex-start' } }}>
                        {/* Fixed-height wrapper keeps the switch centred against the inputs */}
                        <Box sx={{ height: 56, display: 'flex', alignItems: 'center' }}>
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={manual}
                                        onChange={e => setManual(e.target.checked)}
                                    />
                                }
                                label="Manual"
                            />
                        </Box>
                    </Grid>

                    {!manual ? (
                        /* Locked state: manual marking is off — only the switch is shown. */
                        <Grid item xs={12} sm={10} md={10.5} sx={{ alignSelf: { sm: 'flex-start' } }}>
                            <Box sx={{ height: 56, display: 'flex', alignItems: 'center' }}>
                                <Typography variant="body2" color="text.secondary">
                                    Members are checking in on the fingerprint terminal and by QR code.
                                    Switch on <b>Manual</b> to record someone by hand.
                                </Typography>
                            </Box>
                        </Grid>
                    ) : (
                        <>
                            <Grid item xs={12} sm={5} md={3.5}>
                                <TextField
                                    fullWidth
                                    label="Member ID"
                                    name="member_id"
                                    value={formData.member_id}
                                    onChange={handleChange}
                                    required
                                    // Field level: red mark ONLY — alert text lives in the
                                    // [E-code] banners above the form.
                                    error={!!patternError(formData.member_id, 'numeric') || lookup?.status === 'notfound'}
                                    inputProps={{ inputMode: 'numeric' }}
                                    // minHeight reserves up to 2 helper lines so wrapping text never changes this
                                    // field's height — keeps the row aligned with Member Name and Status.
                                    helperText={
                                        <Box component="span" sx={{ display: 'inline-block', minHeight: 40 }}>
                                            {lookup?.status === 'found' ? (
                                                <Box component="span" sx={{ color: 'success.main', fontWeight: 600 }}>
                                                    ✓ {lookup.member.name}
                                                </Box>
                                            ) : 'Matched by this ID'}
                                        </Box>
                                    }
                                />
                            </Grid>
                            <Grid item xs={12} sm={6} md={3.5}>
                                <TextField
                                    fullWidth
                                    label="Member Name"
                                    name="member_name"
                                    value={formData.member_name}
                                    onChange={handleChange}
                                    required
                                    inputProps={{ style: { textTransform: 'uppercase' } }}
                                    // Reserve the same helper space as Member ID so the row stays aligned
                                    helperText={
                                        <Box component="span" sx={{ display: 'inline-block', minHeight: 40 }}>
                                            {'\u00A0'}
                                        </Box>
                                    }
                                />
                            </Grid>
                            <Grid item xs={12} sm={3} md={2}>
                                <TextField
                                    select
                                    fullWidth
                                    label="Status"
                                    name="status"
                                    value={formData.status}
                                    onChange={handleChange}
                                    // Reserve the same helper space as Member ID so the row stays aligned
                                    helperText={
                                        <Box component="span" sx={{ display: 'inline-block', minHeight: 40 }}>
                                            {'\u00A0'}
                                        </Box>
                                    }
                                >
                                    <MenuItem value="Present">Present</MenuItem>
                                    <MenuItem value="Absent">Absent</MenuItem>
                                </TextField>
                            </Grid>
                            <Grid item xs={12} sm={3} md={1.5} sx={{ alignSelf: { sm: 'flex-start' } }}>
                                <Button
                                    fullWidth
                                    variant="contained"
                                    color="success"
                                    type="submit"
                                    size="large"
                                    sx={{ height: 56, fontSize: 16 }}
                                    disabled={
                                        !formData.member_id.trim() ||
                                        !!patternError(formData.member_id, 'numeric') ||
                                        lookup?.status === 'notfound'
                                    }
                                >
                                    Mark
                                </Button>
                            </Grid>
                        </>
                    )}
                </Grid>
            </form>
        </Paper>
    );
};

export default AttendanceForm;
