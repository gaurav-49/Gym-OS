// frontend/src/components/ui/Ledger.jsx
// A record list that is a table on a wide screen and a stacked list on a phone.
//
// The member portal has six of these — attendance, payment history, PT plans,
// PT sessions, locker charges and referral invitations. Every one of them was a
// four-to-six column <Table> rendered at 390px, where the theme's scroll
// shadows are the only hint that three of the columns exist. A six-column table
// on a phone is not a responsive table; it is a table with most of it hidden,
// which is the same fault as the tab strip in a different costume.
//
// Below `sm` each row becomes a block: a strong primary line, a quiet meta line
// under it, and the value right-aligned in tabular figures — which is how you
// would read a bank statement on a phone, and is genuinely easier than any
// amount of horizontal scrolling.
import React from 'react';
import {
    Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';

/**
 * @param columns  [{ key, label, align?, render?(row), hideOnPhone? }]
 * @param rows     data
 * @param primary  (row) => node   the headline on a phone
 * @param meta     (row) => node   the quiet second line on a phone
 * @param value    (row) => node   right-aligned figure on a phone
 * @param trailing (row) => node   optional action, full-width under the row
 * @param empty    what to say when there is nothing
 */
const Ledger = ({ columns, rows, primary, meta, value, trailing, footer, empty = 'Nothing here yet.', getKey }) => {
    const theme = useTheme();
    const stacked = useMediaQuery(theme.breakpoints.down('sm'));

    if (!rows || rows.length === 0) {
        return (
            <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                {empty}
            </Typography>
        );
    }

    if (stacked) {
        return (
            <Box>
                {rows.map((row, i) => (
                    <Box
                        key={getKey ? getKey(row, i) : i}
                        sx={{
                            display: 'flex', alignItems: 'flex-start', gap: 1.5,
                            py: 1.5,
                            borderBottom: i === rows.length - 1 ? 0 : '1px solid',
                            borderColor: 'divider',
                        }}
                    >
                        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                            <Typography component="div" sx={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>
                                {primary(row)}
                            </Typography>
                            {meta && (
                                <Typography component="div" variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                                    {meta(row)}
                                </Typography>
                            )}
                            {trailing && <Box sx={{ mt: 0.75 }}>{trailing(row)}</Box>}
                        </Box>
                        {value && (
                            <Typography component="div" sx={{
                                fontWeight: 700, whiteSpace: 'nowrap',
                                fontVariantNumeric: 'tabular-nums', textAlign: 'right',
                            }}>
                                {value(row)}
                            </Typography>
                        )}
                    </Box>
                ))}
                {/* A totals line reads the same in both layouts: label left,
                    figure right, separated by a rule. */}
                {footer && (
                    <Box sx={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                        gap: 2, pt: 1.5, mt: 0.5, borderTop: '2px solid', borderColor: 'divider',
                    }}>
                        <Typography variant="body2" color="text.secondary">{footer.label}</Typography>
                        <Typography sx={{ fontWeight: 800, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                            {footer.value}
                        </Typography>
                    </Box>
                )}
            </Box>
        );
    }

    return (
        <TableContainer>
            <Table size="small">
                <TableHead>
                    <TableRow>
                        {columns.map(c => (
                            <TableCell key={c.key} align={c.align || 'left'}>{c.label}</TableCell>
                        ))}
                    </TableRow>
                </TableHead>
                <TableBody>
                    {rows.map((row, i) => (
                        <TableRow key={getKey ? getKey(row, i) : i}>
                            {columns.map(c => (
                                <TableCell key={c.key} align={c.align || 'left'}>
                                    {c.render ? c.render(row) : row[c.key]}
                                </TableCell>
                            ))}
                        </TableRow>
                    ))}
                    {footer && (
                        <TableRow sx={{ '& td': { borderBottom: 0, borderTop: '2px solid', borderTopColor: 'divider' } }}>
                            <TableCell colSpan={Math.max(1, columns.length - 1)} align="right" sx={{ color: 'text.secondary' }}>
                                {footer.label}
                            </TableCell>
                            <TableCell align="right" sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>
                                {footer.value}
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </TableContainer>
    );
};

export default Ledger;
