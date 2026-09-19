// frontend/src/components/ui/Readout.jsx
// The live numbers in the member portal: a figure that counts up, and the ring
// that winds around the member's avatar.
//
// Why the count-up is written to the DOM node rather than to React state: the
// Overview shows several of these at once, and tweening them through
// setState would put a render on every animation frame for each one. Writing
// textContent through a ref keeps 60fps off the reconciler entirely.
//
// Reduced motion is honoured by construction, not by an override: the hook
// checks the query first and writes the final value in one go, so a user who
// has asked for less motion gets the right number immediately rather than a
// fast animation.
import React, { useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';

const prefersReduced = () => {
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
};

// easeOutCubic — matches the curve the ring winds on, so a figure and its arc
// arrive together rather than one trailing the other.
const ease = (t) => 1 - Math.pow(1 - t, 3);

/**
 * A number that counts up on mount.
 * @param value    the final number
 * @param format   (n) => string, for rupees / plain integers
 * @param duration ms
 */
export const Figure = ({ value, format = (n) => String(n), duration = 700, sx, component = 'div' }) => {
    const ref = useRef(null);
    const target = Number(value) || 0;

    useEffect(() => {
        const node = ref.current;
        if (!node) return undefined;
        if (prefersReduced() || duration <= 0) {
            node.textContent = format(target);
            return undefined;
        }
        let raf = 0;
        let start = null;
        const step = (ts) => {
            if (start === null) start = ts;
            const t = Math.min(1, (ts - start) / duration);
            node.textContent = format(Math.round(target * ease(t)));
            if (t < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
        // format is re-created by callers each render; depending on it would
        // restart the tween on every parent render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target, duration]);

    return (
        <Typography
            component={component}
            ref={ref}
            sx={{
                fontWeight: 900,
                letterSpacing: '-0.035em',
                lineHeight: 1.1,
                fontVariantNumeric: 'tabular-nums',
                ...sx,
            }}
        >
            {/* The static value is the server-rendered truth and the
                reduced-motion end state; the effect overwrites it. */}
            {format(target)}
        </Typography>
    );
};

/**
 * The term ring that winds around the avatar. An SVG arc rather than a conic
 * gradient: @property support for animating a gradient stop is still patchy on
 * the Android WebViews members actually carry, and stroke-dashoffset is not.
 */
export const Ring = ({ size = 64, stroke = 4, pct = 0, color, track, children, title }) => {
    const r = (size - stroke) / 2;
    const circumference = 2 * Math.PI * r;
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
    const offset = circumference * (1 - clamped / 100);

    return (
        <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
            <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} role="img" aria-label={title}>
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
                <circle
                    cx={size / 2} cy={size / 2} r={r} fill="none"
                    stroke={color} strokeWidth={stroke} strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    style={{
                        transition: 'stroke-dashoffset 900ms cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                />
            </svg>
            <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
                {children}
            </Box>
        </Box>
    );
};

/** One labelled figure in the hero strip. */
export const Stat = ({ label, children, tone }) => (
    <Box sx={{
        flex: '1 1 0', minWidth: 0,
        bgcolor: 'background.paper',
        border: '1px solid', borderColor: 'divider',
        borderRadius: 3, px: 1.25, py: 1,
    }}>
        {/* Labels wrap rather than clip: "Visits this month" is 17 characters in a
            box a third of a 390px phone wide, and an ellipsis there would hide the
            very noun the label exists to supply. Two lines are reserved on every
            Stat so the three figures keep a common baseline whatever the label. */}
        <Typography sx={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', lineHeight: 1.35,
            textTransform: 'uppercase', color: 'text.secondary',
            minHeight: '2.7em', display: 'flex', alignItems: 'flex-start',
        }}>
            {label}
        </Typography>
        <Box sx={{ color: tone, fontSize: 'clamp(1.1rem, 5.5vw, 1.4rem)' }}>{children}</Box>
    </Box>
);

export default Figure;
