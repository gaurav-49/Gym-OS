// frontend/src/components/Sidebar.jsx
// The primary navigation. Rendered two ways from App:
//   * desktop — a permanent 250px rail
//   * mobile  — the same content inside a temporary Drawer behind a hamburger
//
// It used to be desktop-only: on a phone the whole rail was swapped for a
// horizontal strip of 22 chips, which showed four of them at a time, dropped
// the section grouping and the icons, and — because the user block lives down
// here — left no way to see who was signed in or to sign out at all.

import React, { useEffect, useRef } from 'react';
import {
    Box, Typography, Avatar, List, ListItemButton, ListItemIcon, ListItemText, Divider, Tooltip } from '@mui/material';
import useBranding from './ui/useBranding';
import PoweredBy from './ui/PoweredBy';
import {
    SpaceDashboard, Groups, FactCheck, EventAvailable, Fingerprint, Payments, BarChart, ManageAccounts, Logout, NotificationsActive, QrCodeScanner, ReceiptLong, Campaign, CardMembership, Lock, Inventory2, AccountBalance, Description, Badge, FitnessCenter, History, Store, HeartBroken, Palette,
} from '@mui/icons-material';

// Grouped so a 22-item list stays navigable. `section` starts a labelled group.
export const NAV = [
    { section: 'Front desk' },
    { id: 0, label: 'Dashboard', icon: SpaceDashboard },
    { id: 1, label: 'Members', icon: Groups },
    { id: 2, label: 'Attendance', icon: FactCheck },
    { id: 9, label: 'QR Check-in', icon: QrCodeScanner },
    { id: 3, label: 'Classes', icon: EventAvailable },
    { id: 11, label: 'Leads', icon: Campaign },

    { section: 'Growth' },
    { id: 21, label: 'Retention', icon: HeartBroken },

    { section: 'Money' },
    { id: 5, label: 'Payments', icon: Payments },
    { id: 10, label: 'Billing', icon: ReceiptLong },
    { id: 14, label: 'Invoices', icon: Description },
    { id: 13, label: 'Finance', icon: AccountBalance, adminOnly: true },

    { section: 'Selling' },
    { id: 12, label: 'Plans', icon: CardMembership },
    { id: 16, label: 'Personal Training', icon: FitnessCenter },
    { id: 17, label: 'Inventory', icon: Inventory2 },
    { id: 18, label: 'Lockers', icon: Lock },

    { section: 'Operations' },
    { id: 4, label: 'Devices', icon: Fingerprint },
    { id: 15, label: 'Staff', icon: Badge, adminOnly: true },
    { id: 6, label: 'Reports', icon: BarChart },
    { id: 8, label: 'Reminders', icon: NotificationsActive, adminOnly: true },

    { section: 'Admin' },
    { id: 7, label: 'Users', icon: ManageAccounts, adminOnly: true },
    { id: 19, label: 'Branches', icon: Store, adminOnly: true },
    { id: 20, label: 'Audit Log', icon: History, adminOnly: true },
    { id: 22, label: 'Branding', icon: Palette, adminOnly: true },
];

const initialsOf = (user) => {
    const base = user?.name || user?.username || '?';
    return base.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
};

export const SIDEBAR_WIDTH = 250;

const Sidebar = ({ tab, onNavigate, user, onLogout, isAdmin }) => {
    const brand = useBranding();
    // With 22 items the list scrolls, so the selected entry can sit off-screen
    // — arriving on a page whose nav item you cannot see is disorienting.
    const activeRef = useRef(null);
    useEffect(() => {
        activeRef.current?.scrollIntoView({ block: 'nearest' });
    }, [tab]);

    return (
    <Box
        sx={{
            width: SIDEBAR_WIDTH,
            flexShrink: 0,
            bgcolor: '#0f172a',
            color: '#cbd5e1',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: '100vh',
        }}
    >
        {/* Logo */}
        <Box sx={{ px: 3, py: 3, display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
            <Box
                sx={{
                    width: 40, height: 40, borderRadius: 2.5, flexShrink: 0,
                    background: 'linear-gradient(135deg, #059669, #10b981)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 22, boxShadow: '0 4px 12px rgba(16,185,129,0.35)',
                }}
            >
                {brand.logo}
            </Box>
            <Box sx={{ minWidth: 0 }}>
                <Typography
                    variant="h6"
                    title={brand.name}
                    sx={{
                        color: '#fff', lineHeight: 1.15, fontWeight: 800,
                        // Gym names are longer than "GYM OS": allow two lines
                        // before clipping, and shrink the type a little so a
                        // three-word name still fits the rail.
                        fontSize: brand.name && brand.name.length > 14 ? '1rem' : '1.125rem',
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                    }}
                >
                    {brand.name}
                </Typography>
                {brand.tagline && (
                    <Typography variant="caption" noWrap sx={{ color: '#94a3b8', display: 'block' }}>
                        {brand.tagline}
                    </Typography>
                )}
            </Box>
        </Box>

        <Divider sx={{ borderColor: 'rgba(148,163,184,0.12)' }} />

        {/* Nav — the only thing that scrolls, so the logo and the user block
            stay put on a short screen. */}
        <List sx={{ px: 1.5, pt: 1, flexGrow: 1, overflowY: 'auto', minHeight: 0 }}>
            {NAV.filter(n => n.section || !n.adminOnly || isAdmin).map(n => {
                if (n.section) {
                    return (
                        <Typography
                            key={`section-${n.section}`}
                            variant="caption"
                            component="div"
                            sx={{
                                px: 2, pt: 2, pb: 0.5,
                                // The rail is a hard #0f172a in both themes, so text.secondary
                                // is no use here — it stays #64748b on paper and would leave the
                                // failure in place. #475569 measured 2.36:1; #94a3b8 is 6.96:1,
                                // and the 10px/700/uppercase treatment keeps these subordinate.
                                color: '#94a3b8', fontWeight: 700,
                                letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 11,
                            }}
                        >
                            {n.section}
                        </Typography>
                    );
                }
                const Icon = n.icon;
                const active = tab === n.id;
                return (
                    <ListItemButton
                        key={n.id}
                        ref={active ? activeRef : undefined}
                        onClick={() => onNavigate(n.id)}
                        selected={active}
                        sx={{
                            mb: 0.25,
                            py: 0.9,
                            color: active ? '#fff' : '#94a3b8',
                            // The active item gets a left marker as well as a
                            // tint — colour alone is not enough to find your
                            // place in a 22-item list at a glance.
                            position: 'relative',
                            '&.Mui-selected, &.Mui-selected:hover': { bgcolor: 'rgba(16,185,129,0.15)' },
                            '&.Mui-selected::before': {
                                content: '""', position: 'absolute', left: 0, top: 8, bottom: 8,
                                width: 3, borderRadius: 3, bgcolor: '#34d399',
                            },
                            '&:hover': { bgcolor: active ? 'rgba(16,185,129,0.2)' : 'rgba(148,163,184,0.08)' },
                            '&.Mui-focusVisible': { outline: '2px solid #34d399', outlineOffset: -2 },
                        }}
                    >
                        <ListItemIcon sx={{ minWidth: 38, color: active ? '#34d399' : '#64748b' }}>
                            <Icon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText primary={n.label} primaryTypographyProps={{ fontSize: 14, fontWeight: active ? 700 : 500 }} />
                    </ListItemButton>
                );
            })}
        </List>

        {/* User + logout */}
        <Box sx={{ p: 2, borderTop: '1px solid rgba(148,163,184,0.12)', flexShrink: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                <Avatar sx={{ bgcolor: '#34d399', color: '#0f172a', width: 36, height: 36, fontSize: 14, fontWeight: 700 }}>
                    {initialsOf(user)}
                </Avatar>
                <Box sx={{ minWidth: 0 }}>
                    <Tooltip title={user?.name || user?.username || ''}>
                        <Typography variant="body2" sx={{ color: '#e2e8f0', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {user?.name || user?.username}
                        </Typography>
                    </Tooltip>
                    <Typography variant="caption" sx={{ color: '#94a3b8', textTransform: 'capitalize' }}>
                        {user?.role}
                    </Typography>
                </Box>
            </Box>
            <ListItemButton onClick={onLogout} sx={{ color: '#f87171', '&:hover': { bgcolor: 'rgba(248,113,113,0.1)' } }}>
                <ListItemIcon sx={{ minWidth: 38, color: '#f87171' }}>
                    <Logout fontSize="small" />
                </ListItemIcon>
                <ListItemText primary="Logout" primaryTypographyProps={{ fontSize: 14, fontWeight: 600 }} />
            </ListItemButton>
            <PoweredBy sx={{ pt: 1.5, pb: 0 }} colour="#94a3b8" />
        </Box>
    </Box>
    );
};

export default Sidebar;
