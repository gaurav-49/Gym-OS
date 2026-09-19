// frontend/src/components/NotificationsPage.jsx
import React, { useEffect, useState } from 'react';
import {
    Paper, Typography, TextField, Button, Alert, Box, Chip, Stack, Switch, FormControlLabel, RadioGroup, Radio, GridLegacy as Grid, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, } from '@mui/material';
import Alerts from './Alerts';
import { Save, Send, NotificationsActive, History, HourglassBottom,
} from '@mui/icons-material';
import api from '../api';
import { log, logError } from '../logger';
import { useToast } from './ui';

const daysLeft = (dateStr) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(`${dateStr}T00:00:00`);
    return Math.round((target - today) / 86400000);
};

const NotificationsPage = () => {
    const toast = useToast();
    const [settings, setSettings] = useState(null);
    const [expiring, setExpiring] = useState({ days: 7, members: [] });
    const [messageLog, setMessageLog] = useState([]);
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState('');
    const [saving, setSaving] = useState(false);
    const [sending, setSending] = useState(false);

    const fetchAll = async () => {
        try {
            const [s, e, l] = await Promise.all([
                api.get('/notifications/settings'),
                api.get('/notifications/expiring'),
                api.get('/notifications/log'),
            ]);
            setSettings(s.data);
            setExpiring(e.data);
            setMessageLog(l.data);
            setLoadError('');
        } catch (err) {
            console.error('Error loading notifications:', err);
            setLoadError(err.response?.data?.error || 'Failed to load notification settings.');
        }
    };

    useEffect(() => { fetchAll(); }, []);

    const handleSave = async () => {
        setSaving(true);
        setError('');
        log('NotificationsPage', 'handleSave', `→ save settings enabled=${settings?.expiry_reminder_enabled} days=${settings?.expiry_reminder_days} channel=${settings?.expiry_reminder_channel}`);
        try {
            const res = await api.put('/notifications/settings', {
                expiry_reminder_enabled: settings.expiry_reminder_enabled,
                expiry_reminder_days: Number(settings.expiry_reminder_days),
                expiry_reminder_channel: settings.expiry_reminder_channel,
                expiry_reminder_message: settings.expiry_reminder_message,
                renewal_receipt_enabled: settings.renewal_receipt_enabled,
            });
            setSettings(res.data);
            toast.success('Settings saved.');
            fetchAll();
        } catch (err) {
            logError('NotificationsPage', 'handleSave', `✗ failed: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to save settings.');
        } finally {
            setSaving(false);
        }
    };

    const sendOne = async (member) => {
        setSending(true);
        setError('');
        log('NotificationsPage', 'sendOne', `→ send reminder to member id=${member.id} code=${member.member_code}`);
        try {
            const res = await api.post(`/notifications/expiry-reminder/${member.id}`);
            toast.success(res.data.message);
            fetchAll();
        } catch (err) {
            logError('NotificationsPage', 'sendOne', `✗ failed for member ${member?.id}: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to send reminder.');
        } finally {
            setSending(false);
        }
    };

    const sendAll = async () => {
        setSending(true);
        setError('');
        log('NotificationsPage', 'sendAll', '→ send reminders to all expiring members');
        try {
            const res = await api.post('/notifications/expiry-reminders');
            toast.success(res.data.message);
            fetchAll();
        } catch (err) {
            logError('NotificationsPage', 'sendAll', `✗ failed: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to send reminders.');
        } finally {
            setSending(false);
        }
    };

    if (!settings) {
        return loadError ? <Alert severity="error">{loadError}</Alert> : (
            <Paper sx={{ p: 5, textAlign: 'center' }}>
                <Typography variant="h6">Loading reminders…</Typography>
            </Paper>
        );
    }

    const set = (key, value) => setSettings({ ...settings, [key]: value });

    return (
        <Box>
            <Alerts items={[
                error && { severity: 'error', text: error },
                loadError && { severity: 'error', text: loadError },
            ]} />

            <Grid container spacing={3}>
                {/* Settings */}
                <Grid item xs={12} lg={5}>
                    <Paper sx={{ p: 3 }}>
                        <Stack direction="row" alignItems="center" gap={1} mb={2}>
                            <NotificationsActive sx={{ color: 'primary.main' }} />
                            <Typography variant="h6">Expiry Reminder Settings</Typography>
                        </Stack>

                        <FormControlLabel
                            control={
                                <Switch
                                    checked={settings.expiry_reminder_enabled}
                                    onChange={e => set('expiry_reminder_enabled', e.target.checked)}
                                />
                            }
                            label="Auto-send reminders when memberships are expiring"
                        />

                        <Box mt={2} mb={2}>
                            <TextField
                                fullWidth type="number" size="small"
                                label="Remind this many days before expiry"
                                value={settings.expiry_reminder_days}
                                onChange={e => set('expiry_reminder_days', e.target.value)}
                                inputProps={{ min: 1, max: 365 }}
                                helperText="The server checks hourly and sends once per expiry."
                            />
                        </Box>

                        <Typography variant="body2" fontWeight={600} mb={0.5}>Send via</Typography>
                        <RadioGroup
                            row
                            value={settings.expiry_reminder_channel}
                            onChange={e => set('expiry_reminder_channel', e.target.value)}
                        >
                            <FormControlLabel value="email" control={<Radio />} label="Email" />
                            <FormControlLabel value="whatsapp" control={<Radio />} label="WhatsApp" />
                            <FormControlLabel value="both" control={<Radio />} label="Both" />
                        </RadioGroup>

                        <TextField
                            fullWidth multiline rows={4} sx={{ mt: 2 }}
                            label="Message template"
                            value={settings.expiry_reminder_message}
                            onChange={e => set('expiry_reminder_message', e.target.value)}
                            helperText="Placeholders: {name}, {id}, {expiry}, {days}"
                        />

                        <FormControlLabel
                            sx={{ mt: 2 }}
                            control={
                                <Switch
                                    checked={settings.renewal_receipt_enabled}
                                    onChange={e => set('renewal_receipt_enabled', e.target.checked)}
                                />
                            }
                            label="Email a receipt when a membership is renewed"
                        />

                        <Box mt={2}>
                            <Button variant="contained" startIcon={<Save />} onClick={handleSave} disabled={saving}>
                                {saving ? 'Saving…' : 'Save Settings'}
                            </Button>
                        </Box>
                    </Paper>
                </Grid>

                {/* Expiring members */}
                <Grid item xs={12} lg={7}>
                    <Paper sx={{ p: 3 }}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
                            <Stack direction="row" alignItems="center" gap={1}>
                                <HourglassBottom sx={{ color: 'warning.main' }} />
                                <Typography variant="h6">Expiring Soon</Typography>
                                <Chip size="small" label={`${expiring.members.length} within ${expiring.days}d`} variant="outlined" />
                            </Stack>
                            <Button
                                variant="outlined" startIcon={<Send />}
                                onClick={sendAll} disabled={sending || expiring.members.length === 0}
                            >
                                Send Reminders to All
                            </Button>
                        </Stack>

                        {expiring.members.length === 0 ? (
                            <Typography variant="body2" color="text.secondary">
                                No memberships expiring in the next {expiring.days} days. 🎉
                            </Typography>
                        ) : (
                            <TableContainer>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Member</TableCell>
                                            <TableCell>Expiry</TableCell>
                                            <TableCell>Contacts</TableCell>
                                            <TableCell align="right">Actions</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {expiring.members.map(m => {
                                            const d = daysLeft(m.membership_expiry);
                                            return (
                                                <TableRow key={m.id}>
                                                    <TableCell>
                                                        <Typography variant="body2" fontWeight={600}>{m.name}</Typography>
                                                        <Typography variant="caption" color="text.secondary">ID {m.member_code}</Typography>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Stack direction="row" alignItems="center" spacing={1}>
                                                            <Typography variant="body2">{m.membership_expiry}</Typography>
                                                            <Chip
                                                                size="small"
                                                                label={d === 0 ? 'Today' : `${d}d left`}
                                                                color={d <= 3 ? 'error' : 'warning'}
                                                                variant="outlined"
                                                                sx={{ height: 20, fontSize: 11 }}
                                                            />
                                                        </Stack>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Typography variant="caption" display="block">
                                                            📧 {m.channels_available?.email ? m.email : '—'}
                                                        </Typography>
                                                        <Typography variant="caption" display="block">
                                                            💬 {m.channels_available?.whatsapp ? m.phone : '—'}
                                                        </Typography>
                                                    </TableCell>
                                                    <TableCell align="right">
                                                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                                                            {m.reminder_sent && (
                                                                <Chip size="small" label="Sent" color="success" variant="outlined" sx={{ height: 22 }} />
                                                            )}
                                                            <Button size="small" startIcon={<Send />} onClick={() => sendOne(m)} disabled={sending}>
                                                                Send now
                                                            </Button>
                                                        </Stack>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </Paper>
                </Grid>

                {/* Log */}
                <Grid item xs={12}>
                    <Paper sx={{ p: 3 }}>
                        <Stack direction="row" alignItems="center" gap={1} mb={2}>
                            <History sx={{ color: 'text.secondary' }} />
                            <Typography variant="h6">Message History</Typography>
                        </Stack>
                        {messageLog.length === 0 ? (
                            <Typography variant="body2" color="text.secondary">No automated messages sent yet.</Typography>
                        ) : (
                            <TableContainer>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Member</TableCell>
                                            <TableCell>Type</TableCell>
                                            <TableCell>Channel</TableCell>
                                            <TableCell>Recipient</TableCell>
                                            <TableCell>Status</TableCell>
                                            <TableCell>Sent at</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {messageLog.map(l => (
                                            <TableRow key={l.id}>
                                                <TableCell>{l.member_name || `Member #${l.member_id}`}</TableCell>
                                                <TableCell>{l.kind === 'expiry_reminder' ? 'Expiry reminder' : 'Renewal receipt'}</TableCell>
                                                <TableCell>{l.channel}</TableCell>
                                                <TableCell sx={{ maxWidth: 220, wordBreak: 'break-all' }}>{l.recipient || '—'}</TableCell>
                                                <TableCell>
                                                    <Chip
                                                        size="small"
                                                        label={l.status}
                                                        color={l.status === 'failed' ? 'error' : l.status === 'console' ? 'warning' : 'success'}
                                                        variant="outlined"
                                                    />
                                                </TableCell>
                                                <TableCell>{new Date(l.created_at).toLocaleString()}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </Paper>
                </Grid>
            </Grid>
        </Box>
    );
};

export default NotificationsPage;
