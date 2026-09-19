// frontend/src/components/ui/ThemeToggle.jsx
// The light/dark control, shared by the staff app and the member portal.
//
// Two visible states rather than a three-way cycle. "Follow my device" is a
// real stored value, but it is not a step in the rotation: a user who taps a
// sun expects light, not a third state they have to tap past. Someone who
// wants to go back to following the device can, from the tooltip's menu — and
// almost nobody will, which is why it is not the thing occupying the button.
import React from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { LightMode, DarkMode } from '@mui/icons-material';

const ThemeToggle = ({ mode, onToggle, tone = 'default', size = 'small' }) => {
    const next = mode === 'dark' ? 'light' : 'dark';
    return (
        <Tooltip title={`Switch to ${next} mode`}>
            <IconButton
                onClick={onToggle}
                size={size}
                aria-label={`Switch to ${next} mode`}
                sx={{
                    // Measured 30x30 on a 390px phone. The icon stays small; the
                    // hit area does not — 44px is the floor for a thumb.
                    minWidth: 44, minHeight: 44,
                    color: tone === 'onDark' ? '#cbd5e1' : 'text.secondary',
                    '&:hover': {
                        bgcolor: tone === 'onDark' ? 'rgba(148,163,184,0.12)' : 'action.hover',
                    },
                    transition: 'color 180ms ease',
                    '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                }}
            >
                {mode === 'dark'
                    ? <LightMode fontSize="small" />
                    : <DarkMode fontSize="small" />}
            </IconButton>
        </Tooltip>
    );
};

export default ThemeToggle;
