// frontend/src/components/ui/ModuleTable.jsx
// The dense table every module list uses.
//
//   <ModuleTable
//       loading={loading}
//       columns={[{ key: 'name', label: 'Item' }, { key: 'qty', label: 'Qty', align: 'right' }]}
//       rows={products}
//       renderRow={p => <>…<TableCell/>…</>}
//       empty={{ title: 'No products yet', hint: '…', actionLabel: 'Add product', onAction: open }} />
//
// Three things it guarantees for every module:
//
//  * A loading state. No page had one, so every table showed its *empty* state
//    for the first second — "No members yet" above a list of 709. Skeleton
//    rows keep the layout still and say "coming" instead of "none".
//  * A real empty state (see EmptyState) rather than one grey sentence.
//  * Horizontal scrolling that stays inside the table. On a phone the wide
//    tables were clipping their right-hand columns with no way to reach them.

import React, { useEffect, useState } from 'react';
import {
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Button, Box, Typography, Skeleton,
} from '@mui/material';
import EmptyState from './EmptyState';

const PAGE_SIZE = 50;

const ModuleTable = ({
    columns = [],
    rows = [],
    renderRow,
    rowKey = (r) => r.id,
    loading = false,
    /** Either a string, a node, or EmptyState props: { title, hint, icon, actionLabel, onAction }. */
    empty,
    emptyText,
    pageSize = PAGE_SIZE,
    dense = true,
    /** Keep the header visible while scrolling a long list. */
    maxHeight,
}) => {
    const [limit, setLimit] = useState(pageSize);

    // A new filter/search result must start at the top again, otherwise the
    // previous "show more" carries over and hides the real result count.
    useEffect(() => { setLimit(pageSize); }, [rows.length, pageSize]);

    const visible = rows.slice(0, limit);
    const hidden = rows.length - visible.length;
    const showEmpty = !loading && rows.length === 0;

    const emptyProps = typeof empty === 'object' && empty !== null && !React.isValidElement(empty)
        ? empty
        : { title: empty || emptyText || 'Nothing here yet' };

    return (
        <>
            <TableContainer
                sx={{
                    overflowX: 'auto',
                    ...(maxHeight ? { maxHeight } : null),
                    // The scrollbar should read as part of the table, not the page.
                    '&::-webkit-scrollbar': { height: 8 },
                    '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 4 },
                }}
            >
                <Table size={dense ? 'small' : 'medium'} stickyHeader={!!maxHeight}>
                    <TableHead>
                        <TableRow>
                            {columns.map(c => (
                                <TableCell
                                    key={c.key}
                                    align={c.align || 'left'}
                                    sx={{ whiteSpace: 'nowrap', ...c.sx }}
                                >
                                    {c.label}
                                </TableCell>
                            ))}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {loading && Array.from({ length: 6 }).map((_, i) => (
                            <TableRow key={`sk-${i}`}>
                                {columns.map(c => (
                                    <TableCell key={c.key} align={c.align || 'left'}>
                                        <Skeleton
                                            variant="text"
                                            width={c.align === 'right' ? 60 : `${55 + ((i * 7 + c.key.length * 5) % 35)}%`}
                                            sx={{ ml: c.align === 'right' ? 'auto' : 0, fontSize: '0.95rem' }}
                                        />
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))}
                        {!loading && visible.map(row => (
                            <TableRow key={rowKey(row)} hover>{renderRow(row)}</TableRow>
                        ))}
                        {showEmpty && (
                            <TableRow>
                                <TableCell colSpan={columns.length} sx={{ border: 0, p: 0 }}>
                                    {React.isValidElement(empty) ? empty : <EmptyState {...emptyProps} />}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>
            {hidden > 0 && !loading && (
                <Box display="flex" justifyContent="center" alignItems="center" gap={2} mt={2}>
                    <Typography variant="caption" color="text.secondary">
                        Showing {visible.length} of {rows.length}
                    </Typography>
                    <Button size="small" onClick={() => setLimit(l => l + pageSize)}>
                        Show {Math.min(hidden, pageSize)} more
                    </Button>
                </Box>
            )}
        </>
    );
};

export default ModuleTable;
