// frontend/src/components/Alerts.jsx
// Shared inline alert group. Renders several alerts side by side on one line
// (wrapping only when they don't fit) instead of each alert taking its own
// full row — so a page with message + error + loadError stays compact instead
// of pushing the content down.
//
// Usage — pass falsy entries to skip them:
//   <Alerts items={[
//       message && { severity: 'success', text: message },
//       error   && { severity: 'error',   text: error },
//       loadError && { severity: 'error', text: loadError },
//   ]} />
//
// A validation failure names several fields at once. Those belong in ONE
// alert, not one pill per field: a form missing five things used to render
// five separate boxes that wrapped into a red thicket, while every other form
// in the app showed a single alert. Pass `lines` instead of `text`:
//
//   <Alerts items={[
//       Object.keys(formErrors).length && {
//           severity: 'error',
//           title: `${n} field${n > 1 ? 's' : ''} need attention`,
//           lines: Object.values(formErrors),
//       },
//   ]} />
//
// Each item: { severity, text | lines, title?, icon?, variant?, onClose?, sx? }
//
// Shape and colour come from the theme's MuiAlert overrides — the same ones a
// bare <Alert> gets — so alerts look identical whether or not they came
// through here. Don't reintroduce a borderRadius on these; it silently made
// every shared alert a different shape from every standalone one.

import { Stack, Alert, AlertTitle, Box } from '@mui/material';

const Alerts = ({ items = [], sx, spacing = 1 }) => {
    const list = items.filter(Boolean);
    if (list.length === 0) return null;

    return (
        <Stack
            direction="row"
            flexWrap="wrap"
            useFlexGap
            spacing={spacing}
            alignItems="flex-start"
            sx={{ mb: 2, ...sx }}
        >
            {list.map((a, i) => {
                const lines = (a.lines || []).filter(Boolean);
                return (
                    <Alert
                        key={i}
                        severity={a.severity || 'info'}
                        icon={a.icon}
                        variant={a.variant}
                        onClose={a.onClose}
                        sx={{
                            flex: '0 1 auto',
                            // A list is a block of text, so it reads better with
                            // the icon at the top; a one-liner stays centred.
                            ...(lines.length > 1 ? { alignItems: 'flex-start' } : null),
                            ...a.sx,
                        }}
                    >
                        {a.title && <AlertTitle sx={{ mb: lines.length ? 0.5 : 0 }}>{a.title}</AlertTitle>}
                        {lines.length > 0
                            ? lines.map((line, j) => <Box key={j}>{line}</Box>)
                            : a.text}
                    </Alert>
                );
            })}
        </Stack>
    );
};

export default Alerts;
