// frontend/src/components/ui/ConfirmDialog.jsx
// One confirmation dialog for every destructive or money-moving action.
//
// Before this existed the app did the same job three incompatible ways: nine
// deletes fired on a single click with no confirmation at all, seven others
// used window.confirm (an OS-grey box that ignores the theme and cannot show
// the consequence), and the rest were bespoke. A member could be deactivated,
// a plan deleted or a whole day's dues collected by one mis-click.
//
// Use the hook, not the component:
//
//   const confirm = useConfirm();
//   ...
//   if (!await confirm({
//       title: 'Delete this plan?',
//       body: <>“Monthly” will stop being offered to new members.</>,
//       confirmLabel: 'Delete plan',
//       danger: true,
//   })) return;

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
    Button, Box,
} from '@mui/material';
import { WarningAmberRounded, DeleteOutline, PaymentsOutlined, HelpOutline } from '@mui/icons-material';

const ICONS = {
    danger: DeleteOutline,
    warning: WarningAmberRounded,
    money: PaymentsOutlined,
    default: HelpOutline,
};

const ConfirmContext = createContext(() => Promise.resolve(false));

/** Ask the user to confirm. Resolves true when they go ahead. */
export const useConfirm = () => useContext(ConfirmContext);

export const ConfirmProvider = ({ children }) => {
    const [state, setState] = useState(null);
    const resolver = useRef(null);

    const confirm = useCallback((opts) => new Promise(resolve => {
        resolver.current = resolve;
        setState({ tone: 'default', confirmLabel: 'Confirm', cancelLabel: 'Cancel', ...opts });
    }), []);

    const close = (answer) => {
        setState(null);
        // Resolve after the state clears so a caller that immediately opens a
        // second dialog is not fighting this one's exit transition.
        const r = resolver.current;
        resolver.current = null;
        if (r) r(answer);
    };

    const tone = state?.danger ? 'danger' : state?.tone || 'default';
    const Icon = ICONS[tone] || ICONS.default;
    const color = tone === 'danger' ? 'error' : tone === 'money' ? 'success' : 'primary';

    return (
        <ConfirmContext.Provider value={confirm}>
            {children}
            <Dialog
                open={!!state}
                onClose={() => close(false)}
                maxWidth="xs"
                fullWidth
                // Enter confirms, Escape cancels — the dialog is the only thing
                // focused, so this is unambiguous.
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); close(true); } }}
            >
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1 }}>
                    <Box
                        sx={{
                            width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                            display: 'grid', placeItems: 'center',
                            bgcolor: `${color}.softBg`, color: `${color}.main`,
                        }}
                    >
                        <Icon fontSize="small" />
                    </Box>
                    {state?.title || 'Are you sure?'}
                </DialogTitle>
                <DialogContent>
                    <DialogContentText component="div" sx={{ color: 'text.secondary' }}>
                        {state?.body || 'This cannot be undone.'}
                    </DialogContentText>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2.5, pt: 1 }}>
                    <Button onClick={() => close(false)} color="inherit">
                        {state?.cancelLabel}
                    </Button>
                    <Button
                        onClick={() => close(true)}
                        variant="contained"
                        color={color}
                        autoFocus
                    >
                        {state?.confirmLabel}
                    </Button>
                </DialogActions>
            </Dialog>
        </ConfirmContext.Provider>
    );
};

export default ConfirmProvider;
