// frontend/src/components/BrandingPage.jsx
// The screen that makes this product sellable to more than one gym.
//
// Every gym-facing string already came from the server — branding.properties,
// layered with admin edits from the database — and PUT /api/branding has been
// there, whitelisted and admin-only, the whole time. Nothing called it. So
// changing a gym's name, its logo or the line on its sign-in screen meant
// editing a file inside the war and restarting the server, which is not
// something a gym owner can do and not something a reseller should have to do
// per site. This page is the missing half.
//
// refreshBranding() already existed for exactly this moment and had no caller:
// after a save, every mounted screen re-reads at once, so the sidebar, both
// login doors, the member portal and the next printed invoice all change
// together without a reload.

import React, { useEffect, useState } from 'react';
import {
    Box, Paper, TextField, Button, Typography, GridLegacy as Grid, Divider,
    FormControlLabel, Switch, Stack,
} from '@mui/material';
import { Palette, Save, Restore } from '@mui/icons-material';
import api from '../api';
import Alerts from './Alerts';
import { PageHeader, useToast, useBranding, refreshBranding } from './ui';
import { signInRail, signInRailInner, signInRule, signInQuote } from './ui/signInLook';
import { log, logError } from '../logger';

// Order and copy of the form. `help` says what the field does to the product,
// not what the field is — an owner filling this in has never seen the schema.
const FIELDS = [
    { key: 'name', label: 'Gym name', required: true, sm: 8,
      help: 'Labels every screen, both sign-in doors, and every invoice.' },
    { key: 'logo', label: 'Logo', sm: 4,
      help: 'One or two characters — an emoji, or initials.' },
    { key: 'tagline', label: 'Tagline', sm: 6,
      help: 'Sits under the name on the staff sign-in screen.' },
    { key: 'quote', label: 'Your line', sm: 6, multiline: true,
      help: 'Shown on both sign-in screens. Leave blank to hide it entirely.' },
    { key: 'colour', label: 'Brand colour', sm: 4,
      help: 'Hex, like #059669. Colours the sign-in doors.' },
    { key: 'phone', label: 'Phone', sm: 4, help: 'Printed on receipts and invoices.' },
    { key: 'email', label: 'Email', sm: 4, help: 'Printed on receipts and invoices.' },
    { key: 'address', label: 'Address', sm: 8, help: 'Printed on receipts and invoices.' },
    { key: 'website', label: 'Website', sm: 4 },
    { key: 'gstin', label: 'GSTIN', sm: 4, help: 'Blank leaves the line off the invoice.' },
    { key: 'invoice_prefix', label: 'Invoice series', sm: 4,
      help: 'Numbers every invoice <series>-<year>-0001. Changing it starts a new series.' },
    { key: 'receipt_note', label: 'Receipt note', sm: 8, multiline: true,
      help: 'Small print at the foot of every receipt and invoice.' },
];

const BrandingPage = () => {
    const live = useBranding();
    const [form, setForm] = useState(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const toast = useToast();

    // Seeded once from whatever the server last served, then owned by the form
    // so typing is not fought by the background refresh.
    useEffect(() => {
        if (form === null && live) setForm({ ...live });
    }, [live, form]);

    if (!form) return null;

    const setField = (key, value) => setForm(f => ({ ...f, [key]: value }));
    const dirty = FIELDS.some(f => (form[f.key] || '') !== (live[f.key] || ''))
        || !!form.powered_by !== !!live.powered_by;

    const colourValid = !form.colour || /^#[0-9a-fA-F]{6}$/.test(form.colour);

    const save = async () => {
        if (!String(form.name || '').trim()) {
            setError('The gym name cannot be blank — it labels every screen.');
            return;
        }
        if (!colourValid) {
            setError('Colour must be a hex value like #059669.');
            return;
        }
        setSaving(true);
        setError('');
        log('BrandingPage', 'save', `→ saving branding for "${form.name}"`);
        try {
            const body = { powered_by: String(!!form.powered_by) };
            FIELDS.forEach(f => { body[f.key] = form[f.key] ?? ''; });
            await api.put('/branding', body);
            // Everything already on screen re-reads, rather than telling the
            // admin to reload to see their own change.
            await refreshBranding();
            toast.success('Branding saved — every screen has been updated.');
        } catch (err) {
            logError('BrandingPage', 'save', `✗ ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to save branding.');
        } finally {
            setSaving(false);
        }
    };

    const preview = {
        name: form.name || 'Your gym',
        logo: form.logo || '',
        tagline: form.tagline || '',
        quote: form.quote || '',
        colour: colourValid ? form.colour : live.colour,
    };

    return (
        <>
            <PageHeader icon={Palette} title="Branding"
                actionLabel={saving ? 'Saving…' : 'Save changes'} actionIcon={<Save />}
                onAction={save} actionDisabled={saving || !dirty}
                extraActions={dirty && (
                    <Button size="small" startIcon={<Restore />} onClick={() => setForm({ ...live })}>
                        Discard
                    </Button>
                )} />

            <Alerts items={[error && { severity: 'error', text: error }]} />

            <Grid container spacing={2.5}>
                <Grid item xs={12} md={7}>
                    <Paper elevation={3} sx={{ p: 3 }}>
                        <Typography variant="overline" color="text.secondary">Identity</Typography>
                        <Grid container spacing={2} sx={{ mt: 0.5 }}>
                            {FIELDS.map(f => (
                                <Grid item xs={12} sm={f.sm || 6} key={f.key}>
                                    <TextField
                                        fullWidth label={f.label} value={form[f.key] ?? ''}
                                        required={f.required}
                                        multiline={f.multiline} minRows={f.multiline ? 2 : undefined}
                                        onChange={e => setField(f.key, e.target.value)}
                                        error={f.key === 'colour' ? !colourValid
                                            : (f.required && !String(form[f.key] || '').trim())}
                                        helperText={f.key === 'colour' && !colourValid
                                            ? 'Use a hex value like #059669.'
                                            : (f.help || ' ')} />
                                </Grid>
                            ))}
                        </Grid>

                        <Divider sx={{ my: 2.5 }} />
                        <FormControlLabel
                            control={<Switch checked={!!form.powered_by}
                                onChange={e => setField('powered_by', e.target.checked)} />}
                            label="Show &ldquo;Powered by GYM OS&rdquo;" />
                        <Typography variant="caption" color="text.secondary" display="block">
                            Turn this off for a fully white-labelled install.
                        </Typography>
                    </Paper>
                </Grid>

                {/* The sign-in rail, drawn from the values above rather than
                    described in prose. A gym owner picking a colour or writing
                    their line should see the screen their members will see. */}
                <Grid item xs={12} md={5}>
                    <Paper elevation={3} sx={{ p: 3 }}>
                        <Typography variant="overline" color="text.secondary">Sign-in screen</Typography>
                        <Box sx={{ ...signInRail(preview.colour), borderRadius: '18px', p: 3.5, mt: 1.5 }}>
                            <Box sx={signInRailInner}>
                                {preview.logo && (
                                    <Box sx={{
                                        width: 48, height: 48, borderRadius: '16px',
                                        bgcolor: 'rgba(255,255,255,0.16)',
                                        border: '1px solid rgba(255,255,255,0.22)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 26, mb: 2.5,
                                    }}>
                                        {preview.logo}
                                    </Box>
                                )}
                                <Typography sx={{
                                    fontSize: 26, fontWeight: 900, letterSpacing: '-0.03em',
                                    lineHeight: 1.1, color: '#fff', textWrap: 'balance',
                                }}>
                                    {preview.name}
                                </Typography>
                                {preview.tagline && (
                                    <Typography sx={{
                                        mt: 1, fontSize: 11, fontWeight: 700, letterSpacing: '0.16em',
                                        textTransform: 'uppercase', color: 'rgba(255,255,255,0.82)',
                                    }}>
                                        {preview.tagline}
                                    </Typography>
                                )}
                                {preview.quote && (
                                    <>
                                        <Box sx={signInRule(preview.colour)} />
                                        <Typography variant="body2" sx={signInQuote}>
                                            {preview.quote}
                                        </Typography>
                                    </>
                                )}
                            </Box>
                        </Box>
                        <Stack spacing={0.5} sx={{ mt: 2 }}>
                            <Typography variant="caption" color="text.secondary">
                                Updates as you type. Saving applies it to both sign-in screens,
                                the sidebar, the member portal and every printed document.
                            </Typography>
                        </Stack>
                    </Paper>
                </Grid>
            </Grid>
        </>
    );
};

export default BrandingPage;
