// frontend/src/components/ui/StatCards.jsx
// The KPI / filter tile row above every module table.
//
//   <StatCards
//       items={[{ key: 'free', label: 'Free', value: 12, color: 'success', icon: <Lock /> }]}
//       active={filter} onSelect={setFilter} allLabel="All lockers" allValue={40} />
//
// Two things this fixes across the app:
//
//  * There used to be two unrelated tile designs — an icon-in-a-tinted-circle
//    one on Dashboard/Payments and a bare-number one on Plans/Leads/Finance.
//    Same data, same job, different furniture. This is the one design; pass
//    `icon` or don't.
//  * When the tiles act as filters there was no way to tell they were
//    clickable and no way back to "everything" except re-clicking the active
//    tile, which nobody guesses. `allLabel` renders a real "All" tile.

import React from 'react';
import { GridLegacy as Grid, Card, CardActionArea, CardContent, Typography, Box } from '@mui/material';
import { AllInclusive } from '@mui/icons-material';

/** Long values step down a size instead of overflowing the tile. */
// The tile carries a 40px icon and its gap, so the text box is a good deal
// narrower than the card. The old tiers were still too generous for lakh-scale
// money: "₹52,86,000" is ten characters and ran 11px past the edge, losing the
// trailing digits — the ones that change the number most.
const valueFontSize = (value) => {
    const length = String(value ?? '').length;
    if (length > 12) return { xs: '0.85rem', sm: '0.95rem', lg: '1rem' };
    if (length > 9) return { xs: '0.95rem', sm: '1.05rem', lg: '1.1rem' };
    if (length > 7) return { xs: '1.05rem', sm: '1.2rem', lg: '1.3rem' };
    return { xs: '1.15rem', sm: '1.35rem', lg: '1.5rem' };
};

const StatCards = ({
    items = [],
    active,
    onSelect,
    columns = 5,
    mb = 3,
    allLabel,
    allValue,
    allIcon = <AllInclusive />,
}) => {
    const base = items.filter(Boolean);
    if (base.length === 0) return null;

    const selectable = !!onSelect;
    const list = selectable && allLabel
        ? [{
            key: '',
            label: allLabel,
            icon: allIcon,
            value: allValue ?? base.reduce((s, i) => s + (Number(i.value) || 0), 0),
        }, ...base]
        : base;

    // Keep tiles on one row where they fit; never fewer than 2 per row on md+.
    const md = Math.max(2, Math.floor(12 / Math.min(list.length, 6)));

    return (
        <Grid container spacing={2} mb={mb}>
            {list.map(item => {
                const isActive = selectable && (active || '') === (item.key || '');
                const color = item.color || 'primary';
                return (
                    <Grid item xs={6} sm={4} md={md} key={item.key ?? item.label}>
                        <Card
                            sx={{
                                height: '100%',
                                borderColor: isActive ? `${color}.main` : 'divider',
                                boxShadow: isActive ? `0 0 0 1px var(--mui-palette-${color}-main, transparent)` : undefined,
                                bgcolor: isActive ? `${color}.softBg` : 'background.paper',
                                transition: 'border-color .15s ease, background-color .15s ease, transform .15s ease',
                                '&:hover': selectable ? { transform: 'translateY(-1px)' } : undefined,
                            }}
                        >
                            <Wrapper selectable={selectable} onClick={() => onSelect(isActive ? '' : item.key)}>
                                <CardContent
                                    sx={{
                                        py: 2, px: 2,
                                        display: 'flex', alignItems: 'center', gap: 1.5,
                                        '&:last-child': { pb: 2 },
                                    }}
                                >
                                    {item.icon && (
                                        <Box
                                            sx={{
                                                width: { xs: 34, sm: 40 }, height: { xs: 34, sm: 40 }, borderRadius: 2, flexShrink: 0,
                                                display: 'grid', placeItems: 'center',
                                                bgcolor: `${color}.softBg`, color: `${color}.main`,
                                            }}
                                        >
                                            {item.icon}
                                        </Box>
                                    )}
                                    <Box sx={{ minWidth: 0 }}>
                                        {/* The tile shrinks its text rather than cropping it. A
                                            lakh-scale figure like ₹13,12,500 is ten characters and
                                            was running off the edge of the card, which loses the
                                            trailing digits — the ones that change the number most. */}
                                        <Typography
                                            variant="h5"
                                            fontWeight={800}
                                            color="text.primary"
                                            sx={{
                                                lineHeight: 1.15, whiteSpace: 'nowrap',
                                                fontSize: valueFontSize(item.value),
                                            }}
                                            title={String(item.value ?? '')}
                                        >
                                            {item.value}
                                        </Typography>
                                        <Typography
                                            variant="body2"
                                            color="text.secondary"
                                            sx={{ lineHeight: 1.3 }}
                                        >
                                            {item.label}
                                        </Typography>
                                        {item.hint && (
                                            <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.3 }}>
                                                {item.hint}
                                            </Typography>
                                        )}
                                    </Box>
                                </CardContent>
                            </Wrapper>
                        </Card>
                    </Grid>
                );
            })}
        </Grid>
    );
};

// A filter tile is a button and must behave like one (focus ring, Enter/Space,
// announced as clickable). A read-only KPI tile must not.
const Wrapper = ({ selectable, onClick, children }) =>
    selectable
        ? <CardActionArea onClick={onClick} sx={{ height: '100%' }}>{children}</CardActionArea>
        : <>{children}</>;

export default StatCards;
