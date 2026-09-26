// frontend/src/components/DashboardPage.jsx
// The landing page. Six headline numbers, two charts and the two lists the
// front desk actually acts on.
//
// Changes worth knowing about:
//  * The tiles are links. "69 expiring soon" is only useful if you can get to
//    those 69 people, and previously the number was a dead end.
//  * Charts render an explanation when there is nothing to plot. An empty
//    grid with no bars reads as a broken widget, not as "nobody came in".
//  * The money axis is in lakh/crore like the rest of the app, and wide
//    enough not to clip — it used to show a chopped "₹2000k".

import React, { useEffect, useState } from 'react';
import {
    Paper, Typography, GridLegacy as Grid, Box, Chip, Avatar, Divider, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Skeleton, Alert, } from '@mui/material';
import {
    Groups, Verified, HowToReg, HourglassBottom, WarningAmber, Payments, TrendingUp, AccessTime, ArrowForward, BarChart as BarChartIcon, InsightsOutlined,
} from '@mui/icons-material';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid } from 'recharts';
import api from '../api';
import { log, logError } from '../logger';
import { moneyShort, moneyCompact, countCompact, fmtDate, initialsOf } from './ui';
import EmptyState from './ui/EmptyState';
import { useChartTheme } from './ui/chartTheme';

// `tab` is the page the tile drills into — see PAGE_TITLES in App.jsx.
const CARDS = [
    { label: 'Total Members', key: 'total_members', icon: Groups, color: 'secondary', tab: 1 },
    { label: 'Active Members', key: 'active_members', icon: Verified, color: 'success', tab: 1 },
    { label: 'Present Today', key: 'present_today', icon: HowToReg, color: 'info', tab: 2 },
    { label: 'Expiring Soon', key: 'expiring_soon', icon: HourglassBottom, color: 'warning', tab: 1 },
    { label: 'Expired', key: 'expired_members', icon: WarningAmber, color: 'error', tab: 1 },
    { label: "Today's Collection", key: 'today_collection', icon: Payments, color: 'primary', money: true, tab: 5 },
];

const daysUntil = (dateStr) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(`${dateStr}T00:00:00`);
    return Math.round((target - today) / 86400000);
};

const StatCard = ({ card, value, onNavigate }) => {
    const Icon = card.icon;
    // The full "₹2,25,309" was overflowing the tile edge on real collection
    // amounts — none of the other tiles are more than 3-4 digits, so this
    // was the one value with no width budget. moneyCompact ("₹2.25L") is
    // the same abbreviation the revenue chart already uses; the exact
    // figure is still one hover away via the title attribute below.
    const display = card.money ? moneyCompact(value) : Number(value || 0).toLocaleString('en-IN');
    const clickable = !!onNavigate;
    return (
        <Paper
            onClick={clickable ? () => onNavigate(card.tab) : undefined}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate(card.tab); } } : undefined}
            sx={{
                p: 2.5, height: '100%',
                display: 'flex', alignItems: 'center', gap: 2,
                border: '1px solid', borderColor: 'divider', borderRadius: '16px',
                cursor: clickable ? 'pointer' : 'default',
                transition: 'transform .15s ease, box-shadow .15s ease, border-color .15s ease',
                '&:hover': clickable ? {
                    transform: 'translateY(-2px)',
                    borderColor: `${card.color}.main`,
                    boxShadow: '0 8px 20px -8px rgba(15,23,42,0.18)',
                } : undefined,
                '&:focus-visible': { outline: '2px solid', outlineColor: `${card.color}.main`, outlineOffset: 2 },
            }}
        >
            <Box
                sx={{
                    width: { xs: 40, sm: 48 }, height: { xs: 40, sm: 48 }, borderRadius: 3, flexShrink: 0,
                    bgcolor: `${card.color}.softBg`, color: `${card.color}.main`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
            >
                <Icon />
            </Box>
            <Box sx={{ minWidth: 0 }}>
                <Typography
                    variant="h4"
                    // The value shrinks on a narrow card rather than being cut
                    // off — "500 active members" was rendering as "5…".
                    sx={{
                        lineHeight: 1.1, fontWeight: 800, whiteSpace: 'nowrap',
                        fontSize: { xs: '1.4rem', sm: '1.75rem', lg: '2.125rem' },
                    }}
                    title={card.money ? moneyShort(value) : display}
                >
                    {/* Inter's ₹ glyph sits above the numeral baseline and
                        carries its own left-side padding at this weight —
                        every other tile is plain digits, so only a money
                        tile ever shows it. transform (not a margin/offset
                        that shifts layout) drops it onto the baseline;
                        the negative margin cancels the glyph's own padding
                        so the line still starts flush with the label below. */}
                    {card.money ? (
                        <>
                            <Box component="span" sx={{ fontWeight: 500, display: 'inline-block', ml: '-0.08em', transform: 'translateY(0.07em)' }}>₹</Box>
                            {display.replace('₹', '')}
                        </>
                    ) : display}
                </Typography>
                <Typography variant="body2" color="text.secondary" fontWeight={500}>
                    {card.label}
                </Typography>
            </Box>
        </Paper>
    );
};

const ChartCard = ({ icon: Icon, iconColor, title, action, children }) => (
    <Paper sx={{ p: 3, height: '100%', border: '1px solid', borderColor: 'divider', borderRadius: '16px' }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" gap={1} mb={2}>
            <Box display="flex" alignItems="center" gap={1} sx={{ minWidth: 0 }}>
                <Icon sx={{ color: iconColor }} />
                <Typography variant="h6" noWrap>{title}</Typography>
            </Box>
            {action}
        </Box>
        {children}
    </Paper>
);

const DashboardSkeleton = () => (
    <Box>
        <Grid container spacing={2} mb={3}>
            {Array.from({ length: 6 }).map((_, i) => (
                <Grid item key={i} xs={6} md={4} xl={2}>
                    <Paper sx={{ p: 2.5, display: 'flex', alignItems: 'center', gap: 2, borderRadius: '16px' }}>
                        <Skeleton variant="rounded" width={48} height={48} />
                        <Box sx={{ flexGrow: 1 }}>
                            <Skeleton variant="text" width="60%" height={36} />
                            <Skeleton variant="text" width="80%" />
                        </Box>
                    </Paper>
                </Grid>
            ))}
        </Grid>
        <Grid container spacing={3}>
            <Grid item xs={12} md={7}><Skeleton variant="rounded" height={340} sx={{ borderRadius: '16px' }} /></Grid>
            <Grid item xs={12} md={5}><Skeleton variant="rounded" height={340} sx={{ borderRadius: '16px' }} /></Grid>
        </Grid>
    </Box>
);

const DashboardPage = ({ onNavigate }) => {
    const chart = useChartTheme();
    const [stats, setStats] = useState(null);
    const [loadError, setLoadError] = useState('');

    useEffect(() => {
        log('DashboardPage', 'loadStats', '→ loading dashboard stats');
        api.get('/dashboard/stats')
            .then(res => setStats(res.data))
            .catch(err => {
                logError('DashboardPage', 'loadStats', `✗ failed: ${err.response?.data?.error || err.message}`, err);
                setLoadError(err.response?.data?.error || 'Failed to load the dashboard. Check that the backend is running.');
            });
    }, []);

    if (loadError) return <Alert severity="error">{loadError}</Alert>;
    if (!stats) return <DashboardSkeleton />;

    const weekly = stats.weekly_attendance.map(r => ({
        day: new Date(`${r.day}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' }),
        punches: Number(r.count) || 0,
    }));
    const hasAttendance = weekly.some(d => d.punches > 0);

    const revenue = stats.monthly_revenue.map(r => ({
        month: new Date(`${r.month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' }),
        amount: Number(r.total) || 0,
    }));
    const hasRevenue = revenue.some(d => d.amount > 0);

    return (
        <Box>
            {/* Stat cards — each one drills into the page that can act on it. */}
            <Grid container spacing={2} mb={3}>
                {CARDS.map(card => (
                    <Grid item key={card.key} xs={6} md={4} xl={2}>
                        <StatCard card={card} value={stats[card.key] ?? 0} onNavigate={onNavigate} />
                    </Grid>
                ))}
            </Grid>

            {/* Charts */}
            <Grid container spacing={3} mb={3}>
                <Grid item xs={12} md={7}>
                    <ChartCard icon={TrendingUp} iconColor="primary.main" title="Weekly Attendance">
                        <Box sx={{ height: 260 }}>
                            {hasAttendance ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={weekly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                        <CartesianGrid {...chart.grid} vertical={false} />
                                        <XAxis dataKey="day" {...chart.axis} tickLine={false} axisLine={false} />
                                        <YAxis {...chart.axis} allowDecimals={false} tickLine={false} axisLine={false} width={36}
                                            tickFormatter={countCompact} />
                                        <Tooltip {...chart.tooltip} cursor={{ fill: 'rgba(16,185,129,0.08)' }}
                                            formatter={v => [`${v} check-in${v === 1 ? '' : 's'}`, '']} />
                                        <Bar dataKey="punches" fill="#10b981" radius={[8, 8, 0, 0]} maxBarSize={42} />
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <EmptyState
                                    icon={BarChartIcon}
                                    title="No check-ins this week"
                                    hint="Once members start punching in — at the fingerprint terminal, by QR code, or marked by hand — their week shows up here."
                                    actionLabel={onNavigate ? 'Mark attendance' : undefined}
                                    onAction={onNavigate ? () => onNavigate(2) : undefined}
                                    dense
                                />
                            )}
                        </Box>
                    </ChartCard>
                </Grid>
                <Grid item xs={12} md={5}>
                    <ChartCard icon={Payments} iconColor="secondary.main" title="Revenue (6 months)">
                        <Box sx={{ height: 260 }}>
                            {hasRevenue ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={revenue} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                                                <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid {...chart.grid} vertical={false} />
                                        <XAxis dataKey="month" {...chart.axis} tickLine={false} axisLine={false} />
                                        {/* 56px so "₹40.8L" fits — the old 45px clipped the leading ₹. */}
                                        <YAxis {...chart.axis} tickLine={false} axisLine={false} width={56}
                                            tickFormatter={moneyCompact} />
                                        <Tooltip {...chart.tooltip}
                                            formatter={v => [moneyShort(v), 'Revenue']} />
                                        <Area type="monotone" dataKey="amount" stroke="#6366f1" strokeWidth={2.5} fill="url(#rev)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            ) : (
                                <EmptyState
                                    icon={InsightsOutlined}
                                    title="No revenue recorded yet"
                                    hint="Membership payments and counter sales from the last six months are charted here."
                                    dense
                                />
                            )}
                        </Box>
                    </ChartCard>
                </Grid>
            </Grid>

            {/* Lists */}
            <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                    <ChartCard
                        icon={AccessTime} iconColor="warning.main" title="Expiring Memberships"
                        action={stats.expiring_list.length > 0 && onNavigate && (
                            <Button size="small" endIcon={<ArrowForward />} onClick={() => onNavigate(1)}>
                                All members
                            </Button>
                        )}
                    >
                        {stats.expiring_list.length === 0 ? (
                            <EmptyState
                                icon={Verified}
                                title="Nothing expiring in the next 30 days"
                                hint="Renewals due inside a month will appear here so you can call ahead."
                                dense
                            />
                        ) : (
                            stats.expiring_list.map((m, i) => {
                                const days = daysUntil(m.membership_expiry);
                                return (
                                    <Box key={m.id}>
                                        {i > 0 && <Divider sx={{ my: 1 }} />}
                                        <Box display="flex" alignItems="center" justifyContent="space-between" gap={1} py={0.5}>
                                            <Box display="flex" alignItems="center" gap={1.5} sx={{ minWidth: 0 }}>
                                                <Avatar sx={{ bgcolor: 'warning.softBg', color: 'warning.dark', width: 34, height: 34, fontSize: 14, fontWeight: 700 }}>
                                                    {initialsOf(m.name)}
                                                </Avatar>
                                                <Box sx={{ minWidth: 0 }}>
                                                    <Typography variant="body2" fontWeight={600} noWrap>{m.name}</Typography>
                                                    <Typography variant="caption" color="text.secondary" noWrap>
                                                        {fmtDate(m.membership_expiry)}
                                                    </Typography>
                                                </Box>
                                            </Box>
                                            <Chip
                                                size="small"
                                                label={days < 0 ? 'Expired' : days === 0 ? 'Today' : `${days}d left`}
                                                color={days <= 7 ? 'error' : 'warning'}
                                                variant="outlined"
                                                sx={{ flexShrink: 0 }}
                                            />
                                        </Box>
                                    </Box>
                                );
                            })
                        )}
                    </ChartCard>
                </Grid>
                <Grid item xs={12} md={6}>
                    <ChartCard
                        icon={HowToReg} iconColor="primary.main" title="Recent Activity"
                        action={stats.recent_attendance.length > 0 && onNavigate && (
                            <Button size="small" endIcon={<ArrowForward />} onClick={() => onNavigate(2)}>
                                Attendance
                            </Button>
                        )}
                    >
                        {stats.recent_attendance.length === 0 ? (
                            <EmptyState
                                icon={HowToReg}
                                title="No check-ins recorded"
                                hint="The last few punches show up here as soon as members start arriving."
                                dense
                            />
                        ) : (
                            <TableContainer sx={{ overflowX: 'auto' }}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Member</TableCell>
                                            <TableCell sx={{ whiteSpace: 'nowrap' }}>Date</TableCell>
                                            <TableCell>Time</TableCell>
                                            <TableCell>Source</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {stats.recent_attendance.map(r => (
                                            <TableRow key={r.id} hover>
                                                <TableCell sx={{ fontWeight: 600 }}>{r.member_name}</TableCell>
                                                <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</TableCell>
                                                <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.time}</TableCell>
                                                <TableCell>
                                                    <Chip
                                                        size="small"
                                                        label={r.source === 'device' ? 'Fingerprint' : 'Manual'}
                                                        color={r.source === 'device' ? 'primary' : 'default'}
                                                        variant="outlined"
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </ChartCard>
                </Grid>
            </Grid>
        </Box>
    );
};

export default DashboardPage;
