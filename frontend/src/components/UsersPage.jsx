// frontend/src/components/UsersPage.jsx
import React, { useEffect, useState } from 'react';
import {
    Paper, Typography, TextField, Button, MenuItem, GridLegacy as Grid, Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Dialog, DialogTitle, DialogContent, DialogActions, IconButton, Chip
} from '@mui/material';
import Alerts from './Alerts';
import { normaliseUsername, typedUsername, usernameError, usernameInputProps, displayUsername } from './ui/username';
import { Add, Delete, Edit,
} from '@mui/icons-material';
import api from '../api';
import { log, logError } from '../logger';
import { useConfirm, useToast, titleCaseOnBlur } from './ui';

const emptyForm = { username: '', password: '', name: '', role: 'trainer', email: '', phone: '' };

const UsersPage = ({ currentUser }) => {
    const toast = useToast();
    const [users, setUsers] = useState([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(emptyForm);
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState('');

    const fetchUsers = async () => {
        try {
            const res = await api.get('/users');
            setUsers(res.data);
            setLoadError('');
        } catch (err) {
            console.error('Error fetching users:', err);
            setLoadError(err.response?.data?.error || 'Failed to load users.');
        }
    };

    useEffect(() => { fetchUsers(); }, []);

    const openCreate = () => {
        setEditing(null);
        setForm(emptyForm);
        setError('');
        setDialogOpen(true);
    };

    const openEdit = (user) => {
        setEditing(user);
        setForm({
            username: displayUsername(user.username), password: '', name: user.name || '',
            role: user.role, email: user.email || '', phone: user.phone || '',
        });
        setError('');
        setDialogOpen(true);
    };

    const handleSave = async () => {
        if (editing) {
            if (form.password && form.password.length < 6) {
                log('UsersPage', 'handleSave', '→ validation: new password too short');
                setError('New password must be at least 6 characters.');
                return;
            }
            log('UsersPage', 'handleSave', `→ update user id=${editing.id} username="${form.username}" role=${form.role}`);
            try {
                const payload = {
                    name: form.name, role: form.role, email: form.email, phone: form.phone,
                    ...(form.password ? { password: form.password } : {}),
                };
                await api.put(`/users/${editing.id}`, payload);
                setDialogOpen(false);
                toast.success(`User "${form.username}" updated.`);
                setError('');
                fetchUsers();
            } catch (err) {
                logError('UsersPage', 'handleSave', `✗ update failed for user ${editing?.id}: ${err.response?.data?.error || err.message}`, err);
                setError(err.response?.data?.error || 'Failed to update user.');
                // A rejected password (too short, or one this account has used
                // before) is cleared rather than left legible on the admin's
                // screen — same rule as the login form.
                setForm(f => ({ ...f, password: '' }));
            }
            return;
        }
        if (!form.username || !form.password) {
            log('UsersPage', 'handleSave', '→ validation: username/password missing');
            setError('Username and password are required.');
            return;
        }
        const badUsername = usernameError(form.username);
        if (badUsername) {
            log('UsersPage', 'handleSave', `→ validation: ${badUsername}`);
            setError(badUsername);
            return;
        }
        if (form.password.length < 6) {
            log('UsersPage', 'handleSave', '→ validation: password too short');
            setError('The password must be at least 6 characters.');
            return;
        }
        log('UsersPage', 'handleSave', `→ create user username="${form.username}" role=${form.role}`);
        try {
            // The field now holds what was typed, so fold here rather than
            // relying on the server's own fold to be the only one.
            await api.post('/users', { ...form, username: normaliseUsername(form.username) });
            setDialogOpen(false);
            toast.success(`User "${form.username}" created.`);
            setError('');
            setForm(emptyForm);
            fetchUsers();
        } catch (err) {
            logError('UsersPage', 'handleSave', `✗ create failed for "${form?.username}": ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to create user.');
            setForm(f => ({ ...f, password: '' }));
        }
    };

    const confirm = useConfirm();

    const handleDelete = async (user) => {
        if (!await confirm({
            title: `Delete ${user.username}?`,
            body: <>They lose access immediately. Actions they already took stay in the audit log under their name.</>,
            confirmLabel: 'Delete user', danger: true,
        })) return;
        log('UsersPage', 'handleDelete', `→ delete user id=${user.id} username="${user.username}"`);
        try {
            await api.delete(`/users/${user.id}`);
            toast.success(`User "${user.username}" deleted.`);
            setError('');
            fetchUsers();
        } catch (err) {
            logError('UsersPage', 'handleDelete', `✗ delete failed for user ${user?.id}: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to delete user.');
        }
    };

    return (
        <Paper elevation={3} sx={{ p: 3 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Box>
                    <Typography variant="h6">Users & Roles</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Add email / phone so staff can reset forgotten passwords with an OTP.
                    </Typography>
                </Box>
                <Button variant="contained" startIcon={<Add />} onClick={openCreate}>
                    Add User
                </Button>
            </Box>

            <Alerts items={[
                error && { severity: 'error', text: error },
                loadError && { severity: 'error', text: loadError },
            ]} />

            <TableContainer>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Username</TableCell>
                            <TableCell>Name</TableCell>
                            <TableCell>Role</TableCell>
                            <TableCell>Email</TableCell>
                            <TableCell>Phone</TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {users.map(u => (
                            <TableRow key={u.id}>
                                <TableCell sx={{ fontWeight: 600 }}>{displayUsername(u.username)}{u.id === currentUser?.id ? ' (you)' : ''}</TableCell>
                                <TableCell>{u.name || '—'}</TableCell>
                                <TableCell>
                                    <Chip size="small" label={u.role} color={u.role === 'admin' ? 'primary' : 'default'} />
                                </TableCell>
                                <TableCell>{u.email || '—'}</TableCell>
                                <TableCell>{u.phone || '—'}</TableCell>
                                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                    <IconButton onClick={() => openEdit(u)} title="Edit" color="primary">
                                        <Edit />
                                    </IconButton>
                                    <IconButton
                                        onClick={() => handleDelete(u)}
                                        title="Delete"
                                        color="error"
                                        disabled={u.id === currentUser?.id}
                                    >
                                        <Delete />
                                    </IconButton>
                                </TableCell>
                            </TableRow>
                        ))}
                        {users.length === 0 && (
                            <TableRow><TableCell colSpan={6} align="center">No users yet.</TableCell></TableRow>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>{editing ? `Edit User — ${displayUsername(editing.username)}` : 'Add User'}</DialogTitle>
                <DialogContent>
                    <Alerts items={[error && { severity: 'error', text: error }]} />
                    <Grid container spacing={2} sx={{ mt: 0.5 }}>
                        <Grid item xs={12} sm={4}>
                            {/* Kept as typed, folded on blur — same reason as the
                                login field: a box that rewrites every keystroke
                                reads as Caps Lock. */}
                            <TextField fullWidth label="Username" value={form.username} disabled={!!editing}
                                onChange={e => setForm({ ...form, username: typedUsername(e.target.value) })}
                                onBlur={() => setForm(f => ({ ...f, username: normaliseUsername(f.username) }))}
                                inputProps={{ ...usernameInputProps, autoComplete: 'off' }}
                                error={!!form.username && !!usernameError(form.username)}
                                helperText={editing
                                    ? 'A username cannot be changed once it is in use.'
                                    : (form.username && usernameError(form.username))
                                        || 'Letters, numbers, dots and underscores.'} />
                        </Grid>
                        <Grid item xs={12} sm={8}>
                            <TextField fullWidth label="Full Name" name="name" value={form.name}
                                onChange={e => setForm({ ...form, name: e.target.value })}
                                onBlur={titleCaseOnBlur(setForm)} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                label={editing ? 'New Password (blank = keep)' : 'Password *'}
                                type="password"
                                value={form.password}
                                onChange={e => setForm({ ...form, password: e.target.value })}
                                helperText={editing ? 'Set a new password for this user.' : undefined}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField select fullWidth label="Role" value={form.role}
                                onChange={e => setForm({ ...form, role: e.target.value })}>
                                <MenuItem value="trainer">Trainer</MenuItem>
                                <MenuItem value="admin">Admin</MenuItem>
                            </TextField>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth type="email" label="Email (for OTP)" value={form.email}
                                onChange={e => setForm({ ...form, email: e.target.value })} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="Phone (for OTP)" value={form.phone}
                                onChange={e => setForm({ ...form, phone: e.target.value })} />
                        </Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleSave}>
                        {editing ? 'Save Changes' : 'Create User'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
};

export default UsersPage;
