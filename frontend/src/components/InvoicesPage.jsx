// frontend/src/components/InvoicesPage.jsx
// Numbered tax invoices. `payments` records that money arrived; an invoice is
// the document saying what it was for — per-line HSN/SAC and tax, a sequential
// number, and a printable view the member can be handed.

import React, { useEffect, useState } from 'react';
import {
    Box, Paper, TextField, MenuItem, Chip, IconButton, Button, Tooltip, GridLegacy as Grid, TableCell, Typography, Divider, Dialog, DialogTitle, DialogContent, DialogActions, Table, TableBody, TableHead, TableRow, Autocomplete, } from '@mui/material';
import { Add, Description, Print, Cancel, Visibility, Delete, CheckCircle, Payments, Percent,
} from '@mui/icons-material';
import api from '../api';
import { log, logError } from '../logger';
import Alerts from './Alerts';
import { PAYMENT_MODES } from '../constants';
import { PageHeader, StatCards, ModuleTable, FormDialog, money, moneyShort, fmtDate, todayStr, useConfirm, useToast, useBranding } from './ui';
import { printInvoice } from './ui/invoice';

const STATUS_COLOR = { issued: 'info', paid: 'success', cancelled: 'default' };

const emptyLine = () => ({ description: '', hsn_sac: '', quantity: '1', unit_price: '', tax_rate: '18' });

const InvoicesPage = ({ isAdmin }) => {
    const brand = useBranding();
    const toast = useToast();
    const [invoices, setInvoices] = useState([]);
    const [allInvoices, setAllInvoices] = useState([]);
    // Distinguishes "still loading" from "genuinely empty" — without it the
    // table showed its empty state on every page load.
    const [loading, setLoading] = useState(true);
    const [members, setMembers] = useState([]);
    const [statusFilter, setStatusFilter] = useState('');
    const [search, setSearch] = useState('');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [form, setForm] = useState({ member: null, customer_name: '', invoice_date: todayStr(), method: 'Cash', notes: '' });
    const [lines, setLines] = useState([emptyLine()]);
    const [viewOpen, setViewOpen] = useState(false);
    const [viewing, setViewing] = useState(null);
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState('');
    const [busy, setBusy] = useState(false);

    const fetchInvoices = async () => {
        try {
            const res = await api.get('/invoices', { params: { status: statusFilter || undefined, search: search || undefined } });
            setInvoices(res.data);
            setLoadError('');
            api.get('/invoices').then(all => setAllInvoices(all.data)).catch(() => setAllInvoices([]));
        } catch (err) {
            logError('InvoicesPage', 'fetchInvoices', `✗ ${err.response?.data?.error || err.message}`, err);
            setLoadError(err.response?.data?.error || 'Failed to load invoices.');
        } finally { setLoading(false); }
    };
    useEffect(() => { fetchInvoices(); }, [statusFilter, search]);
    useEffect(() => {
        api.get('/clients').then(res => setMembers(res.data)).catch(() => setMembers([]));
    }, []);

    const openCreate = () => {
        setForm({ member: null, customer_name: '', invoice_date: todayStr(), method: 'Cash', notes: '' });
        setLines([emptyLine()]);
        setError('');
        setDialogOpen(true);
    };

    const setLine = (idx, field, value) => {
        setLines(ls => ls.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
    };
    const addLine = () => setLines(ls => [...ls, emptyLine()]);
    const removeLine = (idx) => setLines(ls => (ls.length === 1 ? ls : ls.filter((_, i) => i !== idx)));

    // Totals mirror the server's arithmetic so the preview never disagrees with
    // the issued document.
    const totals = lines.reduce((acc, l) => {
        const net = (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
        const tax = net * (Number(l.tax_rate) || 0) / 100;
        return { subtotal: acc.subtotal + net, tax: acc.tax + tax };
    }, { subtotal: 0, tax: 0 });

    const validateInvoice = () => {
        if (!form.member && !form.customer_name.trim()) return 'Pick a member or type a customer name.';
        for (const [i, l] of lines.entries()) {
            if (!l.description.trim()) return `Line ${i + 1}: description is required.`;
            if (!(Number(l.quantity) > 0)) return `Line ${i + 1}: quantity must be greater than 0.`;
            if (!(Number(l.unit_price) >= 0) || l.unit_price === '') return `Line ${i + 1}: unit price is required.`;
        }
        return null;
    };

    const handleCreate = async () => {
        const invalid = validateInvoice();
        if (invalid) { setError(invalid); return; }
        setBusy(true); setError('');
        log('InvoicesPage', 'handleCreate', `→ issue invoice for ${form.member?.name || form.customer_name} with ${lines.length} line(s)`);
        try {
            const res = await api.post('/invoices', {
                member_id: form.member?.id || null,
                customer_name: form.member ? form.member.name : form.customer_name.trim(),
                invoice_date: form.invoice_date,
                method: form.method,
                notes: form.notes,
                items: lines.map(l => ({
                    description: l.description.trim(), hsn_sac: l.hsn_sac || null,
                    quantity: Number(l.quantity), unit_price: Number(l.unit_price),
                    tax_rate: Number(l.tax_rate) || 0,
                })),
            });
            setDialogOpen(false);
            toast.success(res.data.message);
            fetchInvoices();
        } catch (err) {
            logError('InvoicesPage', 'handleCreate', `✗ ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to issue the invoice.');
        } finally { setBusy(false); }
    };

    /**
     * Prints the invoice as its own document.
     *
     * window.print() used to be called on the live app, so the paper carried
     * this dialog's Close and Print buttons and the page behind it, over two
     * sheets. The document opens in its own window instead, on the same paper
     * the receipt uses.
     */
    const handlePrint = () => {
        if (!viewing) return;
        if (!printInvoice(viewing, brand)) {
            toast.error('The browser blocked the invoice window — allow pop-ups for this site.');
        }
    };

    const openView = async (inv) => {
        setError('');
        try {
            const res = await api.get(`/invoices/${inv.id}`);
            setViewing(res.data);
            setViewOpen(true);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to load the invoice.');
        }
    };

    const setStatus = async (inv, status) => {
        setError(''); toast.success('');
        try {
            await api.put(`/invoices/${inv.id}`, { status });
            toast.success(`${inv.invoice_no} marked ${status}.`);
            fetchInvoices();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to update the invoice.');
        }
    };

    const confirm = useConfirm();

    const handleCancel = async (inv) => {
        if (!await confirm({
            // invoice_number does not exist on the row — the column, the API
            // and every other line on this page call it invoice_no — so the
            // dialog asked "Cancel invoice undefined?" and gave the person no
            // way to confirm they were cancelling the right one.
            title: `Cancel invoice ${inv.invoice_no}?`,
            body: <>The number stays used so the sequence keeps its audit trail — it is marked cancelled, not deleted.</>,
            confirmLabel: 'Cancel invoice', danger: true,
        })) return;
        setError(''); toast.success('');
        try {
            const res = await api.delete(`/invoices/${inv.id}`);
            toast.success(res.data.message);
            fetchInvoices();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to cancel the invoice.');
        }
    };

    // Tiles summarise the whole set, so they read from an unfiltered copy.
    // The list request sends `status` and `search` to the server, so building
    // the tiles from its result made a search change the totals the tiles
    // report — and clicking a status tile made that tile's own count the only
    // non-zero one on the row.
    const counts = { issued: 0, paid: 0, cancelled: 0 };
    allInvoices.forEach(i => { counts[i.status] = (counts[i.status] || 0) + 1; });
    const billed = allInvoices.filter(i => i.status !== 'cancelled').reduce((s, i) => s + Number(i.total), 0);
    const taxCollected = allInvoices.filter(i => i.status !== 'cancelled').reduce((s, i) => s + Number(i.tax_amount), 0);

    const columns = [
        { key: 'no', label: 'Invoice' },
        { key: 'date', label: 'Date' },
        { key: 'customer', label: 'Customer' },
        { key: 'subtotal', label: 'Subtotal', align: 'right' },
        { key: 'tax', icon: <Percent />, label: 'Tax', align: 'right' },
        { key: 'total', label: 'Total', align: 'right' },
        { key: 'status', label: 'Status' },
        { key: 'actions', label: 'Actions', align: 'right' },
    ];

    return (
        <Box>
            <Alerts items={[
                error && { severity: 'error', text: error },
                loadError && { severity: 'error', text: loadError },
            ]} />

            <StatCards columns={6} active={statusFilter} onSelect={setStatusFilter}
                allLabel="All invoices" allValue={allInvoices.length} items={[
                { key: 'issued', icon: <Description />, label: 'Issued', value: counts.issued, color: 'info' },
                { key: 'paid', icon: <CheckCircle />, label: 'Paid', value: counts.paid, color: 'success' },
                { key: 'cancelled', icon: <Cancel />, label: 'Cancelled', value: counts.cancelled, color: 'default' },
            ]} />
            <StatCards columns={5} items={[
                { key: 'billed', icon: <Payments />, label: 'Total billed', value: moneyShort(billed), color: 'primary' },
                { key: 'tax', label: 'Tax collected', value: moneyShort(taxCollected), color: 'warning' },
            ]} />

            <Paper elevation={3} sx={{ p: 3 }}>
                <PageHeader
                    icon={Description}
                    title="Tax Invoices"
                    count={invoices.length}
                    search={search}
                    onSearch={setSearch}
                    searchPlaceholder="Search by invoice number or customer…"
                    actionLabel="New invoice"
                    actionIcon={<Add />}
                    onAction={openCreate}
                />
                <Typography variant="body2" color="text.secondary" mb={2}>
                    Numbers are allocated in sequence per year (<code>INV-YYYY-NNNN</code>). A tax
                    invoice is <b>cancelled, never deleted</b>, so the sequence always audits.
                </Typography>

                <ModuleTable
                    loading={loading}columns={columns}
                    rows={invoices}
                    empty={{
                        icon: Description,
                        title: 'No invoices issued yet',
                        hint: 'Invoices are numbered in an unbroken sequence, so issue them from here rather than by hand.',
                        actionLabel: 'New invoice',
                        actionIcon: <Add />,
                        onAction: openCreate,
                    }}
                    renderRow={(i) => (
                        <>
                            <TableCell>
                                <Typography variant="body2" fontWeight={700}
                                    sx={{ textDecoration: i.status === 'cancelled' ? 'line-through' : 'none' }}>
                                    {i.invoice_no}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">{i.item_count} line(s)</Typography>
                            </TableCell>
                            <TableCell><Typography variant="caption">{fmtDate(i.invoice_date)}</Typography></TableCell>
                            <TableCell>
                                <Typography variant="body2">{i.customer_name}</Typography>
                                {i.member_code && (
                                    <Typography variant="caption" color="text.secondary">Member ID {i.member_code}</Typography>
                                )}
                            </TableCell>
                            <TableCell align="right">{money(i.subtotal)}</TableCell>
                            <TableCell align="right">
                                <Typography variant="body2" color="text.secondary">{money(i.tax_amount)}</Typography>
                            </TableCell>
                            <TableCell align="right">
                                <Typography variant="body2" fontWeight={700}>{money(i.total)}</Typography>
                            </TableCell>
                            <TableCell>
                                <Chip size="small" label={i.status} color={STATUS_COLOR[i.status]}
                                    sx={{ textTransform: 'capitalize' }} />
                            </TableCell>
                            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                <IconButton size="small" title="View / print" onClick={() => openView(i)}>
                                    <Visibility fontSize="small" />
                                </IconButton>
                                {i.status === 'issued' && (
                                    <Tooltip title="Mark paid">
                                        <IconButton size="small" color="success" onClick={() => setStatus(i, 'paid')}>
                                            <CheckCircle fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                )}
                                {isAdmin && i.status !== 'cancelled' && (
                                    <Tooltip title="Cancel this invoice">
                                        <IconButton size="small" color="error" onClick={() => handleCancel(i)}>
                                            <Cancel fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                )}
                            </TableCell>
                        </>
                    )}
                />
            </Paper>

            {/* New invoice */}
            <FormDialog
                open={dialogOpen} title="Issue a Tax Invoice" onClose={() => setDialogOpen(false)}
                error={error} submitLabel="Issue invoice" submitIcon={<Description />}
                onSubmit={handleCreate} busy={busy} maxWidth="md"
            >
                <Grid item xs={12} sm={6}>
                    <Autocomplete
                        options={members}
                        value={form.member}
                        onChange={(e, v) => setForm({ ...form, member: v })}
                        getOptionLabel={(m) => `${m.name} (ID ${m.member_code})`}
                        isOptionEqualToValue={(o, v) => o.id === v.id}
                        renderInput={(params) => <TextField {...params} label="Member" placeholder="Search, or leave blank for a walk-in" />}
                    />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField fullWidth label="Customer name" value={form.member ? form.member.name : form.customer_name}
                        onChange={e => setForm({ ...form, customer_name: e.target.value })}
                        disabled={!!form.member}
                        helperText={form.member ? 'Taken from the member record' : 'Required for a walk-in'} />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField fullWidth type="date" label="Invoice date" value={form.invoice_date}
                        onChange={e => setForm({ ...form, invoice_date: e.target.value })}
                        InputLabelProps={{ shrink: true }} />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField select fullWidth label="Payment method" value={form.method}
                        onChange={e => setForm({ ...form, method: e.target.value })}>
                        {PAYMENT_MODES.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                    </TextField>
                </Grid>

                <Grid item xs={12}>
                    <Divider sx={{ my: 1 }}>
                        <Typography variant="caption" color="text.secondary">LINE ITEMS</Typography>
                    </Divider>
                </Grid>

                {lines.map((l, idx) => (
                    <React.Fragment key={idx}>
                        <Grid item xs={12} sm={4}>
                            <TextField fullWidth size="small" required label={`Description ${idx + 1}`} value={l.description}
                                onChange={e => setLine(idx, 'description', e.target.value)} />
                        </Grid>
                        <Grid item xs={6} sm={2}>
                            <TextField fullWidth size="small" label="HSN/SAC" value={l.hsn_sac}
                                onChange={e => setLine(idx, 'hsn_sac', e.target.value)} />
                        </Grid>
                        <Grid item xs={6} sm={1.5}>
                            <TextField fullWidth size="small" type="number" label="Qty" value={l.quantity}
                                onChange={e => setLine(idx, 'quantity', e.target.value)} inputProps={{ min: 0, step: 'any' }} />
                        </Grid>
                        <Grid item xs={6} sm={2}>
                            <TextField fullWidth size="small" type="number" label="Rate (₹)" value={l.unit_price}
                                onChange={e => setLine(idx, 'unit_price', e.target.value)} inputProps={{ min: 0 }} />
                        </Grid>
                        <Grid item xs={4} sm={1.5}>
                            <TextField fullWidth size="small" type="number" label="Tax %" value={l.tax_rate}
                                onChange={e => setLine(idx, 'tax_rate', e.target.value)} inputProps={{ min: 0, max: 100 }} />
                        </Grid>
                        <Grid item xs={2} sm={1} sx={{ display: 'flex', alignItems: 'center' }}>
                            <IconButton size="small" color="error" onClick={() => removeLine(idx)}
                                disabled={lines.length === 1} title="Remove line">
                                <Delete fontSize="small" />
                            </IconButton>
                        </Grid>
                    </React.Fragment>
                ))}

                <Grid item xs={12} sm={6}>
                    <Button size="small" startIcon={<Add />} onClick={addLine}>Add line</Button>
                </Grid>
                <Grid item xs={12} sm={6}>
                    <Box textAlign="right">
                        <Typography variant="body2" color="text.secondary">
                            Subtotal {money(totals.subtotal)} · Tax {money(totals.tax)}
                        </Typography>
                        <Typography variant="h6" color="primary.main">{money(totals.subtotal + totals.tax)}</Typography>
                    </Box>
                </Grid>
                <Grid item xs={12}>
                    <TextField fullWidth multiline rows={2} label="Notes" value={form.notes}
                        onChange={e => setForm({ ...form, notes: e.target.value })}
                        placeholder="Terms, thank-you note, anything printed at the foot" />
                </Grid>
            </FormDialog>

            {/* Printable view */}
            <Dialog open={viewOpen} onClose={() => setViewOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>{viewing?.invoice_no}</DialogTitle>
                <DialogContent>
                    {viewing && (
                        <Box id="invoice-print" sx={{ p: 1 }}>
                            <Box display="flex" justifyContent="space-between" mb={2}>
                                <Box>
                                    {/* Falls back to the gym, not to the vendor. An
                                        install with no branch set was printing
                                        "GYM OS" at the top of its own tax invoice. */}
                                    <Typography variant="h6">{viewing.branch_name || brand.name}</Typography>
                                    {viewing.branch_address && (
                                        <Typography variant="caption" color="text.secondary" display="block">
                                            {viewing.branch_address}
                                        </Typography>
                                    )}
                                    {viewing.branch_gst && (
                                        <Typography variant="caption" color="text.secondary">GSTIN {viewing.branch_gst}</Typography>
                                    )}
                                </Box>
                                <Box textAlign="right">
                                    <Typography variant="body2" fontWeight={700}>{viewing.invoice_no}</Typography>
                                    <Typography variant="caption" color="text.secondary">{fmtDate(viewing.invoice_date)}</Typography>
                                    <Chip size="small" sx={{ mt: 0.5, display: 'block' }} label={viewing.status}
                                        color={STATUS_COLOR[viewing.status]} />
                                </Box>
                            </Box>
                            <Divider sx={{ mb: 2 }} />
                            <Typography variant="caption" color="text.secondary">BILL TO</Typography>
                            <Typography variant="body2" fontWeight={600}>{viewing.customer_name}</Typography>
                            {viewing.member_code && (
                                <Typography variant="caption" color="text.secondary" display="block">
                                    Member ID {viewing.member_code}
                                    {viewing.member_phone ? ` · ${viewing.member_phone}` : ''}
                                </Typography>
                            )}

                            <Table size="small" sx={{ mt: 2 }}>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Item</TableCell>
                                        <TableCell align="right">Qty</TableCell>
                                        <TableCell align="right">Rate</TableCell>
                                        <TableCell align="right">Tax</TableCell>
                                        <TableCell align="right">Amount</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {viewing.items?.map(it => (
                                        <TableRow key={it.id}>
                                            <TableCell>
                                                {it.description}
                                                {it.hsn_sac && (
                                                    <Typography variant="caption" color="text.secondary" display="block">
                                                        HSN/SAC {it.hsn_sac}
                                                    </Typography>
                                                )}
                                            </TableCell>
                                            <TableCell align="right">{Number(it.quantity)}</TableCell>
                                            <TableCell align="right">{money(it.unit_price)}</TableCell>
                                            <TableCell align="right">{it.tax_rate}%</TableCell>
                                            <TableCell align="right">{money(it.line_total)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>

                            <Box mt={2} display="flex" justifyContent="flex-end">
                                <Box textAlign="right">
                                    <Typography variant="body2" color="text.secondary">Subtotal {money(viewing.subtotal)}</Typography>
                                    <Typography variant="body2" color="text.secondary">Tax {money(viewing.tax_amount)}</Typography>
                                    <Typography variant="h6" color="primary.main">{money(viewing.total)}</Typography>
                                </Box>
                            </Box>
                            {viewing.notes && (
                                <>
                                    <Divider sx={{ my: 2 }} />
                                    <Typography variant="caption" color="text.secondary">{viewing.notes}</Typography>
                                </>
                            )}
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setViewOpen(false)}>Close</Button>
                    <Button variant="contained" startIcon={<Print />} onClick={handlePrint}>
                        Print / Save as PDF
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default InvoicesPage;
