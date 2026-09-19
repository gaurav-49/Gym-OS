import React, { useEffect, useState } from 'react';
import api from '../api';
import {
    log, logError } from '../logger';
import {
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Button, Typography, Box, Chip, TextField, MenuItem, Stack, InputAdornment, Avatar, Pagination
} from '@mui/material';
import Alerts from './Alerts';
import { fmtDate } from './ui';
import { Search,
} from '@mui/icons-material';

const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const initialsOf = (name) => (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

const AttendanceList = () => {
    const [records, setRecords] = useState([]);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [sourceFilter, setSourceFilter] = useState('');
    const [page, setPage] = useState(1);
    const [loadError, setLoadError] = useState('');
    const recordsPerPage = 10;

    useEffect(() => {
        fetchRecords();
    }, []);

    const fetchRecords = async () => {
        try {
            log('AttendanceList', 'fetchRecords', '→ loading attendance records');
            const res = await api.get('/attendance');
            setRecords(res.data);
            setLoadError('');
        } catch (error) {
            logError('AttendanceList', 'fetchRecords', `✗ failed: ${error.response?.data?.error || error.message}`, error);
            setLoadError(error.response?.data?.error || 'Failed to load attendance records.');
        }
    };

    const today = todayStr();
    const todayCount = records.filter(r => r.date === today).length;

    const filtered = records.filter(r => {
        const q = search.trim().toLowerCase();
        const matchQ = !q || r.member_name.toLowerCase().includes(q) || String(r.member_id).includes(q);
        const matchStatus = !statusFilter || r.status === statusFilter;
        const matchSource = !sourceFilter || r.source === sourceFilter;
        return matchQ && matchStatus && matchSource;
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / recordsPerPage));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * recordsPerPage;
    const currentRows = filtered.slice(start, start + recordsPerPage);

    return (
        <Paper elevation={3} sx={{ p: 3 }}>
            <Alerts items={[loadError && { severity: 'error', text: loadError }]} />
            <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1} mb={2}>
                <Typography variant="h6">Attendance Records</Typography>
                <Stack direction="row" spacing={1}>
                    <Chip size="small" label={`${records.length} total`} variant="outlined" />
                    <Chip size="small" label={`${todayCount} today`} color="primary" variant="outlined" />
                </Stack>
            </Box>

            {/* Filters */}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} mb={2}>
                <TextField
                    placeholder="Search member name or ID…" size="small" value={search}
                    onChange={e => { setSearch(e.target.value); setPage(1); }}
                    sx={{ minWidth: 240, flexGrow: 1 }}
                    InputProps={{
                        startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment>,
                    }}
                />
                <TextField select size="small" label="Status" value={statusFilter}
                    onChange={e => { setStatusFilter(e.target.value); setPage(1); }} sx={{ minWidth: 140 }}>
                    <MenuItem value=""><em>All</em></MenuItem>
                    <MenuItem value="Present">Present</MenuItem>
                    <MenuItem value="Absent">Absent</MenuItem>
                </TextField>
                <TextField select size="small" label="Source" value={sourceFilter}
                    onChange={e => { setSourceFilter(e.target.value); setPage(1); }} sx={{ minWidth: 160 }}>
                    <MenuItem value=""><em>All</em></MenuItem>
                    <MenuItem value="manual">Manual</MenuItem>
                    <MenuItem value="device">Fingerprint</MenuItem>
                    <MenuItem value="qr">QR code</MenuItem>
                </TextField>
            </Stack>

            <TableContainer>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Member</TableCell>
                            <TableCell>Date</TableCell>
                            <TableCell>Time</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell>Source</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {currentRows.map(r => {
                            const isToday = r.date === today;
                            return (
                                <TableRow key={r.id}>
                                    <TableCell>
                                        <Box display="flex" alignItems="center" gap={1.5}>
                                            <Avatar sx={{ bgcolor: 'success.softBg', color: 'success.dark', width: 30, height: 30, fontSize: 12, fontWeight: 700 }}>
                                                {initialsOf(r.member_name)}
                                            </Avatar>
                                            <Box>
                                                <Typography variant="body2" fontWeight={600}>{r.member_name}</Typography>
                                                <Typography variant="caption" color="text.secondary">ID {r.member_id}</Typography>
                                            </Box>
                                        </Box>
                                    </TableCell>
                                    <TableCell>
                                        <Box display="flex" alignItems="center" gap={1}>
                                            {fmtDate(r.date)}
                                            {isToday && <Chip size="small" label="Today" color="primary" variant="outlined" sx={{ height: 20, fontSize: 11 }} />}
                                        </Box>
                                    </TableCell>
                                    <TableCell>{r.time}</TableCell>
                                    <TableCell>
                                        <Chip
                                            size="small"
                                            label={r.status}
                                            sx={{
                                                // Was #d1fae5 / #fee2e2 with paper-mixed ink on top.
                                                // Readable, but a pastel badge glowing on a dark page.
                                                bgcolor: r.status === 'Present' ? 'success.softBg' : 'error.softBg',
                                                color: r.status === 'Present' ? 'success.dark' : 'error.dark',
                                                fontWeight: 700,
                                            }}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            size="small"
                                            label={r.source === 'device' ? 'Fingerprint' : r.source === 'qr' ? 'QR' : 'Manual'}
                                            color={r.source === 'device' ? 'primary' : r.source === 'qr' ? 'secondary' : 'default'}
                                            variant="outlined"
                                        />
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                        {currentRows.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={5} align="center">
                                    {records.length === 0 ? 'No attendance records yet.' : 'No records match your filters.'}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            <Stack direction="row" justifyContent="space-between" alignItems="center" mt={2}>
                <Typography variant="body2" color="text.secondary">
                    Showing {filtered.length === 0 ? 0 : start + 1}–{Math.min(start + recordsPerPage, filtered.length)} of {filtered.length}
                </Typography>
                <Pagination
                    count={totalPages}
                    page={safePage}
                    onChange={(e, v) => setPage(v)}
                    color="primary"
                    size="small"
                />
            </Stack>
        </Paper>
    );
};

export default AttendanceList;
