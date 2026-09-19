// frontend/src/components/ui/PageHeader.jsx
// The heading row every module page shares: module icon, title, a count chip,
// optional search box, and the primary action button on the right.

import React from 'react';
import { Box, Typography, Chip, Button, TextField, InputAdornment } from '@mui/material';
import { Search } from '@mui/icons-material';

const PageHeader = ({
    icon: Icon,
    title,
    count,
    countLabel = 'shown',
    search,
    onSearch,
    searchPlaceholder = 'Search…',
    actionLabel,
    actionIcon,
    onAction,
    actionDisabled = false,
    extraActions = null,
}) => (
    <>
        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1} mb={2}>
            <Box display="flex" alignItems="center" gap={1}>
                {Icon && <Icon sx={{ color: 'primary.main' }} />}
                <Typography variant="h6">{title}</Typography>
                {count !== undefined && (
                    <Chip size="small" label={`${count} ${countLabel}`} variant="outlined" />
                )}
            </Box>
            <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                {extraActions}
                {actionLabel && (
                    <Button variant="contained" startIcon={actionIcon} onClick={onAction} disabled={actionDisabled}>
                        {actionLabel}
                    </Button>
                )}
            </Box>
        </Box>
        {onSearch && (
            <TextField
                fullWidth size="small" placeholder={searchPlaceholder} value={search}
                onChange={e => onSearch(e.target.value)}
                sx={{ mb: 2, maxWidth: 420 }}
                InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }}
            />
        )}
    </>
);

export default PageHeader;
