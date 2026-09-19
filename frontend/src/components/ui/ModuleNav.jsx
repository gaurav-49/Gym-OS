// frontend/src/components/ui/ModuleNav.jsx
// The navigation both apps share: every module visible, at every width.
//
// Why this exists. The member portal used to put its ten tabs in a single
// `<Tabs variant="scrollable">` strip. Measured on a real phone (390x844) that
// showed TWO of the ten — a member could see Overview and Classes and had no
// way to know that Workouts, Diet, Progress, Attendance, Payments, Personal
// training, Locker and Refer & earn existed at all. Even a 1440px laptop
// clipped the last one. The staff app had the mirror image of the same fault:
// twenty-two modules behind a hamburger, so on a phone *nothing* was visible.
//
// The rule this component enforces: a module is never hidden. No horizontal
// scrolling, no "More" overflow, no kebab. If it exists, you can see it and
// reach it. It wraps instead — a grid on small screens, one row on wide ones —
// because wrapping is the only layout that scales to an unknown count without
// hiding something.
//
// Targets are >= 44px in both axes so they are honest touch targets, and the
// whole thing is real tablist markup (role/aria-selected/arrow keys), which
// neither app had before.
import React, { useRef } from 'react';
import { Box, Typography, ButtonBase } from '@mui/material';

// Each tile is icon-over-label. The label is what makes it navigable — an
// icon-only grid of 22 identical-looking glyphs is a memory test, not a menu.
const ModuleNav = ({
    items,              // [{ key, label, icon: Component, short?, badge? }]
    value,              // active key
    onChange,           // (key) => void
    tone = 'light',     // 'dark' sits on the portal's ink shell
    columns,            // { xs, sm, md, lg } overrides
    ariaLabel = 'Sections',
}) => {
    const refs = useRef({});
    const dark = tone === 'dark';

    // Arrow-key roving focus. A wrapped grid has no single axis, so both
    // orientations move by one — which is what a grid reads as.
    const onKeyDown = (e) => {
        const keys = items.map(i => i.key);
        const at = keys.indexOf(value);
        if (at < 0) return;
        const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!delta) return;
        e.preventDefault();
        const next = keys[(at + delta + keys.length) % keys.length];
        onChange(next);
        const node = refs.current[next];
        if (node) node.focus();
    };

    const palette = dark
        ? {
            surface: 'rgba(255,255,255,0.03)',
            border: 'rgba(148,163,184,0.14)',
            idle: '#94a3b8',
            hover: 'rgba(255,255,255,0.06)',
            activeBg: 'rgba(0,240,160,0.12)',
            activeBorder: 'rgba(0,240,160,0.45)',
            activeText: '#00F0A0',
            ring: '#00F0A0',
        }
        : {
            surface: '#ffffff',
            border: '#e2e8f0',
            idle: '#64748b',
            hover: '#f1f5f9',
            activeBg: '#ecfdf5',
            activeBorder: '#059669',
            activeText: '#047857',
            ring: '#059669',
        };

    // Default columns. Fixed counts on small screens rather than auto-fit:
    // auto-fit let a long label ("Attendance") wrap to a third line and push
    // the nav to 210px on a 390px phone, which is a quarter of the screen
    // spent on chrome. Five columns keeps ten modules to two tidy rows, and
    // above md auto-fit collapses them to a single row.
    const cols = columns || {
        xs: 'repeat(5, minmax(0, 1fr))',
        md: 'repeat(auto-fit, minmax(88px, 1fr))',
    };

    return (
        <Box
            role="tablist"
            aria-label={ariaLabel}
            aria-orientation="horizontal"
            onKeyDown={onKeyDown}
            sx={{
                display: 'grid',
                gridTemplateColumns: cols,
                gap: { xs: 0.75, sm: 1 },
                p: { xs: 1, sm: 1.25 },
                borderRadius: 3,
                bgcolor: palette.surface,
                border: '1px solid',
                borderColor: palette.border,
                backdropFilter: dark ? 'blur(8px)' : 'none',
            }}
        >
            {items.map((item) => {
                const Icon = item.icon;
                const active = item.key === value;
                return (
                    <ButtonBase
                        key={item.key}
                        ref={el => { refs.current[item.key] = el; }}
                        role="tab"
                        aria-selected={active}
                        tabIndex={active ? 0 : -1}
                        onClick={() => onChange(item.key)}
                        sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 0.5,
                            minHeight: 58,
                            px: 0.25,
                            py: 0.75,
                            borderRadius: 2,
                            border: '1px solid',
                            borderColor: active ? palette.activeBorder : 'transparent',
                            bgcolor: active ? palette.activeBg : 'transparent',
                            color: active ? palette.activeText : palette.idle,
                            transition: 'background-color 180ms ease, color 180ms ease, border-color 180ms ease, transform 120ms ease',
                            '&:hover': { bgcolor: active ? palette.activeBg : palette.hover },
                            '&:active': { transform: 'scale(0.97)' },
                            '&.Mui-focusVisible': { outline: `2px solid ${palette.ring}`, outlineOffset: 2 },
                            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                        }}
                    >
                        <Box sx={{ position: 'relative', display: 'flex' }}>
                            <Icon sx={{ fontSize: 22 }} />
                            {item.badge ? (
                                <Box
                                    aria-hidden
                                    sx={{
                                        position: 'absolute', top: -2, right: -6,
                                        minWidth: 8, height: 8, borderRadius: 999,
                                        bgcolor: dark ? '#FF4D6D' : 'error.main',
                                    }}
                                />
                            ) : null}
                        </Box>
                        {/* 11px is the smallest size that still reads as a word
                            rather than texture; the label never truncates to an
                            ellipsis because a half-word is worse than a wrap. */}
                        <Typography
                            component="span"
                            sx={{
                                fontSize: 11,
                                fontWeight: active ? 700 : 600,
                                lineHeight: 1.15,
                                textAlign: 'center',
                                letterSpacing: '0.01em',
                                hyphens: 'auto',
                            }}
                        >
                            {item.short || item.label}
                        </Typography>
                    </ButtonBase>
                );
            })}
        </Box>
    );
};

export default ModuleNav;
