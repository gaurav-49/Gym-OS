// frontend/src/components/StaffNavGrid.jsx
// The staff navigation on a phone: all 22 modules, visible at once.
//
// The sidebar list is right on a desk machine, where it is always on screen and
// 22 rows cost nothing. On a phone it was a Drawer behind a hamburger, so the
// whole product was invisible until you knew to look for it — the same fault
// the member portal had with its scrolling tab strip, in a different costume.
//
// So on small screens the drawer becomes a full-width sheet of tiles showing
// every module in one view, with no second level and nothing behind a "more".
// The six section headings are not decoration: NAV already groups these, and at
// 22 items an ungrouped grid is a wall. The grouping is what makes it scannable
// and it costs nothing, because the data was already there.
import React from 'react';
import { Box, Typography, ButtonBase } from '@mui/material';
import { NAV } from './Sidebar.jsx';

const StaffNavGrid = ({ tab, onNavigate, isAdmin, brandName = 'GYM OS' }) => {
    // Same filter the sidebar uses, so the phone and the desk never disagree
    // about what this account can open.
    const rows = NAV.filter(n => n.section || !n.adminOnly || isAdmin);

    // Walk the flat NAV into [{ section, items: [...] }] so each heading keeps
    // its own grid and the columns line up within a group rather than across
    // the whole sheet.
    const groups = [];
    rows.forEach((n) => {
        if (n.section) groups.push({ section: n.section, items: [] });
        else if (groups.length) groups[groups.length - 1].items.push(n);
    });

    return (
        <Box sx={{ p: 1.5, pb: 2 }}>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '0.16em' }}>
                {brandName}
            </Typography>

            {groups.filter(g => g.items.length).map(group => (
                <Box key={group.section} sx={{ mt: 1 }}>
                    <Typography
                        variant="caption"
                        sx={{
                            display: 'block', mb: 0.5,
                            fontWeight: 700, letterSpacing: '0.14em',
                            textTransform: 'uppercase', color: 'text.secondary', fontSize: 11,
                        }}
                    >
                        {group.section}
                    </Typography>
                    <Box
                        role="group"
                        aria-label={group.section}
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(78px, 1fr))',
                            gap: 0.5,
                        }}
                    >
                        {group.items.map((item) => {
                            const Icon = item.icon;
                            const active = item.id === tab;
                            return (
                                <ButtonBase
                                    key={item.id}
                                    onClick={() => onNavigate(item.id)}
                                    aria-current={active ? 'page' : undefined}
                                    sx={{
                                        display: 'flex', flexDirection: 'column',
                                        alignItems: 'center', justifyContent: 'center', gap: 0.5,
                                        minHeight: 54, px: 0.25, py: 0.75,
                                        borderRadius: 2,
                                        border: '1px solid',
                                        borderColor: active ? 'primary.main' : 'divider',
                                        bgcolor: active ? 'primary.softBg' : 'background.paper',
                                        color: active ? 'primary.dark' : 'text.secondary',
                                        transition: 'background-color 160ms ease, border-color 160ms ease, transform 120ms ease',
                                        '&:active': { transform: 'scale(0.97)' },
                                        '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
                                        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                                    }}
                                >
                                    <Icon sx={{ fontSize: 19 }} />
                                    <Typography
                                        component="span"
                                        sx={{
                                            fontSize: 11, lineHeight: 1.1, textAlign: 'center',
                                            fontWeight: active ? 700 : 600,
                                        }}
                                    >
                                        {item.label}
                                    </Typography>
                                </ButtonBase>
                            );
                        })}
                    </Box>
                </Box>
            ))}
        </Box>
    );
};

export default StaffNavGrid;
