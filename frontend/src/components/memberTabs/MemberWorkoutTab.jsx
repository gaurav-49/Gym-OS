// frontend/src/components/memberTabs/MemberWorkoutTab.jsx
import React, { useEffect, useState } from 'react';
import {
    Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    TextField, Button, IconButton, Box
} from '@mui/material';
import Alerts from '../Alerts';
import { Add, Delete } from '@mui/icons-material';
import api from '../../api';
import { log, logError } from '../../logger';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Custom'];

const emptyForm = { day: 'Monday', exercise: '', sets: '', reps: '', weight: '', rest_seconds: '', notes: '' };

const MemberWorkoutTab = ({ memberId }) => {
    const [rows, setRows] = useState([]);
    const [form, setForm] = useState(emptyForm);
    const [error, setError] = useState('');

    const fetchRows = async () => {
        if (!memberId) return;
        try {
            log('MemberWorkoutTab', 'fetchRows', `→ load workouts for member ${memberId}`);
            const res = await api.get('/workouts', { params: { member_id: memberId } });
            setRows(res.data);
            setError('');
        } catch (err) {
            logError('MemberWorkoutTab', 'fetchRows', `✗ failed for member ${memberId}: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to load the workout plan.');
        }
    };

    useEffect(() => { fetchRows(); }, [memberId]);

    const handleAdd = async () => {
        if (!form.exercise.trim()) {
            setError('Exercise name is required.');
            return;
        }
        log('MemberWorkoutTab', 'handleAdd', `→ add exercise member=${memberId} day=${form.day} exercise="${form.exercise}"`);
        try {
            await api.post('/workouts', {
                member_id: memberId,
                day: form.day,
                exercise: form.exercise,
                sets: form.sets || null,
                reps: form.reps || null,
                weight: form.weight || null,
                rest_seconds: form.rest_seconds || null,
                notes: form.notes || null,
            });
            setError('');
            setForm(emptyForm);
            fetchRows();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to add exercise.');
        }
    };

    const handleDelete = async (id) => {
        log('MemberWorkoutTab', 'handleDelete', `→ delete exercise id=${id} member=${memberId}`);
        try {
            await api.delete(`/workouts/${id}`);
            fetchRows();
        } catch (err) {
            logError('MemberWorkoutTab', 'handleDelete', `✗ failed for exercise ${id}: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to delete the exercise.');
        }
    };

    const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

    return (
        <Box>
            <Alerts sx={{ mb: 1 }} items={[error && { severity: 'error', text: error }]} />
            <Box display="flex" gap={1} flexWrap="wrap" mb={2} alignItems="center">
                <TextField select name="day" value={form.day} onChange={handleChange} label="Day" size="small" sx={{ minWidth: 130 }}>
                    {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                </TextField>
                <TextField name="exercise" value={form.exercise} onChange={handleChange} label="Exercise" size="small" />
                <TextField name="sets" value={form.sets} onChange={handleChange} label="Sets" size="small" type="number" sx={{ width: 80 }} />
                <TextField name="reps" value={form.reps} onChange={handleChange} label="Reps" size="small" type="number" sx={{ width: 80 }} />
                <TextField name="weight" value={form.weight} onChange={handleChange} label="Weight (kg)" size="small" type="number" sx={{ width: 110 }} />
                <Button variant="contained" startIcon={<Add />} onClick={handleAdd} size="small">Add</Button>
            </Box>

            <TableContainer>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Day</TableCell>
                            <TableCell>Exercise</TableCell>
                            <TableCell>Sets</TableCell>
                            <TableCell>Reps</TableCell>
                            <TableCell>Weight</TableCell>
                            <TableCell>Rest</TableCell>
                            <TableCell align="right"></TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.map(r => (
                            <TableRow key={r.id}>
                                <TableCell>{r.day || '—'}</TableCell>
                                <TableCell>{r.exercise}</TableCell>
                                <TableCell>{r.sets ?? '—'}</TableCell>
                                <TableCell>{r.reps ?? '—'}</TableCell>
                                <TableCell>{r.weight ? `${r.weight} kg` : '—'}</TableCell>
                                <TableCell>{r.rest_seconds ? `${r.rest_seconds}s` : '—'}</TableCell>
                                <TableCell align="right">
                                    <IconButton size="small" color="error" onClick={() => handleDelete(r.id)} title="Delete">
                                        <Delete fontSize="small" />
                                    </IconButton>
                                </TableCell>
                            </TableRow>
                        ))}
                        {rows.length === 0 && (
                            <TableRow><TableCell colSpan={7} align="center">No workout plan yet.</TableCell></TableRow>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
};

export default MemberWorkoutTab;
