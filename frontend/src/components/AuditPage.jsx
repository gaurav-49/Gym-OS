// frontend/src/components/AuditPage.jsx
// Staff action trail across every module. `membership_events` only ever covered
// member lifecycle actions; this shows who created, changed or deleted anything,
// anywhere — with the request id that ties a row to the backend logs.

import React, { useEffect, useState } from 'react';
import {
    Box, Paper, TextField, MenuItem, Chip, GridLegacy as Grid, TableCell, Typography, Tooltip, } from '@mui/material';
import { History, Person, Apps, DateRange, Today,
} from '@mui/icons-material';
import api from '../api';
import { logError } from '../logger';
import Alerts from './Alerts';
import { PageHeader, StatCards, ModuleTable, fmtDateTime } from './ui';

// One colour per verb so a page of rows is scannable at a glance.
const ACTION_COLOR = {
    create: 'success', update: 'info', delete: 'error', cancel: 'error',
    assign: 'primary', release: 'warning', sell: 'secondary', restock: 'primary',
    pay: 'success', mark: 'info', generate: 'secondary', session: 'primary',
};

const AuditPage = () => {
    const [rows, setRows] = useState([]);
    // Distinguishes "still loading" from "genuinely empty" — without it the
    // table showed its empty state on every page load.
    const [loading, setLoading] = useState(true);
    const [summary, setSummary] = useState(null);
    const [moduleFilter, setModuleFilter] = useState('');
    const [actionFilter, setActionFilter] = useState('');
    const [userFilter, setUserFilter] = useState('');
    const [search, setSearch] = useState('');
    const [error, setError] = useState('');

    const fetchLog = async () => {
        try {
            const res = await api.get('/audit', {
                params: {
                    module: moduleFilter || undefined,
                    action: actionFilter || undefined,
                    user_id: userFilter || undefined,
                    search: search || undefined,
                    limit: 500,
                },
            });
            setRows(res.data);
            setError('');
        } catch (err) {
            logError('AuditPage', 'fetchLog', `✗ ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to load the audit log.');
        } finally { setLoading(false); }
    };
    const fetchSummary = () => api.get('/audit/summary').then(r => setSummary(r.data)).catch(() => {});

    useEffect(() => { fetchLog(); }, [moduleFilter, actionFilter, userFilter, search]);
    useEffect(() => { fetchSummary(); }, []);

    const c = summary?.counts;

    return (
        <Box>
            <Alerts items={[error && { severity: 'error', text: error }]} />

            <StatCards columns={4} items={[
                { key: 'total', icon: <History />, label: 'Recorded actions', value: c?.total ?? '—', color: 'primary' },
                { key: 'today', icon: <Today />, label: 'Today', value: c?.today ?? '—', color: 'success' },
                { key: 'week', icon: <DateRange />, label: 'Last 7 days', value: c?.week ?? '—', color: 'info' },
                { key: 'modules', icon: <Apps />, label: 'Modules covered', value: summary?.modules?.length ?? '—', color: 'secondary' },
            ]} />

            <Paper elevation={3} sx={{ p: 3 }}>
                <PageHeader
                    icon={History}
                    title="Audit Log"
                    count={rows.length}
                    countLabel="entries"
                    search={search}
                    onSearch={setSearch}
                    searchPlaceholder="Search the action summary or username…"
                    extraActions={
                        <>
                            <TextField select size="small" label="Module" value={moduleFilter}
                                onChange={e => setModuleFilter(e.target.value)} sx={{ minWidth: 150 }}>
                                <MenuItem value="">All modules</MenuItem>
                                {(summary?.modules || []).map(m => (
                                    <MenuItem key={m.module} value={m.module} sx={{ textTransform: 'capitalize' }}>
                                        {m.module} ({m.n})
                                    </MenuItem>
                                ))}
                            </TextField>
                            <TextField select size="small" label="Action" value={actionFilter}
                                onChange={e => setActionFilter(e.target.value)} sx={{ minWidth: 130 }}>
                                <MenuItem value="">All actions</MenuItem>
                                {(summary?.actions || []).map(a => (
                                    <MenuItem key={a.action} value={a.action} sx={{ textTransform: 'capitalize' }}>
                                        {a.action} ({a.n})
                                    </MenuItem>
                                ))}
                            </TextField>
                            <TextField select size="small" label="Staff" value={userFilter}
                                onChange={e => setUserFilter(e.target.value)} sx={{ minWidth: 150 }}>
                                <MenuItem value="">Everyone</MenuItem>
                                {(summary?.actors || []).map(a => (
                                    <MenuItem key={a.user_id} value={a.user_id}>{a.name} ({a.n})</MenuItem>
                                ))}
                            </TextField>
                        </>
                    }
                />

                <Typography variant="body2" color="text.secondary" mb={2}>
                    Read-only by design — an audit log an operator can edit is not an audit log.
                    Each row carries the request id, so <code>rid=…</code> ties it to the backend logs.
                </Typography>

                <ModuleTable
                    loading={loading}columns={[
                        { key: 'when', label: 'When' },
                        { key: 'who', label: 'Who' },
                        { key: 'action', label: 'Action' },
                        { key: 'module', label: 'Module' },
                        { key: 'summary', label: 'What happened' },
                    ]}
                    rows={rows}
                    empty={{
                        icon: History,
                        title: 'Nothing recorded for these filters',
                        hint: 'Every create, edit and delete across the app lands here. Widen the date range or clear the module filter.',
                    }}
                    renderRow={(r) => (
                        <>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                <Typography variant="caption">{fmtDateTime(r.created_at)}</Typography>
                            </TableCell>
                            <TableCell>
                                <Box display="flex" alignItems="center" gap={0.75}>
                                    <Person fontSize="small" sx={{ color: 'text.secondary' }} />
                                    <Box>
                                        <Typography variant="body2" fontWeight={600}>
                                            {r.user_full_name || r.username || 'system'}
                                        </Typography>
                                        {r.role && (
                                            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                                                {r.role}
                                            </Typography>
                                        )}
                                    </Box>
                                </Box>
                            </TableCell>
                            <TableCell>
                                <Chip size="small" label={r.action} color={ACTION_COLOR[r.action] || 'default'}
                                    sx={{ textTransform: 'capitalize' }} />
                            </TableCell>
                            <TableCell>
                                <Chip size="small" variant="outlined" label={r.module} sx={{ textTransform: 'capitalize' }} />
                            </TableCell>
                            <TableCell>
                                <Typography variant="body2">{r.summary || '—'}</Typography>
                                {r.request_id && (
                                    <Tooltip title="Grep this in the backend logs to see the full request">
                                        <Typography variant="caption" color="text.secondary"
                                            sx={{ fontFamily: 'monospace', fontSize: 11 }}>
                                            rid={r.request_id}
                                        </Typography>
                                    </Tooltip>
                                )}
                            </TableCell>
                        </>
                    )}
                />
            </Paper>
        </Box>
    );
};

export default AuditPage;
