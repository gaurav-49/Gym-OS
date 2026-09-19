// frontend/src/components/ReportsPage.jsx
import React, { useEffect, useState } from 'react';
import {
    Paper, Typography, TextField, Button, MenuItem, GridLegacy as Grid, Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip
} from '@mui/material';
import Alerts from './Alerts';
import { BarChart, FilterAlt, SearchOff,
} from '@mui/icons-material';
import api from '../api';
import { log, logError } from '../logger';
import { fmtDate } from './ui';
import EmptyState from './ui/EmptyState';

const emptyFilters = { from: '', to: '', member_id: '', status: '', source: '' };

const ReportsPage = () => {
    const [members, setMembers] = useState([]);
    const [filters, setFilters] = useState(emptyFilters);
    const [rows, setRows] = useState([]);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        api.get('/clients').then(res => setMembers(res.data)).catch(err => console.error(err));
    }, []);

    const fetchReport = async (nextFilters = filters) => {
        setError('');
        log('ReportsPage', 'fetchReport', '→ load report', nextFilters);
        try {
            const params = Object.fromEntries(
                Object.entries(nextFilters).filter(([, v]) => v !== '')
            );
            const res = await api.get('/attendance/report', { params });
            setRows(res.data);
            setLoaded(true);
            log('ReportsPage', 'fetchReport', `← ${res.data.length} rows`);
        } catch (err) {
            logError('ReportsPage', 'fetchReport', `✗ failed: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to load the report.');
        }
    };

    const handleChange = (e) => {
        const next = { ...filters, [e.target.name]: e.target.value };
        setFilters(next);
    };

    const exportCsv = () => {
        const header = 'ID,Member ID,Member Name,Date,Time,Status,Source';
        const lines = rows.map(r =>
            [r.id, r.member_id, `"${r.member_name}"`, r.date, r.time, r.status, r.source].join(',')
        );
        const csv = [header, ...lines].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const now = new Date();
        const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        a.download = `attendance-report-${todayLocal}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <Paper elevation={3} sx={{ p: 3 }}>
            <Alerts items={[error && { severity: 'error', text: error }]} />
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
                <Box display="flex" alignItems="center" gap={1}>
                    <BarChart sx={{ color: 'primary.main' }} />
                    <Typography variant="h6">Attendance Reports</Typography>
                </Box>
                <Button variant="contained" onClick={exportCsv} disabled={rows.length === 0}>
                    Export CSV
                </Button>
            </Box>

            <Grid container spacing={2} mb={2} alignItems="center">
                <Grid item xs={6} sm={2}>
                    <TextField fullWidth type="date" label="From" name="from" value={filters.from}
                        onChange={handleChange} InputLabelProps={{ shrink: true }} />
                </Grid>
                <Grid item xs={6} sm={2}>
                    <TextField fullWidth type="date" label="To" name="to" value={filters.to}
                        onChange={handleChange} InputLabelProps={{ shrink: true }} />
                </Grid>
                <Grid item xs={6} sm={3}>
                    <TextField select fullWidth label="Member" name="member_id" value={filters.member_id} onChange={handleChange}>
                        <MenuItem value=""><em>All</em></MenuItem>
                        {members.map(m => (
                            <MenuItem key={m.id} value={m.id}>{m.name} (ID {m.id})</MenuItem>
                        ))}
                    </TextField>
                </Grid>
                <Grid item xs={6} sm={2}>
                    <TextField select fullWidth label="Status" name="status" value={filters.status} onChange={handleChange}>
                        <MenuItem value=""><em>All</em></MenuItem>
                        <MenuItem value="Present">Present</MenuItem>
                        <MenuItem value="Absent">Absent</MenuItem>
                    </TextField>
                </Grid>
                <Grid item xs={6} sm={2}>
                    <TextField select fullWidth label="Source" name="source" value={filters.source} onChange={handleChange}>
                        <MenuItem value=""><em>All</em></MenuItem>
                        <MenuItem value="manual">Manual</MenuItem>
                        <MenuItem value="device">Device</MenuItem>
                    </TextField>
                </Grid>
                <Grid item xs={6} sm={1}>
                    <Button
                        variant="contained"
                        fullWidth
                        startIcon={<FilterAlt />}
                        onClick={() => fetchReport()}
                    >
                        Filter
                    </Button>
                </Grid>
            </Grid>

            <TableContainer>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Member ID</TableCell>
                            <TableCell>Member Name</TableCell>
                            <TableCell>Date</TableCell>
                            <TableCell>Time</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell>Source</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.map(r => (
                            <TableRow key={r.id}>
                                <TableCell>{r.member_id}</TableCell>
                                <TableCell>{r.member_name}</TableCell>
                                <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</TableCell>
                                <TableCell>{r.time}</TableCell>
                                <TableCell>{r.status}</TableCell>
                                <TableCell>
                                    <Chip size="small" label={r.source} variant="outlined" />
                                </TableCell>
                            </TableRow>
                        ))}
                        {rows.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={6} sx={{ border: 0, p: 0 }}>
                                    {loaded ? (
                                        <EmptyState
                                            icon={SearchOff}
                                            title="No records match those filters"
                                            hint="Try a wider date range, or clear the member, status and source filters."
                                        />
                                    ) : (
                                        <EmptyState
                                            icon={BarChart}
                                            title="Choose a range and press Filter"
                                            hint="Leave the dates empty to report on everything, or narrow to one member to see their attendance history."
                                        />
                                    )}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>
        </Paper>
    );
};

export default ReportsPage;
