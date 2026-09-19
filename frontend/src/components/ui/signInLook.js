// frontend/src/components/ui/signInLook.js
// The look the two sign-in screens share, derived from the gym's own colour.
//
// Staff and members arrive at different doors, but both doors are the first
// thing anyone sees of this product, so the ground, the rail and the card frame
// live here and a change lands on both at once.
//
// EVERY colour below is computed from `gym.branding.colour`. It used to be a
// hand-mixed emerald ramp, which was fine for exactly one gym and wrong for
// every other one this product is sold to: a gym whose colour is #C2185B would
// have got its name in pink nowhere and an emerald door everywhere.
//
// The derivation is not a tint — it enforces contrast. White has to stay
// readable on the lightest stop of the rail (4.5:1, WCAG 1.4.3) whatever hue
// and lightness a reseller types in, so the ramp darkens until it does. A gym
// that picks a pale yellow gets a deep amber rail rather than white-on-cream.
// The accent rule is pushed the other way until it clears 3:1 against the rail
// it sits on (1.4.11, non-text contrast).

const FALLBACK = '#059669';
const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };

const parse = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

const toHex = (c) => '#' + [c.r, c.g, c.b]
    .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('');

const luminance = ({ r, g, b }) => {
    const f = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};

const mix = (c, target, t) => ({
    r: c.r + (target.r - c.r) * t,
    g: c.g + (target.g - c.g) * t,
    b: c.b + (target.b - c.b) * t,
});

const rgba = (c, a) => `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${a})`;

/** Darken until white text on it clears `floor`. Steps of 4% — fine enough that
 *  a colour already dark enough is left exactly as the gym chose it. */
const darkenUntilWhiteReads = (c, floor) => {
    let out = c;
    for (let t = 0; t <= 0.96 && ratio(WHITE, out) < floor; t += 0.04) {
        out = mix(c, BLACK, t);
    }
    return out;
};

/** Lighten until it clears `floor` against `against`. Used for the accent rule,
 *  which is a graphic on the rail rather than text, hence the 3:1 floor. */
const lightenUntilReads = (c, against, floor) => {
    let out = c;
    for (let t = 0; t <= 0.96 && ratio(out, against) < floor; t += 0.04) {
        out = mix(c, WHITE, t);
    }
    return out;
};

// The ramp is the same arithmetic every time, and it runs inside a render, so
// each colour is computed once and kept.
const cache = new Map();

const ramp = (hex) => {
    const key = String(hex || FALLBACK);
    if (cache.has(key)) return cache.get(key);

    const brand = parse(key) || parse(FALLBACK);
    // The lightest stop carries white text — the gym's name sits on it.
    const end = darkenUntilWhiteReads(brand, 4.5);
    const mid = mix(end, BLACK, 0.28);
    const start = mix(end, BLACK, 0.58);
    const value = {
        brand,
        start, mid, end,
        // Against the mid stop, where the rule actually sits.
        rule: lightenUntilReads(brand, mid, 3),
        endHex: toHex(end),
    };
    cache.set(key, value);
    return value;
};

/** Full-page ground behind the card, tinted with the gym's colour. */
export const signInGround = (dark = true, hex) => {
    const c = ramp(hex);
    return dark
        ? {
            backgroundColor: '#070D16',
            // Three soft pools rather than one straight gradient: a diagonal
            // ramp reads as a default, and this ground has to carry an
            // otherwise empty screen at 1680px.
            backgroundImage: [
                `radial-gradient(1100px 720px at 12% 6%, ${rgba(c.end, 0.42)}, transparent 62%)`,
                `radial-gradient(840px 640px at 92% 94%, ${rgba(c.rule, 0.12)}, transparent 60%)`,
                `radial-gradient(620px 620px at 72% 10%, ${rgba(c.brand, 0.15)}, transparent 66%)`,
            ].join(', '),
        }
        : {
            backgroundColor: '#EDF2F0',
            backgroundImage: [
                `radial-gradient(1100px 720px at 12% 6%, ${rgba(c.end, 0.15)}, transparent 62%)`,
                `radial-gradient(840px 640px at 92% 94%, ${rgba(c.brand, 0.12)}, transparent 60%)`,
            ].join(', '),
        };
};

/** The rail that carries the gym's identity. Always dark, in both themes. */
export const signInRail = (hex) => {
    const c = ramp(hex);
    return {
        position: 'relative',
        overflow: 'hidden',
        color: '#fff',
        height: '100%',
        background: `linear-gradient(157deg, ${toHex(c.start)} 0%, ${toHex(c.mid)} 48%, ${c.endHex} 100%)`,
        // Knurling — the crosshatch cut into a barbell so it does not slip. At
        // 5% white it is texture you feel rather than read, which is the point.
        '&::before': {
            content: '""', position: 'absolute', inset: 0, pointerEvents: 'none',
            backgroundImage:
                'repeating-linear-gradient(135deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 10px)',
        },
        // Light from the top-left corner, so the slab has a direction.
        '&::after': {
            content: '""', position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'radial-gradient(560px 400px at 0% 0%, rgba(255,255,255,0.17), transparent 64%)',
        },
    };
};

/** Rail contents sit above the two decorative layers. */
export const signInRailInner = { position: 'relative', zIndex: 1 };

/** The card frame. */
export const signInCard = (dark = true) => ({
    borderRadius: '24px',
    overflow: 'hidden',
    border: dark ? '1px solid rgba(148,163,184,0.16)' : '1px solid rgba(15,23,42,0.07)',
    boxShadow: dark
        ? '0 44px 90px -28px rgba(0,0,0,0.75), 0 2px 0 0 rgba(255,255,255,0.04) inset'
        : '0 34px 74px -30px rgba(15,23,42,0.34)',
});

/**
 * The short rule that introduces the gym's line. A fixed 56px, not a border on
 * the quote: as a border it stretched to whatever the quote wrapped to, and a
 * 360px bar of the brightest colour on the screen outshouted the sentence it
 * was meant to introduce.
 */
export const signInRule = (hex) => ({
    width: 56, height: 3, borderRadius: 2,
    backgroundColor: toHex(ramp(hex).rule),
    mt: 3, mb: 2.25,
});

/** The gym's own line, set as a pull quote. */
export const signInQuote = {
    maxWidth: 360,
    fontStyle: 'italic',
    lineHeight: 1.55,
    color: 'rgba(255,255,255,0.94)',
};
