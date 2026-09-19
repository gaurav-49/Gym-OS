// frontend/src/components/InventoryPage.jsx
// Inventory + counter POS. Two tabs: the stock list (products, margins, reorder
// alerts) and the sales log. Selling decrements stock server-side inside one
// transaction, so the counts here always match what was actually sold.

import React, { useEffect, useState } from 'react';
import {
    Box, Paper, TextField, MenuItem, Chip, IconButton, Tooltip, Button, Tabs, Tab, GridLegacy as Grid, TableCell, Typography, Autocomplete, Divider, } from '@mui/material';
import {
    Add, Edit, Delete, Inventory2, PointOfSale, Warning, Undo, AddShoppingCart, Inbox, ReportProblem, Savings, TrendingUp,
} from '@mui/icons-material';
import api from '../api';
import { log, logError } from '../logger';
import Alerts from './Alerts';
import { PAYMENT_MODES } from '../constants';
import { PageHeader, StatCards, ModuleTable, FormDialog, useExceptions, money, moneyShort, fmtDate, todayStr, useConfirm, useToast } from './ui';

const CATEGORIES = ['Supplement', 'Beverage', 'Apparel', 'Equipment', 'Accessory', 'Other'];

const FALLBACK_RULES = [
    { code: 'E1301', field_name: 'name', field_label: 'Product Name', message: 'PRODUCT NAME IS MANDATORY', is_mandatory: true },
    { code: 'E1302', field_name: 'category', field_label: 'Category', message: 'CATEGORY IS MANDATORY', is_mandatory: true },
    { code: 'E1303', field_name: 'sale_price', field_label: 'Sale Price', message: 'SALE PRICE IS MANDATORY', format_message: 'NUMBER ONLY ALLOWED', is_mandatory: true, allowed_chars: 'numeric' },
];

const emptyForm = {
    sku: '', name: '', category: 'Supplement', cost_price: '0', sale_price: '',
    tax_rate: '0', stock_qty: '0', reorder_level: '0',
};

const InventoryPage = ({ isAdmin }) => {
    const toast = useToast();
    const [tab, setTab] = useState(0);
    const [products, setProducts] = useState([]);
    const [allProducts, setAllProducts] = useState([]);
    // Distinguishes "still loading" from "genuinely empty" — without it the
    // table showed its empty state on every page load.
    const [loading, setLoading] = useState(true);
    const [sales, setSales] = useState([]);
    const [members, setMembers] = useState([]);
    const [search, setSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(emptyForm);
    const [formErrors, setFormErrors] = useState({});
    const [sellOpen, setSellOpen] = useState(false);
    const [sellForm, setSellForm] = useState({ product: null, quantity: '1', member: null, method: 'Cash' });
    const [restockOpen, setRestockOpen] = useState(false);
    const [restockProduct, setRestockProduct] = useState(null);
    const [restockQty, setRestockQty] = useState('10');
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState('');
    const [busy, setBusy] = useState(false);

    const { validate, liveCheck, isRequired } = useExceptions('inventory', FALLBACK_RULES);

    const fetchProducts = async () => {
        try {
            const res = await api.get('/products', { params: { search: search || undefined, category: categoryFilter || undefined } });
            // Tiles summarise the catalogue, not the search. Built from the
            // filtered result, typing in the search box changed the "Products"
            // count and the stock value the tiles reported.
            api.get('/products').then(all => setAllProducts(all.data)).catch(() => setAllProducts([]));
            setProducts(res.data);
            setLoadError('');
        } catch (err) {
            logError('InventoryPage', 'fetchProducts', `✗ ${err.response?.data?.error || err.message}`, err);
            setLoadError(err.response?.data?.error || 'Failed to load products.');
        } finally { setLoading(false); }
    };
    const fetchSales = async () => {
        try {
            const res = await api.get('/product-sales');
            setSales(res.data);
        } catch (err) {
            setLoadError(err.response?.data?.error || 'Failed to load sales.');
        }
    };
    useEffect(() => { fetchProducts(); }, [search, categoryFilter]);
    useEffect(() => { fetchSales(); }, []);
    useEffect(() => {
        api.get('/clients').then(res => setMembers(res.data.filter(m => m.status === 'active'))).catch(() => setMembers([]));
    }, []);

    const openCreate = () => { setEditing(null); setForm(emptyForm); setFormErrors({}); setError(''); setDialogOpen(true); };
    const openEdit = (p) => {
        setEditing(p);
        setForm({
            sku: p.sku || '', name: p.name, category: p.category,
            cost_price: String(p.cost_price), sale_price: String(p.sale_price),
            tax_rate: String(p.tax_rate), stock_qty: String(p.stock_qty), reorder_level: String(p.reorder_level),
        });
        setFormErrors({}); setError(''); setDialogOpen(true);
    };

    const setField = (name, value) => {
        setForm(f => ({ ...f, [name]: value }));
        const next = { ...formErrors };
        delete next[name];
        const live = liveCheck(name, value);
        if (live) next[name] = live;
        setFormErrors(next);
    };

    const handleSave = async () => {
        const errors = validate(form);
        setFormErrors(errors);
        if (Object.keys(errors).length > 0) {
            log('InventoryPage', 'handleSave', `→ validation blocked: ${Object.keys(errors).join(', ')}`);
            return;
        }
        setBusy(true); setError('');
        log('InventoryPage', 'handleSave', `→ ${editing ? 'update' : 'create'} product "${form.name}"`);
        const payload = {
            sku: form.sku || null, name: form.name.trim(), category: form.category,
            cost_price: Number(form.cost_price || 0), sale_price: Number(form.sale_price),
            tax_rate: Number(form.tax_rate || 0), stock_qty: Number(form.stock_qty || 0),
            reorder_level: Number(form.reorder_level || 0),
        };
        try {
            if (editing) {
                await api.put(`/products/${editing.id}`, payload);
                toast.success(`"${payload.name}" updated.`);
            } else {
                await api.post('/products', payload);
                toast.success(`"${payload.name}" added to inventory.`);
            }
            setDialogOpen(false);
            fetchProducts();
        } catch (err) {
            logError('InventoryPage', 'handleSave', `✗ ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to save the product.');
        } finally { setBusy(false); }
    };

    const openSell = (product = null) => {
        setSellForm({ product, quantity: '1', member: null, method: 'Cash' });
        setError('');
        setSellOpen(true);
    };

    const handleSell = async () => {
        if (!sellForm.product) { setError('Pick a product to sell.'); return; }
        const qty = Number(sellForm.quantity);
        if (!Number.isInteger(qty) || qty < 1) { setError('Quantity must be a whole number of 1 or more.'); return; }
        setBusy(true); setError('');
        log('InventoryPage', 'handleSell', `→ sell ${qty} × "${sellForm.product.name}"`);
        try {
            const res = await api.post('/product-sales', {
                product_id: sellForm.product.id, quantity: qty,
                member_id: sellForm.member?.id || null, method: sellForm.method,
            });
            setSellOpen(false);
            toast.success(res.data.message);
            fetchProducts(); fetchSales();
        } catch (err) {
            logError('InventoryPage', 'handleSell', `✗ ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to record the sale.');
        } finally { setBusy(false); }
    };

    const openRestock = (p) => { setRestockProduct(p); setRestockQty('10'); setError(''); setRestockOpen(true); };
    const handleRestock = async () => {
        setBusy(true); setError('');
        try {
            const res = await api.post(`/products/${restockProduct.id}/restock`, { quantity: Number(restockQty) });
            setRestockOpen(false);
            toast.success(res.data.message);
            fetchProducts();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to update stock.');
        } finally { setBusy(false); }
    };

    const confirm = useConfirm();

    const handleDelete = async (p) => {
        if (!await confirm({
            title: `Delete ${p.name}?`,
            body: <>The product and its stock level go; sales already recorded against it are kept.</>,
            confirmLabel: 'Delete product', danger: true,
        })) return;
        setError(''); toast.success('');
        try {
            const res = await api.delete(`/products/${p.id}`);
            toast.success(res.data.message);
            fetchProducts();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to delete the product.');
        }
    };

    const handleReverse = async (sale) => {
        if (!await confirm({
            title: 'Reverse this sale?',
            body: <>The stock goes back on the shelf and the sale comes off today's takings.</>,
            confirmLabel: 'Reverse sale', danger: true,
        })) return;
        setError(''); toast.success('');
        try {
            const res = await api.delete(`/product-sales/${sale.id}`);
            toast.success(res.data.message);
            fetchProducts(); fetchSales();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to reverse the sale.');
        }
    };

    const lowStock = allProducts.filter(p => p.needs_reorder && p.is_active);
    const stockValue = allProducts.reduce((s, p) => s + Number(p.cost_price) * p.stock_qty, 0);
    const today = todayStr();
    const todaySales = sales.filter(s => String(s.sale_date).slice(0, 10) === today);
    const todayRevenue = todaySales.reduce((s, x) => s + Number(x.total), 0);
    const monthRevenue = sales
        .filter(s => String(s.sale_date).slice(0, 7) === today.slice(0, 7))
        .reduce((s, x) => s + Number(x.total), 0);

    const productColumns = [
        { key: 'name', label: 'Product' },
        { key: 'category', label: 'Category' },
        { key: 'cost', label: 'Cost', align: 'right' },
        { key: 'price', label: 'Sale price', align: 'right' },
        { key: 'margin', label: 'Margin', align: 'right' },
        { key: 'stock', label: 'In stock', align: 'right' },
        { key: 'actions', label: 'Actions', align: 'right' },
    ];
    const salesColumns = [
        { key: 'date', label: 'Date' },
        { key: 'product', label: 'Product' },
        { key: 'qty', label: 'Qty', align: 'right' },
        { key: 'total', label: 'Total', align: 'right' },
        { key: 'customer', label: 'Customer' },
        { key: 'method', label: 'Method' },
        { key: 'actions', label: '', align: 'right' },
    ];

    return (
        <Box>
            <Alerts items={[
                error && { severity: 'error', text: error },
                loadError && { severity: 'error', text: loadError },
                lowStock.length > 0 && { severity: 'warning', text: `${lowStock.length} product(s) at or below their reorder level.` },
            ]} />

            <StatCards columns={5} items={[
                { key: 'products', icon: <Inventory2 />, label: 'Products', value: allProducts.filter(p => p.is_active).length, color: 'primary' },
                { key: 'low', icon: <ReportProblem />, label: 'Need reorder', value: lowStock.length, color: lowStock.length ? 'error' : 'success' },
                { key: 'value', icon: <Savings />, label: 'Stock value', value: moneyShort(stockValue), color: 'info', hint: 'at cost' },
                { key: 'today', icon: <PointOfSale />, label: "Today's sales", value: moneyShort(todayRevenue), color: 'success', hint: `${todaySales.length} sale(s)` },
                /* "This month" sat beside "Today's sales" showing a rupee
                   figure and named no metric — ₹ of what? It is the same
                   measure as the tile before it, over a longer window. */
                { key: 'month', icon: <TrendingUp />, label: "This month's sales", value: moneyShort(monthRevenue), color: 'secondary',
                    hint: `${sales.filter(s => String(s.sale_date).slice(0, 7) === today.slice(0, 7)).length} sale(s)` },
            ]} />

            <Paper elevation={3} sx={{ p: 3 }}>
                <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ mb: 2 }}>
                    <Tab icon={<Inventory2 fontSize="small" />} iconPosition="start" label="Stock" />
                    <Tab icon={<PointOfSale fontSize="small" />} iconPosition="start" label={`Sales (${sales.length})`} />
                </Tabs>

                {tab === 0 && (
                    <>
                        <PageHeader
                            icon={Inventory2}
                            title="Inventory"
                            count={products.length}
                            search={search}
                            onSearch={setSearch}
                            searchPlaceholder="Search by name or SKU…"
                            actionLabel={isAdmin ? 'Add product' : undefined}
                            actionIcon={<Add />}
                            onAction={openCreate}
                            extraActions={
                                <>
                                    <TextField select size="small" label="Category" value={categoryFilter}
                                        onChange={e => setCategoryFilter(e.target.value)} sx={{ minWidth: 150 }}>
                                        <MenuItem value="">All categories</MenuItem>
                                        {CATEGORIES.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                                    </TextField>
                                    <Button variant="outlined" startIcon={<AddShoppingCart />} onClick={() => openSell()}>
                                        Sell at counter
                                    </Button>
                                </>
                            }
                        />
                        <ModuleTable
                            loading={loading}columns={productColumns}
                            rows={products}
                            empty={{
                                icon: Inventory2,
                                title: search || categoryFilter ? 'No products match' : 'Nothing stocked yet',
                                hint: search || categoryFilter
                                    ? 'Try a different name or SKU, or clear the category filter.'
                                    : 'Add the drinks, supplements and gear you sell at the counter so sales and stock stay in one place.',
                                actionLabel: !search && !categoryFilter && isAdmin ? 'Add product' : undefined,
                                actionIcon: <Add />,
                                onAction: openCreate,
                            }}
                            renderRow={(p) => (
                                <>
                                    <TableCell>
                                        <Typography variant="body2" fontWeight={600}
                                            sx={{ textDecoration: p.is_active ? 'none' : 'line-through' }}>
                                            {p.name}
                                        </Typography>
                                        {p.sku && <Typography variant="caption" color="text.secondary">SKU {p.sku}</Typography>}
                                    </TableCell>
                                    <TableCell><Chip size="small" variant="outlined" label={p.category} /></TableCell>
                                    <TableCell align="right">{money(p.cost_price)}</TableCell>
                                    <TableCell align="right">
                                        <Typography variant="body2" fontWeight={700}>{money(p.sale_price)}</Typography>
                                        {Number(p.tax_rate) > 0 && (
                                            <Typography variant="caption" color="text.secondary">+{p.tax_rate}% tax</Typography>
                                        )}
                                    </TableCell>
                                    <TableCell align="right">
                                        <Typography variant="body2"
                                            color={Number(p.unit_margin) > 0 ? 'success.main' : 'error.main'} fontWeight={600}>
                                            {money(p.unit_margin)}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="right">
                                        <Chip size="small" label={p.stock_qty}
                                            color={p.needs_reorder ? 'error' : 'default'}
                                            icon={p.needs_reorder ? <Warning fontSize="small" /> : undefined}
                                            title={p.needs_reorder ? `At or below the reorder level of ${p.reorder_level}` : undefined} />
                                    </TableCell>
                                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                        <Button size="small" variant="contained" startIcon={<PointOfSale />}
                                            onClick={() => openSell(p)} disabled={!p.is_active || p.stock_qty < 1}>
                                            Sell
                                        </Button>
                                        {isAdmin && (
                                            <>
                                                <Tooltip title="Adjust stock">
                                                    <IconButton size="small" onClick={() => openRestock(p)}>
                                                        <Inbox fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                                <IconButton size="small" title="Edit" onClick={() => openEdit(p)}>
                                                    <Edit fontSize="small" />
                                                </IconButton>
                                                <IconButton size="small" color="error" title="Delete" onClick={() => handleDelete(p)}>
                                                    <Delete fontSize="small" />
                                                </IconButton>
                                            </>
                                        )}
                                    </TableCell>
                                </>
                            )}
                        />
                    </>
                )}

                {tab === 1 && (
                    <>
                        <PageHeader
                            icon={PointOfSale}
                            title="Counter Sales"
                            count={sales.length}
                            actionLabel="Sell at counter"
                            actionIcon={<AddShoppingCart />}
                            onAction={() => openSell()}
                        />
                        <ModuleTable
                            loading={loading}columns={salesColumns}
                            rows={sales}
                            empty={{
                                icon: PointOfSale,
                                title: 'No counter sales yet',
                                hint: 'Every sale rung up on the Stock tab appears here with its margin, and can be reversed if it was a mistake.',
                            }}
                            renderRow={(s) => (
                                <>
                                    <TableCell>
                                        <Typography variant="caption">{fmtDate(s.sale_date)}</Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="body2" fontWeight={600}>{s.product_name}</Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {money(s.unit_price)} each{Number(s.tax_amount) > 0 ? ` + ${money(s.tax_amount)} tax` : ''}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="right">{s.quantity}</TableCell>
                                    <TableCell align="right">
                                        <Typography variant="body2" fontWeight={700}>{money(s.total)}</Typography>
                                    </TableCell>
                                    <TableCell>
                                        {s.member_name
                                            ? <Typography variant="body2">{s.member_name} <Typography variant="caption" color="text.secondary">· {s.member_code}</Typography></Typography>
                                            : <Typography variant="caption" color="text.secondary">Walk-in</Typography>}
                                    </TableCell>
                                    <TableCell><Chip size="small" variant="outlined" label={s.method} /></TableCell>
                                    <TableCell align="right">
                                        {isAdmin && (
                                            <Tooltip title="Reverse this sale and return the stock">
                                                <IconButton size="small" color="error" onClick={() => handleReverse(s)}>
                                                    <Undo fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        )}
                                    </TableCell>
                                </>
                            )}
                        />
                    </>
                )}
            </Paper>

            {/* Add / edit product */}
            <FormDialog
                open={dialogOpen}
                title={editing ? `Edit Product — ${editing.name}` : 'Add a Product'}
                onClose={() => setDialogOpen(false)}
                errors={formErrors} error={error}
                submitLabel={editing ? 'Save changes' : 'Add product'}
                submitIcon={<Add />} onSubmit={handleSave} busy={busy} maxWidth="md"
            >
                <Grid item xs={12} sm={4}>
                    <TextField fullWidth label="SKU" value={form.sku}
                        onChange={e => setField('sku', e.target.value)} placeholder="e.g. WHEY-1KG"
                        helperText="Optional, must be unique" />
                </Grid>
                <Grid item xs={12} sm={8}>
                    <TextField fullWidth required={isRequired('name')} label="Product Name" value={form.name}
                        error={!!formErrors.name} onChange={e => setField('name', e.target.value)} />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField select fullWidth required={isRequired('category')} label="Category" value={form.category}
                        error={!!formErrors.category} onChange={e => setField('category', e.target.value)}>
                        {CATEGORIES.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                    </TextField>
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField fullWidth type="number" label="Tax Rate (%)" value={form.tax_rate}
                        error={!!formErrors.tax_rate} onChange={e => setField('tax_rate', e.target.value)}
                        inputProps={{ min: 0, max: 100 }} helperText="Added on top at the counter" />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField fullWidth type="number" label="Cost Price (₹)" value={form.cost_price}
                        error={!!formErrors.cost_price} onChange={e => setField('cost_price', e.target.value)}
                        inputProps={{ min: 0 }} />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField fullWidth required={isRequired('sale_price')} type="number" label="Sale Price (₹)"
                        value={form.sale_price} error={!!formErrors.sale_price}
                        onChange={e => setField('sale_price', e.target.value)} inputProps={{ min: 0 }}
                        helperText={form.cost_price && form.sale_price
                            ? `Margin ${money(Number(form.sale_price) - Number(form.cost_price))} per unit`
                            : ' '} />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField fullWidth type="number" label="Stock Quantity" value={form.stock_qty}
                        error={!!formErrors.stock_qty} onChange={e => setField('stock_qty', e.target.value)}
                        inputProps={{ min: 0 }} disabled={!!editing}
                        helperText={editing ? 'Use "Adjust stock" so the change is auditable' : ' '} />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField fullWidth type="number" label="Reorder Level" value={form.reorder_level}
                        error={!!formErrors.reorder_level} onChange={e => setField('reorder_level', e.target.value)}
                        inputProps={{ min: 0 }} helperText="Warn when stock drops to this" />
                </Grid>
            </FormDialog>

            {/* Sell */}
            <FormDialog
                open={sellOpen} title="Sell at the Counter" onClose={() => setSellOpen(false)}
                error={error} submitLabel="Record sale" submitIcon={<PointOfSale />}
                onSubmit={handleSell} busy={busy} maxWidth="xs"
            >
                <Grid item xs={12}>
                    <Autocomplete
                        options={products.filter(p => p.is_active && p.stock_qty > 0)}
                        value={sellForm.product}
                        onChange={(e, v) => setSellForm({ ...sellForm, product: v })}
                        getOptionLabel={(p) => `${p.name} — ${money(p.sale_price)} (${p.stock_qty} left)`}
                        isOptionEqualToValue={(o, v) => o.id === v.id}
                        renderInput={(params) => <TextField {...params} required label="Product" />}
                    />
                </Grid>
                <Grid item xs={6}>
                    <TextField fullWidth required type="number" label="Quantity" value={sellForm.quantity}
                        onChange={e => setSellForm({ ...sellForm, quantity: e.target.value })}
                        inputProps={{ min: 1, max: sellForm.product?.stock_qty || 1000 }} />
                </Grid>
                <Grid item xs={6}>
                    <TextField select fullWidth label="Method" value={sellForm.method}
                        onChange={e => setSellForm({ ...sellForm, method: e.target.value })}>
                        {PAYMENT_MODES.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                    </TextField>
                </Grid>
                <Grid item xs={12}>
                    <Autocomplete
                        options={members}
                        value={sellForm.member}
                        onChange={(e, v) => setSellForm({ ...sellForm, member: v })}
                        getOptionLabel={(m) => `${m.name} (ID ${m.member_code})`}
                        isOptionEqualToValue={(o, v) => o.id === v.id}
                        renderInput={(params) => <TextField {...params} label="Member (optional)" placeholder="Leave blank for a walk-in" />}
                    />
                </Grid>
                {sellForm.product && (
                    <Grid item xs={12}>
                        <Divider sx={{ mb: 1.5 }} />
                        {(() => {
                            const q = Number(sellForm.quantity) || 0;
                            const net = Number(sellForm.product.sale_price) * q;
                            const tax = net * Number(sellForm.product.tax_rate) / 100;
                            return (
                                <Box display="flex" justifyContent="space-between" alignItems="baseline">
                                    <Typography variant="body2" color="text.secondary">
                                        {q} × {money(sellForm.product.sale_price)}
                                        {tax > 0 ? ` + ${money(tax)} tax` : ''}
                                    </Typography>
                                    <Typography variant="h6" color="primary.main">{money(net + tax)}</Typography>
                                </Box>
                            );
                        })()}
                    </Grid>
                )}
            </FormDialog>

            {/* Restock */}
            <FormDialog
                open={restockOpen} title={`Adjust Stock — ${restockProduct?.name || ''}`}
                onClose={() => setRestockOpen(false)} error={error}
                submitLabel="Apply" submitIcon={<Inbox />} onSubmit={handleRestock} busy={busy} maxWidth="xs"
            >
                <Grid item xs={12}>
                    <TextField fullWidth required type="number" label="Quantity change" value={restockQty}
                        onChange={e => setRestockQty(e.target.value)}
                        helperText="Positive to receive stock, negative to correct an overcount" />
                </Grid>
                <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary">
                        Current stock <b>{restockProduct?.stock_qty ?? 0}</b> →
                        {' '}<b>{(restockProduct?.stock_qty ?? 0) + (Number(restockQty) || 0)}</b>
                    </Typography>
                </Grid>
            </FormDialog>
        </Box>
    );
};

export default InventoryPage;
