// frontend/src/components/ui/PoweredBy.jsx
// The one place the product's own name still appears to a gym's members and
// staff. A gym that would rather not show it can turn it off in Settings.

import React from 'react';
import { Box, Typography, Link } from '@mui/material';
import useBranding from './useBranding';

// text.disabled is for controls a user cannot operate — WCAG exempts those from
// contrast, and the palette sets it accordingly (2.37:1 on the light page ground).
// This is a live link, so it has to meet the 4.5 floor like any other text.
const PoweredBy = ({ sx, colour = 'text.secondary' }) => {
    const brand = useBranding();
    if (!brand.powered_by) return null;
    return (
        <Box sx={{ textAlign: 'center', py: 2, ...sx }}>
            <Typography variant="caption" sx={{ color: colour }}>
                Powered by{' '}
                <Link href="https://gymos.app" target="_blank" rel="noopener" underline="hover"
                    sx={{
                        color: 'inherit', fontWeight: 600,
                        // The link measured 49x15. Padding the anchor gives it a
                        // reachable target without moving the line it sits on.
                        display: 'inline-block', py: 1.9, px: 0.75, my: -1.9,
                    }}>
                    GYM OS
                </Link>
            </Typography>
        </Box>
    );
};

export default PoweredBy;
