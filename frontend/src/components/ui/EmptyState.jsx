// frontend/src/components/ui/EmptyState.jsx
// What a module shows when it has nothing to list.
//
// The old empty state was one grey sentence in a table cell, which read as a
// glitch rather than a state — and because no page had a loading indicator, it
// was also the first thing you saw on every page load, telling you there were
// no members a moment before 709 of them appeared. This gives the state a
// shape, an explanation and the action that fixes it.

import React from 'react';
import { Box, Typography, Button } from '@mui/material';
import { InboxOutlined } from '@mui/icons-material';

const EmptyState = ({
    icon: Icon = InboxOutlined,
    title = 'Nothing here yet',
    hint,
    actionLabel,
    actionIcon,
    onAction,
    dense = false,
}) => (
    <Box
        sx={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            textAlign: 'center', py: dense ? 4 : 7, px: 3,
        }}
    >
        <Box
            sx={{
                width: 56, height: 56, borderRadius: '50%', mb: 2,
                display: 'grid', placeItems: 'center',
                bgcolor: 'action.hover', color: 'text.disabled',
            }}
        >
            <Icon />
        </Box>
        <Typography variant="subtitle1" color="text.primary">{title}</Typography>
        {hint && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 420 }}>
                {hint}
            </Typography>
        )}
        {actionLabel && onAction && (
            <Button variant="contained" startIcon={actionIcon} onClick={onAction} sx={{ mt: 2.5 }}>
                {actionLabel}
            </Button>
        )}
    </Box>
);

export default EmptyState;
