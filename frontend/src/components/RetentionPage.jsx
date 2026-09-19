// frontend/src/components/RetentionPage.jsx
// Churn risk — who is about to leave, why, and what to do about it today.
//
// 1.0 could tell you who had already lapsed. By then the decision is made. This
// page scores every active member against their OWN baseline, so a twice-a-week
// regular who has gone quiet ranks above a once-a-month member who is simply
// between visits — and turns the worst cases into dated follow-ups.

import React, { useEffect, useMemo, useState } from 'react';
import {
    Box, Paper, Typography, Chip, Button, TableCell, LinearProgress, Tooltip, ToggleButton, ToggleButtonGroup, IconButton, Stack, Avatar, } from '@mui/material';
import {
    TrendingDown, Refresh, AddTask, Phone, LocalFireDepartment, WarningAmber, CheckCircle, Insights, HeartBroken, Update,
} from '@mui/icons-material';
import {
    ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend,
} from 'recharts';
import api from '../api';
import { log, logError } from '../logger';
import Alerts from './Alerts';
import { useTheme } from '@mui/material/styles';
import { useChartTheme } from './ui/chartTheme';
import { PageHeader, StatCards, ModuleTable, money, fmtDate, todayStr, initialsOf, useToast } from './ui';

// Kept in step with RetentionServiceImpl — the same three bands, same order.
const BANDS = [
    { key: 'at-risk', label: 'At risk', color: 'error', icon: WarningAmber,
      blurb: 'Losing them is likely without a nudge this week.' },
    // One `icon` per band. Two rows carried the key twice — a JSX element and
    // then a component reference — so the element was silently dropped and the
    // <Visibility /> and <Favorite /> imports rendered nothing at all.
    { key: 'watch', label: 'Watch', color: 'warning', icon: TrendingDown,
      blurb: 'Drifting. Worth a friendly check-in.' },
    { key: 'healthy', label: 'Healthy', color: 'success', icon: CheckCircle,
      blurb: 'Attending as usual with nothing outstanding.' },
];

const bandOf = (key) => BANDS.find(b => b.key === key) || BANDS[2];

const RetentionPage = ({ isAdmin }) => {
    const chart = useChartTheme();
    const dark = useTheme().palette.mode === 'dark';
    const toast = useToast();
    const [summary, setSummary] = useState(null);
    const [members, setMembers] = useState([]);
    const [band, setBand] = useState('at-risk');
    const [search, setSearch] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const load = async (nextBand = band) => {
        try {
            const [s, m] = await Promise.all([
                api.get('/retention/summary', { params: { days: 30 } }),
                api.get('/retention/at-risk', { params: { band: nextBand || undefined, limit: 300 } }),
            ]);
            setSummary(s.data);
            setMembers(m.data);
            setError('');
        } catch (err) {
            logError('RetentionPage', 'load', `✗ ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to load retention data.');
        }
    };
    useEffect(() => { load(band); /* eslint-disable-next-line */ }, [band]);

    const recompute = async () => {
        setBusy(true); setError(''); toast.success('');
        log('RetentionPage', 'recompute', '→ rescoring every active member');
        try {
            const res = await api.post('/retention/recompute');
            toast.success(res.data.message);
            await load(band);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to rescore members.');
        } finally { setBusy(false); }
    };

    const raiseTask = async (m) => {
        setError(''); toast.success('');
        try {
            await api.post('/tasks', {
                title: `Call ${m.name}`,
                details: m.risk_reason,
                category: 'retention',
                priority: m.risk_band === 'at-risk' ? 'high' : 'normal',
                due_on: todayStr(),
                member_id: m.id,
            });
            toast.success(`Follow-up raised for ${m.name} — it's on the Tasks page, due today.`);
            load(band);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to raise the follow-up.');
        }
    };

    const counts = summary?.counts || {};
    const trend = useMemo(() => (summary?.trend || []).map(t => ({
        date: String(t.snapshot_on).slice(5),
        'At risk': t.at_risk,
        Watch: t.watch,
        Healthy: t.healthy,
    })), [summary]);

    const filtered = members.filter(m => {
        if (!search) return true;
        const q = search.toLowerCase();
        return String(m.name).toLowerCase().includes(q)
            || String(m.member_code || '').includes(q)
            || String(m.phone || '').includes(q);
    });

    const active = counts.active || 0;
    const pct = (n) => (active ? Math.round((n / active) * 100) : 0);

    const columns = [
        { key: 'member', label: 'Member' },
        { key: 'risk', label: 'Risk', align: 'center' },
        { key: 'why', label: 'Why' },
        { key: 'last', label: 'Last visit', align: 'right' },
        { key: 'expiry', label: 'Expires', align: 'right' },
        { key: 'due', label: 'Owes', align: 'right' },
        { key: 'actions', label: '', align: 'right' },
    ];

    return (
        <Box>
            <Alerts items={[
                error && { severity: 'error', text: error },
            ]} />

            <StatCards columns={4} items={[
                { key: 'atrisk', icon: <HeartBroken />, label: 'At risk', value: counts.at_risk ?? '—', color: 'error',
                  hint: `${pct(counts.at_risk)}% of active members` },
                { key: 'watch', label: 'Watch', value: counts.watch ?? '—', color: 'warning',
                  hint: `${pct(counts.watch)}% drifting` },
                { key: 'healthy', label: 'Healthy', value: counts.healthy ?? '—', color: 'success',
                  hint: `${pct(counts.healthy)}% attending normally` },
                { key: 'run', icon: <Update />, label: 'Last scored', color: 'info',
                  value: counts.last_run ? fmtDate(counts.last_run) : 'never',
                  hint: 'rescored automatically every 6h' },
            ]} />

            {trend.length > 1 && (
                <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
                    <Box display="flex" alignItems="center" gap={1} mb={1}>
                        <Insights sx={{ color: 'primary.main' }} />
                        <Typography variant="h6">Risk over the last 30 days</Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary" mb={2}>
                        One point per day. A rising red band means the gym is losing people faster
                        than it is winning them back.
                    </Typography>
                    <ResponsiveContainer width="100%" height={240}>
                        <AreaChart data={trend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                            <CartesianGrid {...chart.grid} />
                            <XAxis dataKey="date" {...chart.axis} />
                            <YAxis {...chart.axis} allowDecimals={false} />
                            <ReTooltip {...chart.tooltip} />
                            <Legend {...chart.legend} />
                            {/* The three pastel fills were mixed for paper. On ink they are
                                the brightest thing on the page and swamp their own strokes,
                                so there the band is the series colour held back by opacity. */}
                            <Area type="monotone" dataKey="Healthy" stackId="1" stroke="#10b981"
                                fill={dark ? '#10b981' : '#a7f3d0'} fillOpacity={dark ? 0.45 : 0.6} />
                            <Area type="monotone" dataKey="Watch" stackId="1" stroke="#f59e0b"
                                fill={dark ? '#f59e0b' : '#fde68a'} fillOpacity={dark ? 0.45 : 0.6} />
                            <Area type="monotone" dataKey="At risk" stackId="1" stroke="#ef4444"
                                fill={dark ? '#ef4444' : '#fecaca'} fillOpacity={dark ? 0.45 : 0.6} />
                        </AreaChart>
                    </ResponsiveContainer>
                </Paper>
            )}

            <Paper elevation={3} sx={{ p: 3 }}>
                <PageHeader
                    icon={TrendingDown}
                    title="Members by risk"
                    count={filtered.length}
                    search={search}
                    onSearch={setSearch}
                    searchPlaceholder="Search by name, member ID or phone…"
                    extraActions={
                        <Button variant="outlined" startIcon={<Refresh />} onClick={recompute} disabled={busy}>
                            {busy ? 'Scoring…' : 'Rescore now'}
                        </Button>
                    }
                />

                <ToggleButtonGroup
                    size="small" exclusive value={band}
                    onChange={(_e, v) => v !== null && setBand(v)}
                    sx={{ mb: 2, flexWrap: 'wrap' }}
                >
                    {BANDS.map(b => (
                        <ToggleButton key={b.key} value={b.key} sx={{ px: 2 }}>
                            <b.icon fontSize="small" sx={{ mr: 0.75 }} />
                            {b.label}
                            <Chip size="small" label={counts[b.key.replace('-', '_')] ?? 0}
                                sx={{ ml: 1, height: 18, fontSize: 11 }} />
                        </ToggleButton>
                    ))}
                    <ToggleButton value="" sx={{ px: 2 }}>Everyone</ToggleButton>
                </ToggleButtonGroup>

                <Typography variant="body2" color="text.secondary" mb={2}>
                    {bandOf(band).blurb} Scores are relative to each member's own history — the reason
                    column says exactly what triggered it.
                </Typography>

                <ModuleTable
                    columns={columns}
                    rows={filtered}
                    emptyText={
                        band === 'at-risk'
                            ? 'Nobody is at risk right now. That is the goal.'
                            : 'No members in this band.'
                    }
                    renderRow={(m) => {
                        const b = bandOf(m.risk_band);
                        return (
                            <>
                                <TableCell>
                                    <Stack direction="row" spacing={1.25} alignItems="center">
                                        <Avatar sx={{ width: 32, height: 32, fontSize: 13, bgcolor: `${b.color}.main` }}>
                                            {initialsOf(m.name)}
                                        </Avatar>
                                        <Box sx={{ minWidth: 0 }}>
                                            <Typography variant="body2" fontWeight={600} noWrap>{m.name}</Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                ID {m.member_code}{m.trainer_name ? ` · ${m.trainer_name}` : ''}
                                            </Typography>
                                        </Box>
                                    </Stack>
                                </TableCell>
                                <TableCell align="center" sx={{ minWidth: 108 }}>
                                    <Typography variant="caption" fontWeight={700} color={`${b.color}.main`}>
                                        {m.risk_score}
                                    </Typography>
                                    <LinearProgress
                                        variant="determinate" value={Math.min(100, m.risk_score || 0)}
                                        color={b.color}
                                        sx={{ height: 6, borderRadius: 3, mt: 0.25 }}
                                    />
                                </TableCell>
                                <TableCell sx={{ maxWidth: 340 }}>
                                    <Typography variant="caption" color="text.secondary">
                                        {m.risk_reason}
                                    </Typography>
                                </TableCell>
                                <TableCell align="right">
                                    {m.last_visit_date
                                        ? <Typography variant="body2">{fmtDate(m.last_visit_date)}</Typography>
                                        : <Typography variant="caption" color="text.secondary">never</Typography>}
                                    {m.visit_streak > 0 && (
                                        <Chip size="small" variant="outlined" color="warning"
                                            icon={<LocalFireDepartment fontSize="small" />}
                                            label={`${m.visit_streak}w`} sx={{ ml: 0.5, height: 20 }} />
                                    )}
                                </TableCell>
                                <TableCell align="right">
                                    <Typography variant="body2">{fmtDate(m.membership_expiry)}</Typography>
                                </TableCell>
                                <TableCell align="right">
                                    {Number(m.amount_due) > 0
                                        ? <Chip size="small" color="error" variant="outlined" label={money(m.amount_due)} />
                                        : <Typography variant="caption" color="text.secondary">—</Typography>}
                                </TableCell>
                                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                    {m.phone && (
                                        <Tooltip title={`Call ${m.phone}`}>
                                            <IconButton size="small" component="a" href={`tel:${m.phone}`}>
                                                <Phone fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                    <Tooltip title={m.open_tasks > 0
                                        ? `${m.open_tasks} follow-up already open`
                                        : 'Raise a follow-up due today'}>
                                        <span>
                                            <IconButton size="small" color="primary" onClick={() => raiseTask(m)}
                                                disabled={m.open_tasks > 0}>
                                                <AddTask fontSize="small" />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                </TableCell>
                            </>
                        );
                    }}
                />
            </Paper>
        </Box>
    );
};

export default RetentionPage;
