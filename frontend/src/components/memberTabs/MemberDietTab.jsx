// frontend/src/components/memberTabs/MemberDietTab.jsx
import React, { useEffect, useState } from 'react';
import {
    Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    TextField, Button, IconButton, Box
} from '@mui/material';
import Alerts from '../Alerts';
import { Add, Delete } from '@mui/icons-material';
import api from '../../api';
import { log, logError } from '../../logger';

const MEALS = ['Breakfast', 'Lunch', 'Snacks', 'Dinner', 'Supplements', 'Other'];

const emptyForm = { meal: 'Breakfast', food_item: '', calories: '', protein_g: '', carbs_g: '', fats_g: '', notes: '' };

const MemberDietTab = ({ memberId }) => {
    const [rows, setRows] = useState([]);
    const [form, setForm] = useState(emptyForm);
    const [error, setError] = useState('');

    const fetchRows = async () => {
        if (!memberId) return;
        try {
            const res = await api.get('/diet', { params: { member_id: memberId } });
            setRows(res.data);
            setError('');
        } catch (err) {
            logError('MemberDietTab', 'fetchRows', `✗ failed for member ${memberId}: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to load the diet plan.');
        }
    };

    useEffect(() => { fetchRows(); }, [memberId]);

    const handleAdd = async () => {
        if (!form.food_item.trim()) {
            setError('Food item is required.');
            return;
        }
        log('MemberDietTab', 'handleAdd', `→ add diet item member=${memberId} meal=${form.meal} item="${form.food_item}"`);
        try {
            await api.post('/diet', {
                member_id: memberId,
                meal: form.meal,
                food_item: form.food_item,
                calories: form.calories || null,
                protein_g: form.protein_g || null,
                carbs_g: form.carbs_g || null,
                fats_g: form.fats_g || null,
                notes: form.notes || null,
            });
            setError('');
            setForm(emptyForm);
            fetchRows();
        } catch (err) {
            logError('MemberDietTab', 'handleAdd', `✗ failed for member ${memberId}: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to add diet item.');
        }
    };

    const handleDelete = async (id) => {
        log('MemberDietTab', 'handleDelete', `→ delete diet item id=${id} member=${memberId}`);
        try {
            await api.delete(`/diet/${id}`);
            fetchRows();
        } catch (err) {
            logError('MemberDietTab', 'handleDelete', `✗ failed for item ${id}: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to delete the diet item.');
        }
    };

    const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

    const totals = rows.reduce((acc, r) => ({
        calories: acc.calories + (Number(r.calories) || 0),
        protein: acc.protein + (Number(r.protein_g) || 0),
        carbs: acc.carbs + (Number(r.carbs_g) || 0),
        fats: acc.fats + (Number(r.fats_g) || 0),
    }), { calories: 0, protein: 0, carbs: 0, fats: 0 });

    return (
        <Box>
            <Alerts sx={{ mb: 1 }} items={[error && { severity: 'error', text: error }]} />
            <Box display="flex" gap={1} flexWrap="wrap" mb={1} alignItems="center">
                <TextField select name="meal" value={form.meal} onChange={handleChange} label="Meal" size="small" sx={{ minWidth: 130 }}>
                    {MEALS.map(m => <option key={m} value={m}>{m}</option>)}
                </TextField>
                <TextField name="food_item" value={form.food_item} onChange={handleChange} label="Food item" size="small" />
                <TextField name="calories" value={form.calories} onChange={handleChange} label="Calories" size="small" type="number" sx={{ width: 100 }} />
                <TextField name="protein_g" value={form.protein_g} onChange={handleChange} label="Protein (g)" size="small" type="number" sx={{ width: 100 }} />
                <Button variant="contained" startIcon={<Add />} onClick={handleAdd} size="small">Add</Button>
            </Box>

            <Typography variant="caption" display="block" mb={1} color="text.secondary">
                Daily totals — {totals.calories} kcal | P {totals.protein}g | C {totals.carbs}g | F {totals.fats}g
            </Typography>

            <TableContainer>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Meal</TableCell>
                            <TableCell>Food item</TableCell>
                            <TableCell>Calories</TableCell>
                            <TableCell>Protein</TableCell>
                            <TableCell align="right"></TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.map(r => (
                            <TableRow key={r.id}>
                                <TableCell>{r.meal || '—'}</TableCell>
                                <TableCell>{r.food_item}</TableCell>
                                <TableCell>{r.calories ?? '—'}</TableCell>
                                <TableCell>{r.protein_g ? `${r.protein_g}g` : '—'}</TableCell>
                                <TableCell align="right">
                                    <IconButton size="small" color="error" onClick={() => handleDelete(r.id)} title="Delete">
                                        <Delete fontSize="small" />
                                    </IconButton>
                                </TableCell>
                            </TableRow>
                        ))}
                        {rows.length === 0 && (
                            <TableRow><TableCell colSpan={5} align="center">No diet plan yet.</TableCell></TableRow>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
};

export default MemberDietTab;
