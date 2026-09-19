// frontend/src/components/memberTabs/MemberProgressTab.jsx
import React, { useEffect, useState } from 'react';
import {
    Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    TextField, Button, IconButton, Box, Grid
} from '@mui/material';
import Alerts from '../Alerts';
import { Add, Delete } from '@mui/icons-material';
import api from '../../api';
import { log, logError } from '../../logger';

const emptyForm = { record_date: '', weight: '', body_fat: '', chest: '', waist: '', arms: '', thighs: '', shoulders: '', notes: '' };

const MemberProgressTab = ({ memberId }) => {
    const [rows, setRows] = useState([]);
    const [form, setForm] = useState(emptyForm);
    const [error, setError] = useState('');

    const fetchRows = async () => {
        if (!memberId) return;
        try {
            log('MemberProgressTab', 'fetchRows', `→ load progress for member ${memberId}`);
            const res = await api.get('/progress', { params: { member_id: memberId } });
            setRows(res.data);
            setError('');
        } catch (err) {
            logError('MemberProgressTab', 'fetchRows', `✗ failed for member ${memberId}: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to load progress records.');
        }
    };

    useEffect(() => { fetchRows(); }, [memberId]);

    const handleAdd = async () => {
        log('MemberProgressTab', 'handleAdd', `→ save measurement member=${memberId} weight=${form.weight || '-'} date=${form.record_date || '-'}`);
        try {
            await api.post('/progress', {
                member_id: memberId,
                record_date: form.record_date || null,
                weight: form.weight || null,
                body_fat: form.body_fat || null,
                chest: form.chest || null,
                waist: form.waist || null,
                arms: form.arms || null,
                thighs: form.thighs || null,
                shoulders: form.shoulders || null,
                notes: form.notes || null,
            });
            setError('');
            setForm(emptyForm);
            fetchRows();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to save measurement.');
        }
    };

    const handleDelete = async (id) => {
        log('MemberProgressTab', 'handleDelete', `→ delete record id=${id} member=${memberId}`);
        try {
            await api.delete(`/progress/${id}`);
            fetchRows();
        } catch (err) {
            logError('MemberProgressTab', 'handleDelete', `✗ failed for record ${id}: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to delete the record.');
        }
    };

    const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

    const latest = rows[0];

    return (
        <Box>
            <Alerts sx={{ mb: 1 }} items={[error && { severity: 'error', text: error }]} />
            <Grid container spacing={1} mb={2} alignItems="center">
                <Grid item xs={6} sm={3}>
                    <TextField fullWidth type="date" name="record_date" label="Date" value={form.record_date}
                        onChange={handleChange} size="small" InputLabelProps={{ shrink: true }} />
                </Grid>
                <Grid item xs={6} sm={3}><TextField fullWidth name="weight" label="Weight (kg)" value={form.weight} onChange={handleChange} size="small" type="number" /></Grid>
                <Grid item xs={6} sm={3}><TextField fullWidth name="body_fat" label="Body Fat %" value={form.body_fat} onChange={handleChange} size="small" type="number" /></Grid>
                <Grid item xs={6} sm={3}><TextField fullWidth name="chest" label="Chest (cm)" value={form.chest} onChange={handleChange} size="small" type="number" /></Grid>
                <Grid item xs={6} sm={3}><TextField fullWidth name="waist" label="Waist (cm)" value={form.waist} onChange={handleChange} size="small" type="number" /></Grid>
                <Grid item xs={6} sm={3}><TextField fullWidth name="arms" label="Arms (cm)" value={form.arms} onChange={handleChange} size="small" type="number" /></Grid>
                <Grid item xs={6} sm={3}><TextField fullWidth name="thighs" label="Thighs (cm)" value={form.thighs} onChange={handleChange} size="small" type="number" /></Grid>
                <Grid item xs={6} sm={3}><TextField fullWidth name="shoulders" label="Shoulders (cm)" value={form.shoulders} onChange={handleChange} size="small" type="number" /></Grid>
                <Grid item xs={9} sm={9}><TextField fullWidth name="notes" label="Notes" value={form.notes} onChange={handleChange} size="small" /></Grid>
                <Grid item xs={3} sm={3}>
                    <Button fullWidth variant="contained" startIcon={<Add />} onClick={handleAdd}>Save</Button>
                </Grid>
            </Grid>

            {latest && (
                <Typography variant="body2" sx={{ mb: 1 }}>
                    Latest ({latest.record_date}): <strong>{latest.weight ? `${latest.weight} kg` : '—'}</strong>
                    {latest.body_fat ? ` · ${latest.body_fat}% body fat` : ''}
                </Typography>
            )}

            <TableContainer>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Date</TableCell>
                            <TableCell>Weight</TableCell>
                            <TableCell>Fat %</TableCell>
                            <TableCell>Chest</TableCell>
                            <TableCell>Waist</TableCell>
                            <TableCell>Arms</TableCell>
                            <TableCell align="right"></TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.map(r => (
                            <TableRow key={r.id}>
                                <TableCell>{r.record_date}</TableCell>
                                <TableCell>{r.weight ?? '—'}</TableCell>
                                <TableCell>{r.body_fat ?? '—'}</TableCell>
                                <TableCell>{r.chest ?? '—'}</TableCell>
                                <TableCell>{r.waist ?? '—'}</TableCell>
                                <TableCell>{r.arms ?? '—'}</TableCell>
                                <TableCell align="right">
                                    <IconButton size="small" color="error" onClick={() => handleDelete(r.id)} title="Delete">
                                        <Delete fontSize="small" />
                                    </IconButton>
                                </TableCell>
                            </TableRow>
                        ))}
                        {rows.length === 0 && (
                            <TableRow><TableCell colSpan={7} align="center">No measurements recorded yet.</TableCell></TableRow>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
};

export default MemberProgressTab;
