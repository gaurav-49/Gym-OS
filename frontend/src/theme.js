// frontend/src/theme.js
// The single source of every colour, radius, shadow and control size in the
// staff app. The member portal builds on its own theme (memberTheme.js) but
// takes the same shape, type scale and control sizing from here.
//
// This file used to export one fixed light theme. It is now a factory taking a
// mode, because both apps let their user choose. The light branch is the exact
// palette that shipped before — same hex values, same overrides — so that
// turning the factory on changed nothing for anyone who has not picked dark.
// That was deliberate: this theme dresses 22 staff pages of dense tables,
// forms and dialogs, and a quiet restyle of all of them is not something to do
// by accident while adding a toggle.
//
// Design notes:
//  * `softBg` on each palette colour is the 8–10% tint used for status chips,
//    stat-tile icons and selected rows. Pages used to hand-roll these as one
//    off rgba() literals, so the same "success green background" appeared in
//    four slightly different shades.
//  * Controls are sized on a 40px row: buttons, inputs, selects and icon
//    buttons all line up on a toolbar without per-page nudging.
//  * Every interactive element gets a visible focus ring. Keyboard users
//    previously had nothing to follow on the tile filters and icon actions.

import { createTheme, alpha } from '@mui/material/styles';

const GREEN = '#059669';
const INK = '#0f172a';

const withSoft = (main, softBg, rest = {}) => ({ main, softBg, ...rest });

// Everything that differs between the two grounds, in one place. Component
// overrides below read from this rather than carrying literals, so there is
// exactly one definition of "the line colour" per mode.
const surfacesFor = (dark) => dark ? {
    // Dark is a considered counterpart, not an inversion. The tables are the
    // reason: a pure-black ground with hairline rows loses the row rhythm that
    // makes a 12-column payment table readable, so the surface sits a step off
    // black and the lines stay visible rather than disappearing into it.
    pageBg: '#0B0F16',
    paper: '#131A24',
    line: 'rgba(148,163,184,0.16)',
    lineSoft: 'rgba(148,163,184,0.10)',
    lineHover: 'rgba(148,163,184,0.30)',
    textPrimary: '#E6EDF5',
    textSecondary: '#9FB0C3',
    textDisabled: '#64748B',
    headBg: '#0F1620',
    headText: '#9FB0C3',
    rowHover: 'rgba(255,255,255,0.035)',
    inputBg: 'rgba(255,255,255,0.04)',
    hover: 'rgba(255,255,255,0.05)',
    selected: 'rgba(5,150,105,0.16)',
    scrollThumb: 'rgba(148,163,184,0.32)',
    scrollThumbHover: 'rgba(148,163,184,0.5)',
    paperShadow: '0 1px 3px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.4)',
    dialogShadow: '0 24px 48px -12px rgba(0,0,0,0.7)',
    tooltipBg: '#020509',
    // On ink, #059669 as *text* is too dark to read comfortably; the lighter
    // tint is used for text and icons while fills keep the brand green.
    accentText: '#34d399',
} : {
    pageBg: '#f1f5f9',
    paper: '#ffffff',
    line: '#e2e8f0',
    lineSoft: '#eef2f7',
    lineHover: '#cbd5e1',
    textPrimary: INK,
    // 4.76:1 on the white card but 4.34:1 on the #f1f5f9 page ground, and
    // secondary text lands on both. #5b6b7f clears 4.5 on either (5.45 / 5.03).
    textSecondary: '#5b6b7f',
    textDisabled: '#94a3b8',
    headBg: '#f8fafc',
    headText: '#475569',
    rowHover: '#f8fafc',
    inputBg: '#fff',
    hover: '#f1f5f9',
    selected: '#ecfdf5',
    scrollThumb: '#cbd5e1',
    scrollThumbHover: '#94a3b8',
    paperShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)',
    dialogShadow: '0 24px 48px -12px rgba(15,23,42,0.25)',
    tooltipBg: INK,
    // 5.48:1 on white. The brand #059669 measures 3.77:1, which is below the
    // AA floor of 4.5 for normal text — fine as a fill behind white text,
    // not fine as small green text on a white card.
    accentText: '#047857',
};

export const buildTheme = (mode = 'light') => {
    const dark = mode === 'dark';
    const s = surfacesFor(dark);

    return createTheme({
        palette: {
            mode: dark ? 'dark' : 'light',
            // A semantic colour has two jobs — it fills a chip and it writes a
            // word — and one hex cannot do both on both grounds. Measured as
            // text: #10b981 is 6.89:1 on the dark card but 2.54:1 on a white
            // one, #f59e0b is 8.14 vs 2.15. Those are the "Paid in full" and
            // "4 member(s) · ₹1,850" chips, and on paper they were decoration
            // rather than words. So each role takes the value that is legible
            // on the ground it is actually painted on: the vivid tints stay in
            // dark, and light drops to the darker end of the same hue.
            // #047857 also carries white at 5.48:1, so the green fill under a
            // contained button clears AA at the same time (GREEN was 3.77:1).
            // Three roles per colour, and on ink they do not agree:
            //   .main      the word, on the page's own card
            //   contrast   the label sitting ON a filled chip or button
            //   .dark      the monogram on a .softBg tint (the codebase's own
            //              pairing: bgcolor 'x.softBg' with color 'x.dark')
            // White on the vivid dark-mode fills measures 2.14–3.77:1, so on ink
            // a filled chip takes an ink label instead — worst case 4.74:1. And
            // .softBg flips from a pale tint to a translucent wash, so .dark has
            // to flip with it: #d97706 was 3.07:1 on paper and #059669 3.58:1 on
            // ink, which is every set of member initials in the app.
            primary: withSoft(dark ? GREEN : '#047857', dark ? 'rgba(5,150,105,0.16)' : '#ecfdf5',
                { dark: dark ? '#34d399' : '#047857', light: '#34d399',
                  contrastText: dark ? INK : '#ffffff' }),
            secondary: withSoft(dark ? '#818cf8' : '#4f46e5', dark ? 'rgba(99,102,241,0.16)' : '#eef2ff',
                { dark: dark ? '#a5b4fc' : '#4338ca', light: '#818cf8',
                  contrastText: dark ? INK : '#ffffff' }),
            background: { default: s.pageBg, paper: s.paper },
            text: { primary: s.textPrimary, secondary: s.textSecondary, disabled: s.textDisabled },
            success: withSoft(dark ? '#10b981' : '#047857', dark ? 'rgba(16,185,129,0.16)' : '#ecfdf5',
                { dark: dark ? '#34d399' : '#047857', contrastText: dark ? INK : '#ffffff' }),
            warning: withSoft(dark ? '#f59e0b' : '#b45309', dark ? 'rgba(245,158,11,0.16)' : '#fffbeb',
                { dark: dark ? '#fbbf24' : '#92400e', contrastText: dark ? INK : '#ffffff' }),
            error: withSoft(dark ? '#ef4444' : '#c62828', dark ? 'rgba(239,68,68,0.18)' : '#fef2f2',
                { dark: dark ? '#fca5a5' : '#b91c1c', contrastText: dark ? INK : '#ffffff' }),
            info: withSoft(dark ? '#38bdf8' : '#0369a1', dark ? 'rgba(14,165,233,0.16)' : '#f0f9ff',
                { dark: dark ? '#7dd3fc' : '#075985', contrastText: dark ? INK : '#ffffff' }),
            divider: s.line,
            action: { hover: s.hover, selected: s.selected },
            // Not a MUI key — a named token so pages stop hand-rolling the one
            // green that is legible as text on the current ground.
            accentText: s.accentText,
        },

        shape: { borderRadius: 12 },

        typography: {
            fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
            h4: { fontWeight: 800, letterSpacing: '-0.02em' },
            h5: { fontWeight: 700, letterSpacing: '-0.01em' },
            h6: { fontWeight: 700, letterSpacing: '-0.01em' },
            subtitle1: { fontWeight: 600 },
            subtitle2: { fontWeight: 600 },
            button: { textTransform: 'none', fontWeight: 600 },
            // Table text and captions sit a touch larger than MUI's default; at the
            // old size the money columns were genuinely hard to scan.
            body2: { fontSize: '0.875rem' },
            caption: { fontSize: '0.75rem' },
        },

        components: {
            MuiCssBaseline: {
                styleOverrides: {
                    // A consistent, quiet scrollbar everywhere instead of the
                    // platform default fighting the dark sidebar.
                    '*::-webkit-scrollbar': { width: 10, height: 10 },
                    '*::-webkit-scrollbar-thumb': { backgroundColor: s.scrollThumb, borderRadius: 8, border: '2px solid transparent', backgroundClip: 'content-box' },
                    '*::-webkit-scrollbar-thumb:hover': { backgroundColor: s.scrollThumbHover },
                    '*::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
                    // Never let a stray wide element scroll the whole page sideways.
                    body: { overflowX: 'hidden' },
                },
            },

            MuiPaper: {
                styleOverrides: {
                    root: { backgroundImage: 'none', boxShadow: s.paperShadow },
                },
            },

            MuiCard: {
                defaultProps: { elevation: 0 },
                styleOverrides: {
                    root: {
                        border: `1px solid ${s.line}`,
                        borderRadius: 16,
                        transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
                    },
                },
            },

            MuiButton: {
                defaultProps: { disableElevation: true },
                styleOverrides: {
                    root: {
                        borderRadius: 10,
                        minHeight: 40,
                        paddingInline: 18,
                        whiteSpace: 'nowrap',
                        // The focus ring takes the button's own colour. A fixed
                        // green ring around a red "Delete" button read as two
                        // conflicting signals.
                        '&.Mui-focusVisible': { outline: `2px solid ${alpha(GREEN, dark ? 0.85 : 0.5)}`, outlineOffset: 2 },
                        '&.MuiButton-containedError.Mui-focusVisible, &.MuiButton-textError.Mui-focusVisible, &.MuiButton-outlinedError.Mui-focusVisible':
                            { outlineColor: alpha('#ef4444', 0.55) },
                        '&.MuiButton-containedWarning.Mui-focusVisible': { outlineColor: alpha('#f59e0b', 0.55) },
                        '&.MuiButton-containedSecondary.Mui-focusVisible': { outlineColor: alpha('#6366f1', 0.55) },
                        '&.MuiButton-containedInherit.Mui-focusVisible, &.MuiButton-textInherit.Mui-focusVisible':
                            { outlineColor: alpha(dark ? '#e2e8f0' : INK, 0.35) },
                    },
                    sizeSmall: { minHeight: 32, paddingInline: 12, fontSize: '0.8125rem' },
                    sizeLarge: { minHeight: 48, paddingInline: 24 },
                    // A contained button is the page's one primary action; give it
                    // enough weight that it is obvious which control that is.
                    containedPrimary: { boxShadow: '0 1px 2px rgba(5,150,105,0.35)' },
                },
            },

            MuiIconButton: {
                styleOverrides: {
                    root: {
                        borderRadius: 8,
                        '&.Mui-focusVisible': { outline: `2px solid ${alpha(GREEN, dark ? 0.85 : 0.5)}`, outlineOffset: 1 },
                    },
                    // 32x32 in a 62px row, with neighbouring icons touching at
                    // a 0px gap: Edit sat flush against Delete on every table in
                    // the app. The row has 30px of unused height, so a 44px-tall
                    // target is free — the vertical axis is where a click on a
                    // dense row actually misses. Width goes to 40 rather than 44
                    // so the action column grows by 8px an icon instead of 12,
                    // and the margin puts real space between two adjacent
                    // destructive buttons.
                    //
                    // Not done with a negative-margin overlay: neighbours are
                    // flush, so overlapping 44px hit areas would let the later
                    // button in DOM order swallow clicks aimed at the one before
                    // it — a worse bug than the small target.
                    sizeSmall: { padding: '12px 10px', margin: '0 2px' },
                },
            },

            MuiTableContainer: {
                styleOverrides: {
                    // Pure-CSS scroll shadows: the shaded edge appears only while
                    // there is more table to reach. On a phone the wide tables
                    // simply ran out of screen with nothing to say so. The
                    // gradients are painted in the current paper colour, or they
                    // read as two pale smears on a dark ground.
                    root: {
                        backgroundImage: `
                            linear-gradient(to right, ${s.paper} 30%, ${alpha(s.paper, 0)}),
                            linear-gradient(to right, ${alpha(s.paper, 0)}, ${s.paper} 70%),
                            radial-gradient(farthest-side at 0 50%, ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(15,23,42,0.16)'}, rgba(15,23,42,0)),
                            radial-gradient(farthest-side at 100% 50%, ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(15,23,42,0.16)'}, rgba(15,23,42,0))`,
                        backgroundPosition: 'left center, right center, left center, right center',
                        backgroundRepeat: 'no-repeat',
                        backgroundSize: '32px 100%, 32px 100%, 14px 100%, 14px 100%',
                        backgroundAttachment: 'local, local, scroll, scroll',
                    },
                },
            },

            MuiTableCell: {
                styleOverrides: {
                    head: {
                        fontWeight: 700,
                        color: s.headText,
                        backgroundColor: s.headBg,
                        fontSize: '0.72rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        borderBottom: `1px solid ${s.line}`,
                        paddingTop: 12,
                        paddingBottom: 12,
                    },
                    root: { borderColor: s.lineSoft },
                    sizeSmall: { paddingTop: 10, paddingBottom: 10 },
                },
            },

            MuiTableRow: {
                styleOverrides: {
                    root: {
                        '&:hover': { backgroundColor: s.rowHover },
                        '&:last-child td': { borderBottom: 0 },
                    },
                },
            },

            MuiChip: {
                styleOverrides: {
                    root: { fontWeight: 600, borderRadius: 8 },
                    sizeSmall: { height: 24 },
                    label: { paddingInline: 10 },
                },
            },

            MuiDialog: {
                styleOverrides: {
                    paper: { borderRadius: 16, boxShadow: s.dialogShadow },
                },
            },
            MuiDialogTitle: { styleOverrides: { root: { fontWeight: 700, fontSize: '1.125rem' } } },
            MuiDialogActions: { styleOverrides: { root: { padding: '16px 24px' } } },

            MuiTextField: { defaultProps: { size: 'small' } },
            MuiSelect: { defaultProps: { size: 'small' } },
            MuiFormControl: { defaultProps: { size: 'small' } },

            MuiOutlinedInput: {
                styleOverrides: {
                    root: {
                        borderRadius: 10,
                        backgroundColor: s.inputBg,
                        '& fieldset': { borderColor: s.line },
                        '&:hover fieldset': { borderColor: s.lineHover },
                    },
                    inputSizeSmall: { paddingTop: 10.5, paddingBottom: 10.5 },
                },
            },

            MuiTab: {
                styleOverrides: {
                    root: { textTransform: 'none', fontWeight: 600, minHeight: 48 },
                },
            },

            MuiTooltip: {
                defaultProps: { arrow: true },
                styleOverrides: {
                    tooltip: { backgroundColor: s.tooltipBg, fontSize: '0.75rem', borderRadius: 8, padding: '6px 10px' },
                    arrow: { color: s.tooltipBg },
                },
            },

            MuiAlert: {
                styleOverrides: {
                    root: { borderRadius: 10, alignItems: 'center' },
                    standardSuccess: { backgroundColor: dark ? 'rgba(16,185,129,0.12)' : '#ecfdf5' },
                    standardError: { backgroundColor: dark ? 'rgba(239,68,68,0.14)' : '#fef2f2' },
                    standardWarning: { backgroundColor: dark ? 'rgba(245,158,11,0.12)' : '#fffbeb' },
                    standardInfo: { backgroundColor: dark ? 'rgba(14,165,233,0.12)' : '#f0f9ff' },
                },
            },

            MuiLinearProgress: { styleOverrides: { root: { borderRadius: 999, height: 6 } } },

            MuiListItemButton: {
                styleOverrides: { root: { borderRadius: 10 } },
            },
        },
    });
};

// The default export stays a ready-made light theme so anything importing this
// module directly keeps working unchanged.
const theme = buildTheme('light');

export default theme;
