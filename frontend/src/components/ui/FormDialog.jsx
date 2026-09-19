// frontend/src/components/ui/FormDialog.jsx
// The add/edit dialog shape every module shares: title, inline Alerts for the
// form's own errors (one per field, exactly like MembersPage), a Grid body and
// a Cancel / primary-action footer.
//
//   <FormDialog open={open} title="Add product" onClose={close}
//       errors={formErrors} error={error}
//       submitLabel="Add product" submitIcon={<Add />} onSubmit={save} busy={busy}>
//       <Grid item xs={12}>…</Grid>
//   </FormDialog>

import React from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button, GridLegacy as Grid,
} from '@mui/material';
import Alerts from '../Alerts';

const FormDialog = ({
    open,
    title,
    onClose,
    children,
    errors = {},
    error = '',
    submitLabel = 'Save',
    submitIcon,
    submitColor = 'primary',
    onSubmit,
    busy = false,
    maxWidth = 'sm',
    cancelLabel = 'Cancel',
    hideSubmit = false,
}) => {
    // One alert per invalid field, in the order the master table defines them,
    // then any request-level error underneath.
    const items = [
        ...Object.values(errors || {}).filter(Boolean).map(text => ({ severity: 'error', text })),
        error && { severity: 'error', text: error },
    ];

    return (
        <Dialog open={open} onClose={onClose} maxWidth={maxWidth} fullWidth>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>
                <Alerts items={items} />
                <Grid container spacing={2} sx={{ mt: 0.5 }}>
                    {children}
                </Grid>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{cancelLabel}</Button>
                {!hideSubmit && (
                    <Button variant="contained" color={submitColor} startIcon={submitIcon}
                        onClick={onSubmit} disabled={busy}>
                        {busy ? 'Saving…' : submitLabel}
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    );
};

export default FormDialog;
