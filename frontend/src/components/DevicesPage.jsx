// frontend/src/components/DevicesPage.jsx

import React, { useEffect, useState } from 'react';
import api from '../api';
import {
    log, logError } from '../logger';
import {
    Paper, Typography, TextField, Button, Table, TableBody, TableCell, GridLegacy as Grid, TableContainer, TableHead, TableRow, Dialog, DialogTitle, DialogContent, DialogActions, MenuItem, Alert, Chip, IconButton, Box, Switch, FormControlLabel
} from '@mui/material';
import Alerts from './Alerts';
import { useConfirm, useToast } from './ui';
import { Add, Edit, Delete, Fingerprint,
} from '@mui/icons-material';

// The name starts blank. Pre-filling it with the model number meant an empty
// form still had a name, so "Add Device" on an untouched dialog created a
// nameless terminal pointing at nothing — and a second one looked identical.
const emptyDevice = { name: '', ip_address: '', port: 80, is_active: true };

/** Dotted quad. A terminal sits on the gym's LAN, so this is exact, not a hostname. */
const IPV4 = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

const DevicesPage = () => {
    const toast = useToast();
    const [devices, setDevices] = useState([]);
    const [members, setMembers] = useState([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(emptyDevice);
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState('');

    // Test punch state
    const [punchOpen, setPunchOpen] = useState(false);
    const [punchDevice, setPunchDevice] = useState('');
    const [punchMember, setPunchMember] = useState('');
    const [punchCardUid, setPunchCardUid] = useState('');
    const [punchResult, setPunchResult] = useState(null); // { ok: bool, text: string }

    const fetchDevices = async () => {
        try {
            const res = await api.get('/devices');
            setDevices(res.data);
            setLoadError('');
        } catch (err) {
            logError('DevicesPage', 'fetchDevices', `✗ failed: ${err.response?.data?.error || err.message}`, err);
            setLoadError(err.response?.data?.error || 'Failed to load devices.');
        }
    };

    const fetchMembers = async () => {
        try {
            const res = await api.get('/clients');
            setMembers(res.data.filter(c => c.status === 'active'));
        } catch (err) {
            console.error('Error fetching members:', err);
        }
    };

    useEffect(() => {
        fetchDevices();
        fetchMembers();
    }, []);

    const openCreate = () => {
        setEditing(null);
        setForm(emptyDevice);
        toast.success('');
        setError('');
        setDialogOpen(true);
    };

    const openEdit = (device) => {
        setEditing(device);
        setForm({
            name: device.name || 'eSSL X990',
            ip_address: device.ip_address || '',
            port: device.port || 80,
            is_active: device.is_active,
        });
        toast.success('');
        setError('');
        setDialogOpen(true);
    };

    const handleFormChange = (e) => {
        const { name, value } = e.target;
        setForm({ ...form, [name]: value });
    };

    const handleSave = async () => {
        const port = Number(form.port);
        if (!form.name.trim()) {
            log('DevicesPage', 'handleSave', '→ validation: no device name');
            setError('Give the device a name — it is how staff tell two terminals apart.');
            return;
        }
        if (!form.ip_address.trim()) {
            log('DevicesPage', 'handleSave', '→ validation: no IP address');
            setError("The device's IP address is required — without it nothing can reach the terminal.");
            return;
        }
        // "999.1.1" passed the old digits-and-dots check and reached the
        // database as an address that can never answer.
        if (!IPV4.test(form.ip_address.trim())) {
            log('DevicesPage', 'handleSave', `→ validation: bad IP "${form.ip_address}"`);
            setError(`"${form.ip_address}" is not a valid IP address. Use the terminal's LAN address, like 192.168.1.50.`);
            return;
        }
        if (!form.port || isNaN(port) || port < 1 || port > 65535) {
            log('DevicesPage', 'handleSave', `→ validation: bad port "${form.port}"`);
            setError('Port must be between 1 and 65535.');
            return;
        }
        log('DevicesPage', 'handleSave', `→ ${editing ? 'update' : 'create'} device name="${form.name}" ip=${form.ip_address} port=${form.port}`);
        try {
            if (editing) {
                await api.put(`/devices/${editing.id}`, form);
            } else {
                await api.post('/devices', form);
            }
            setDialogOpen(false);
            toast.success(editing ? 'Device updated.' : 'Device added.');
            setError('');
            fetchDevices();
        } catch (err) {
            logError('DevicesPage', 'handleSave', `✗ save failed: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to save device.');
        }
    };

    const confirm = useConfirm();

    const handleDelete = async (device) => {
        if (!await confirm({
            title: `Delete ${device.name}?`,
            body: <>Punches already pulled from it are kept, but the terminal stops syncing until it is added again.</>,
            confirmLabel: 'Delete device', danger: true,
        })) return;
        log('DevicesPage', 'handleDelete', `→ delete device id=${device.id} name="${device.name}"`);
        try {
            await api.delete(`/devices/${device.id}`);
            toast.success(`Device "${device.name}" deleted.`);
            setError('');
            fetchDevices();
        } catch (err) {
            logError('DevicesPage', 'handleDelete', `✗ delete failed for device ${device?.id}: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to delete device.');
        }
    };

    const openTestPunch = () => {
        setPunchDevice('');
        setPunchMember('');
        setPunchCardUid('');
        setPunchResult(null);
        setPunchOpen(true);
    };

    const sendTestPunch = async () => {
        if (!punchDevice) {
            setPunchResult({ ok: false, text: 'Select a device.' });
            return;
        }
        if (!punchMember && !punchCardUid.trim()) {
            setPunchResult({ ok: false, text: 'Select a member (fingerprint) or enter a card UID (card punch).' });
            return;
        }
        try {
            const body = { device_id: punchDevice };
            if (punchCardUid.trim()) {
                body.card_uid = punchCardUid.trim();
            } else {
                body.member_id = punchMember;
            }
            log('DevicesPage', 'sendTestPunch', `→ punch via ${punchCardUid.trim() ? 'card' : 'fingerprint'}`, { ...body, via: punchCardUid.trim() ? 'card' : 'fingerprint' });
            const res = await api.post('/device/punch', body);
            log('DevicesPage', 'sendTestPunch', `← ok: ${res.data.message}`);
            setPunchResult({ ok: true, text: res.data.message });
        } catch (err) {
            const data = err.response?.data;
            logError('DevicesPage', 'sendTestPunch', `✗ punch failed (${err.response?.status}): ${data?.message || data?.error || err.message}`, err);
            setPunchResult({ ok: false, text: data?.message || data?.error || 'Punch failed.' });
        }
    };

    return (
        <Paper elevation={3} sx={{ p: 3 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" gap={1}>
                <Box display="flex" alignItems="center" gap={1}>
                    <Fingerprint sx={{ color: 'primary.main' }} />
                    <Typography variant="h6">Biometric Devices</Typography>
                </Box>
                <Box>
                    <Button
                        variant="outlined"
                        startIcon={<Fingerprint />}
                        onClick={openTestPunch}
                        sx={{ mr: 1 }}
                    >
                        Test Punch
                    </Button>
                    <Button variant="contained" startIcon={<Add />} onClick={openCreate}>
                        Add Device
                    </Button>
                </Box>
            </Box>

            <Alert severity="info" sx={{ mb: 2 }}>
                When a member scans their fingerprint, the eSSL X990 sends the punched ID to{' '}
                <strong>POST /api/device/punch</strong>; a card reader sends the member's{' '}
                <strong>card UID</strong> instead. Enter the device's IP here so the backend knows
                which terminal punches come from. Both go through the same gate rules.
            </Alert>

            <Alerts items={[
                error && { severity: 'error', text: error },
                loadError && { severity: 'error', text: loadError },
            ]} />

            <TableContainer>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Name</TableCell>
                            <TableCell>IP Address</TableCell>
                            <TableCell>Port</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {devices.map(d => (
                            <TableRow key={d.id}>
                                <TableCell>{d.name}</TableCell>
                                <TableCell>{d.ip_address || '—'}</TableCell>
                                <TableCell>{d.port}</TableCell>
                                <TableCell>
                                    <Chip
                                        size="small"
                                        label={d.is_active ? 'Active' : 'Inactive'}
                                        color={d.is_active ? 'success' : 'default'}
                                    />
                                </TableCell>
                                <TableCell align="right">
                                    <IconButton onClick={() => openEdit(d)} title="Edit">
                                        <Edit />
                                    </IconButton>
                                    <IconButton onClick={() => handleDelete(d)} title="Delete" color="error">
                                        <Delete />
                                    </IconButton>
                                </TableCell>
                            </TableRow>
                        ))}
                        {devices.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={5} align="center">
                                    No devices configured yet.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            {/* Add / Edit device */}
            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>{editing ? `Edit Device — ${editing.name}` : 'Add Device'}</DialogTitle>
                <DialogContent>
                    <Alerts items={[error && { severity: 'error', text: error }]} />
                    <Grid container spacing={2} sx={{ mt: 0.5 }}>
                        <Grid item xs={12} sm={8}>
                            <TextField fullWidth required label="Device Name" name="name" value={form.name}
                                onChange={handleFormChange} placeholder="e.g. Front desk eSSL X990"
                                error={!!error && !form.name.trim()} />
                        </Grid>
                        <Grid item xs={12} sm={4}>
                            <TextField fullWidth type="number" label="Port" name="port" value={form.port} onChange={handleFormChange} />
                        </Grid>
                        <Grid item xs={12}>
                            <TextField fullWidth required label="IP Address" name="ip_address"
                                value={form.ip_address} onChange={handleFormChange}
                                placeholder="192.168.1.100"
                                error={!!error && !IPV4.test(form.ip_address.trim())}
                                helperText="The terminal's address on the gym network." />
                        </Grid>
                        <Grid item xs={12}>
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={form.is_active}
                                        onChange={e => setForm({ ...form, is_active: e.target.checked })}
                                    />
                                }
                                label="Active"
                            />
                        </Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleSave}>
                        {editing ? 'Save Changes' : 'Add Device'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Test punch */}
            <Dialog open={punchOpen} onClose={() => setPunchOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Test Fingerprint Punch</DialogTitle>
                <DialogContent>
                    <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <TextField
                            select fullWidth label="Device"
                            value={punchDevice}
                            onChange={e => setPunchDevice(e.target.value)}
                        >
                            {devices.map(d => (
                                <MenuItem key={d.id} value={d.id}>
                                    {d.name} {d.ip_address ? `(${d.ip_address})` : ''}
                                </MenuItem>
                            ))}
                        </TextField>
                        <TextField
                            select fullWidth label="Member (fingerprint punch)"
                            value={punchMember}
                            onChange={e => setPunchMember(e.target.value)}
                        >
                            {members.map(m => (
                                <MenuItem key={m.id} value={m.member_code}>
                                    {m.name.toUpperCase()} (ID {m.member_code})
                                    {m.fingerprint_status === 'enrolled' ? ' — FP ✓' : m.fingerprint_status === 'pending' ? ' — FP pending' : ''}
                                    {m.card_uid ? ' — Card ✓' : ''}
                                </MenuItem>
                            ))}
                        </TextField>
                        <Typography variant="caption" color="text.secondary">or</Typography>
                        <TextField
                            fullWidth label="Card UID (card punch)"
                            value={punchCardUid}
                            onChange={e => setPunchCardUid(e.target.value)}
                            placeholder="e.g. 0012345678 — swipes like the card reader"
                        />
                        {punchResult && (
                            <Alert severity={punchResult.ok ? 'success' : 'error'}>
                                {punchResult.text}
                            </Alert>
                        )}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPunchOpen(false)}>Close</Button>
                    <Button variant="contained" startIcon={<Fingerprint />} onClick={sendTestPunch}>
                        Send Punch
                    </Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
};

export default DevicesPage;
