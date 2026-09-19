// frontend/src/memberTheme.js
// The member portal's own theme — "Ironlight".
//
// Dark is one continuous sheet of near-black ink lit by a single signal green.
// A member opens this in two places: at the turnstile at 6am in a dim locker
// room, and on the sofa wondering whether they went enough this month. A white
// screen at 6am is a flashbang, it drains the OLED phone most members carry,
// and ink makes the QR plate the brightest object on the display — which is
// exactly what the desk scanner wants. The old design already knew this: it
// put a dark band at the top, then lost its nerve twenty pixels down and
// dropped into grey-on-grey admin. This commits.
//
// Light is NOT that inverted, and the numbers are why. Measured against white:
// the signal green scores 1.50:1 and is unreadable; even the product's brand
// green is 3.77:1, under the AA floor of 4.5. So the light ground takes its own
// accent (#047857, 5.48:1) and its own ember (#DC2626, 4.83:1). A mechanical
// dark-to-light flip would have shipped text nobody can read.
//
// Why the portal gets its own theme at all: theme.js dresses the staff app's
// 22 pages of dense tables. This is applied by a ThemeProvider *inside* the
// portal subtree, so the two can diverge without either dragging the other.
//
// The accent has a grammar worth keeping. GREEN appears only where the member
// is winning (days left, a logged visit, a cleared balance). RED only where the
// gym needs something from them (an unpaid balance, an expired term). Nothing
// else is allowed to be either colour.
import { createTheme, alpha } from '@mui/material/styles';

export const portalTokens = (mode) => mode === 'dark' ? {
    base: '#080B10',
    surface: '#11161F',
    surfaceHi: '#161C27',
    line: 'rgba(148,163,184,0.14)',
    lineStrong: 'rgba(148,163,184,0.26)',
    accent: '#00F0A0',
    accentSoft: 'rgba(0,240,160,0.12)',
    accentBorder: 'rgba(0,240,160,0.45)',
    danger: '#FF4D6D',
    warn: '#FFB020',
    text: '#F1F5F9',
    textDim: '#94A3B8',
    textFaint: '#64748B',
    track: 'rgba(148,163,184,0.18)',
    navBg: 'rgba(255,255,255,0.03)',
    // A plate set INTO a card — one workout, one meal. It has to be a step away
    // from `surface` on both grounds, and the two grounds disagree about which
    // direction that step goes: on paper you tint the plate down off white, on
    // ink you lift it up off black. This was a flat '#f8fafc' written for paper,
    // so in dark mode every exercise and every meal was near-white text on a
    // near-white plate. Invisible. A translucent lift also survives sitting on
    // `surfaceHi` rather than `surface`, which a fixed hex would not.
    inset: 'rgba(255,255,255,0.045)',
    // recharts draws nothing from the MUI theme — grid, axis ticks and tooltip
    // all have to be handed colours or they keep their light-mode defaults
    // (#666 axis text on ink is 3.1:1, under the 4.5 floor for small text).
    chartGrid: 'rgba(148,163,184,0.16)',
    chartAxis: '#94A3B8',
    chartTipBg: '#161C27',
    chartTipLine: 'rgba(148,163,184,0.26)',
    // The hero band behind the member's name.
    heroBg: 'linear-gradient(160deg,#0C1118 0%,#080B10 60%)',
} : {
    base: '#F4F6F8',
    surface: '#FFFFFF',
    surfaceHi: '#FFFFFF',
    line: '#E2E8F0',
    lineStrong: '#CBD5E1',
    accent: '#047857',
    accentSoft: '#ECFDF5',
    accentBorder: '#047857',
    danger: '#DC2626',
    warn: '#B45309',
    text: '#0F172A',
    // #64748B measures 4.76:1 on the white card but only 4.39:1 on the #F4F6F8
    // page ground, and secondary text lands on both. #5B6B7F clears the 4.5
    // floor on either (5.45 / 5.03) without reading any less quiet.
    textDim: '#5B6B7F',
    textFaint: '#94A3B8',
    track: '#E2E8F0',
    navBg: '#FFFFFF',
    inset: '#F8FAFC',
    chartGrid: '#E2E8F0',
    chartAxis: '#64748B',
    chartTipBg: '#FFFFFF',
    chartTipLine: '#E2E8F0',
    heroBg: 'linear-gradient(160deg,#FFFFFF 0%,#F4F6F8 100%)',
};

// The pass is the one object that does NOT follow the theme. It is the thing a
// member holds up at a door, so it keeps its own identity on either ground — a
// dark slab on paper reads, if anything, sharper than a glowing one on ink.
// Every colour inside it is therefore fixed, not a token: when it took page
// tokens, the member's name came out dark-on-dark in light mode.
// The pass keeps its own identity — the holographic edge, the laminate sweep,
// the monospaced code — but it does NOT stay ink on a white page. A black slab
// in the middle of a white dashboard reads as a rendering fault, not a design
// choice, and the reason for the dark face only holds on a dark ground: it puts
// the QR plate at maximum contrast against a dim locker room. On paper the whole
// screen is already bright and the slab buys nothing.
//
// The plate itself is pure white in BOTH themes, always. A desk scanner needs
// the quiet zone; tinting it to match the design is how you get a code that will
// not read at 6am. On the light face it takes a hairline so it still reads as a
// distinct object rather than a hole in the card.
export const passFor = (mode) => mode === 'dark' ? {
    face: 'linear-gradient(170deg,#141A24,#0C1016)',
    edge: 'linear-gradient(115deg,#00F0A0,#2B7FFF,#00F0A0,#0B7A5A)',
    text: '#F1F5F9',
    dim: '#94A3B8',
    code: '#00F0A0',
    plate: '#FFFFFF',
    plateEdge: 'none',
    // The plate glowing against the ink is the whole point on a dark ground.
    glow: '0 0 32px rgba(0,240,160,0.18)',
    sheen: 'rgba(255,255,255,0.16)',
} : {
    face: 'linear-gradient(170deg,#FFFFFF,#EEF2F6)',
    edge: 'linear-gradient(115deg,#047857,#2B7FFF,#047857,#0B7A5A)',
    text: '#0F172A',
    dim: '#5B6B7F',
    code: '#047857',
    plate: '#FFFFFF',
    plateEdge: '1px solid #E2E8F0',
    // A green halo on white is grime, not light.
    glow: '0 1px 3px rgba(15,23,42,0.10)',
    sheen: 'rgba(15,23,42,0.05)',
};

export const buildMemberTheme = (mode = 'dark') => {
    const dark = mode === 'dark';
    const t = portalTokens(mode);

    return createTheme({
        palette: {
            mode: dark ? 'dark' : 'light',
            primary: { main: t.accent, dark: dark ? '#0B7A5A' : '#065F46', light: dark ? '#5CFFC8' : '#10B981', contrastText: dark ? '#04140E' : '#FFFFFF' },
            secondary: { main: dark ? '#818CF8' : '#4F46E5' },
            background: { default: t.base, paper: t.surface },
            text: { primary: t.text, secondary: t.textDim, disabled: t.textFaint },
            success: { main: t.accent, dark: dark ? '#0B7A5A' : '#065F46' },
            warning: { main: t.warn },
            error: { main: t.danger },
            info: { main: dark ? '#38BDF8' : '#0284C7' },
            divider: t.line,
        },

        shape: { borderRadius: 14 },

        typography: {
            fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
            // Every figure here is a count or a rupee amount, and the count-up
            // animations visibly jitter with proportional figures.
            allVariants: { fontVariantNumeric: 'tabular-nums' },
            h4: { fontWeight: 900, letterSpacing: '-0.03em' },
            h5: { fontWeight: 800, letterSpacing: '-0.02em' },
            h6: { fontWeight: 800, letterSpacing: '-0.015em' },
            button: { textTransform: 'none', fontWeight: 700 },
            // Light-on-dark needs more leading than dark-on-light at the same
            // size, or the lines smear together.
            body2: { fontSize: '0.875rem', lineHeight: dark ? 1.55 : 1.5 },
            caption: { fontSize: '0.75rem', lineHeight: 1.45 },
            overline: { fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.16em' },
        },

        components: {
            MuiCssBaseline: {
                styleOverrides: {
                    // Bold light-on-dark bleeds and looks fat without this.
                    body: dark
                        ? { WebkitFontSmoothing: 'antialiased', textRendering: 'optimizeLegibility' }
                        : {},
                    '*::-webkit-scrollbar': { width: 10, height: 10 },
                    '*::-webkit-scrollbar-thumb': {
                        backgroundColor: dark ? 'rgba(148,163,184,0.3)' : '#cbd5e1',
                        borderRadius: 8, border: '2px solid transparent', backgroundClip: 'content-box',
                    },
                    '*::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
                },
            },

            MuiPaper: {
                styleOverrides: {
                    root: {
                        backgroundImage: 'none',
                        backgroundColor: t.surface,
                        boxShadow: dark ? 'none' : '0 1px 2px rgba(15,23,42,0.05)',
                    },
                },
            },

            MuiCard: {
                defaultProps: { elevation: 0 },
                styleOverrides: {
                    root: {
                        backgroundColor: t.surface,
                        border: `1px solid ${t.line}`,
                        borderRadius: 16,
                        backgroundImage: 'none',
                        boxShadow: dark ? 'none' : '0 1px 2px rgba(15,23,42,0.05)',
                        transition: 'border-color 180ms ease, transform 160ms ease',
                        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                    },
                },
            },

            MuiButton: {
                defaultProps: { disableElevation: true },
                styleOverrides: {
                    root: {
                        borderRadius: 11,
                        minHeight: 44,
                        // The staff theme's focus ring is alpha(green, 0.5),
                        // which is close to invisible on ink.
                        '&.Mui-focusVisible': { outline: `2px solid ${t.accent}`, outlineOffset: 3 },
                    },
                    containedPrimary: { color: dark ? '#04140E' : '#FFFFFF', fontWeight: 800 },
                },
            },

            MuiIconButton: {
                styleOverrides: {
                    root: { '&.Mui-focusVisible': { outline: `2px solid ${t.accent}`, outlineOffset: 2 } },
                },
            },

            MuiChip: {
                styleOverrides: {
                    root: { fontWeight: 700, borderRadius: 9 },
                    // A filled chip writes its label in the same hue as its wash, so on
                    // paper the wash eats the very contrast the label needs: warning at
                    // 0.12 measured 4.26:1. Ink has the opposite problem — the wash only
                    // lifts the ground away from the text — so it keeps the heavier value.
                    filledSuccess: { backgroundColor: alpha(t.accent, dark ? 0.16 : 0.07), color: t.accent },
                    filledError: { backgroundColor: alpha(t.danger, dark ? 0.18 : 0.07), color: t.danger },
                    filledWarning: { backgroundColor: alpha(t.warn, dark ? 0.16 : 0.07), color: t.warn },
                    outlinedSuccess: { borderColor: alpha(t.accent, 0.5), color: t.accent },
                },
            },

            MuiTableCell: {
                styleOverrides: {
                    head: {
                        backgroundColor: 'transparent',
                        color: t.textDim,
                        fontWeight: 700,
                        fontSize: '0.7rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        borderBottom: `1px solid ${t.line}`,
                    },
                    root: { borderColor: t.line },
                },
            },
            MuiTableRow: {
                styleOverrides: {
                    root: {
                        '&:hover': { backgroundColor: dark ? 'rgba(255,255,255,0.03)' : '#F8FAFC' },
                        '&:last-child td': { borderBottom: 0 },
                    },
                },
            },
            MuiTableContainer: {
                // The staff theme paints white scroll-shadow gradients here,
                // which read as two grey smears on ink.
                styleOverrides: { root: { backgroundImage: 'none' } },
            },

            MuiLinearProgress: {
                styleOverrides: {
                    root: { borderRadius: 999, height: 8, backgroundColor: t.track },
                },
            },

            MuiAlert: {
                styleOverrides: {
                    root: { borderRadius: 12, border: '1px solid', alignItems: 'center' },
                    standardError: { backgroundColor: alpha(t.danger, dark ? 0.12 : 0.08), borderColor: alpha(t.danger, 0.35), color: dark ? '#FFC7D1' : '#991B1B' },
                    standardWarning: { backgroundColor: alpha(t.warn, dark ? 0.1 : 0.08), borderColor: alpha(t.warn, 0.3), color: dark ? '#FFE0A8' : '#92400E' },
                    standardSuccess: { backgroundColor: alpha(t.accent, dark ? 0.1 : 0.08), borderColor: alpha(t.accent, 0.3), color: dark ? '#9FFFDC' : '#065F46' },
                    standardInfo: { backgroundColor: dark ? 'rgba(56,189,248,0.1)' : '#F0F9FF', borderColor: dark ? 'rgba(56,189,248,0.3)' : '#BAE6FD', color: dark ? '#BAE6FD' : '#075985' },
                },
            },

            MuiOutlinedInput: {
                styleOverrides: {
                    root: {
                        borderRadius: 11,
                        backgroundColor: dark ? 'rgba(255,255,255,0.04)' : '#FFFFFF',
                        '& fieldset': { borderColor: t.line },
                        '&:hover fieldset': { borderColor: t.lineStrong },
                    },
                },
            },

            MuiDialog: {
                styleOverrides: {
                    paper: {
                        backgroundColor: t.surfaceHi,
                        border: `1px solid ${t.line}`,
                        borderRadius: 18,
                    },
                },
            },

            MuiDivider: { styleOverrides: { root: { borderColor: t.line } } },
            MuiTooltip: {
                defaultProps: { arrow: true },
                styleOverrides: {
                    tooltip: { backgroundColor: dark ? '#020509' : '#0F172A', border: `1px solid ${t.line}`, fontSize: '0.75rem' },
                    arrow: { color: dark ? '#020509' : '#0F172A' },
                },
            },
        },
    });
};

export default buildMemberTheme('dark');
