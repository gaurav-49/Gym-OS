package com.gymos.inventory.service.impl;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.gymos.common.api.BusinessException;
import com.gymos.common.audit.AuditService;
import com.gymos.common.util.Body;
import com.gymos.common.util.Dates;
import com.gymos.common.util.PaymentModes;
import com.gymos.inventory.dao.InventoryDao;
import com.gymos.inventory.service.InventoryService;

@Service
public class InventoryServiceImpl implements InventoryService {

    private static final List<String> CATEGORIES =
        List.of("Supplement", "Beverage", "Apparel", "Equipment", "Accessory", "Other");

    private static final int MAX_SALE_QTY = 1000;
    private static final int MAX_STOCK_ADJUSTMENT = 100_000;

    private final InventoryDao inventoryDao;
    private final AuditService audit;
    private final TransactionTemplate tx;

    public InventoryServiceImpl(InventoryDao inventoryDao, AuditService audit, TransactionTemplate tx) {
        this.inventoryDao = inventoryDao;
        this.audit = audit;
        this.tx = tx;
    }

    // ---- products ------------------------------------------------------------

    @Override
    public List<Map<String, Object>> listProducts(String category, String search, String lowStock) {
        return inventoryDao.findProducts(category, search, "true".equals(lowStock));
    }

    @Override
    public Map<String, Object> createProduct(Map<String, Object> body) {
        String name = Body.str(body, "name");
        if (name == null || name.isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Product name is required");
        }
        String category = Body.str(body, "category");
        requireCategory(category);
        BigDecimal cost = nonNegative(body, "cost_price");
        BigDecimal sale = nonNegative(body, "sale_price");
        BigDecimal tax = nonNegative(body, "tax_rate");
        Integer stock = nonNegativeInt(body, "stock_qty");
        Integer reorder = nonNegativeInt(body, "reorder_level");

        String sku = normalizeSku(Body.str(body, "sku"));
        if (sku != null) {
            inventoryDao.findProductBySku(sku, null).ifPresent(clash -> {
                throw new BusinessException(HttpStatus.CONFLICT,
                    "SKU " + sku + " is already used by \"" + clash.get("name") + "\".");
            });
        }

        Map<String, Object> product = inventoryDao.insertProduct(sku, name.trim(),
            category == null || category.isBlank() ? "Supplement" : category,
            orZero(cost), orZero(sale), orZero(tax),
            stock == null ? 0 : stock, reorder == null ? 0 : reorder);
        audit.record("create", "inventory", product.get("id"),
            "Added product \"" + product.get("name") + "\" (" + product.get("stock_qty") + " in stock)");
        return product;
    }

    @Override
    public Map<String, Object> updateProduct(Long id, Map<String, Object> body) {
        String name = body.containsKey("name") ? Body.str(body, "name") : null;
        if (body.containsKey("name") && (name == null || name.isBlank())) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Product name is required");
        }
        String category = body.containsKey("category") ? Body.str(body, "category") : null;
        if (body.containsKey("category")) {
            requireCategory(category);
        }
        BigDecimal cost = nonNegative(body, "cost_price");
        BigDecimal sale = nonNegative(body, "sale_price");
        BigDecimal tax = nonNegative(body, "tax_rate");
        Integer stock = nonNegativeInt(body, "stock_qty");
        Integer reorder = nonNegativeInt(body, "reorder_level");

        Map<String, Object> existing = inventoryDao.findProductById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Product not found"));

        String sku = body.containsKey("sku") ? normalizeSku(Body.str(body, "sku")) : null;
        if (sku != null && !sku.equals(String.valueOf(existing.get("sku")))) {
            inventoryDao.findProductBySku(sku, id).ifPresent(clash -> {
                throw new BusinessException(HttpStatus.CONFLICT,
                    "SKU " + sku + " is already used by \"" + clash.get("name") + "\".");
            });
        }

        Map<String, Object> updated = inventoryDao.updateProduct(id, sku,
            name == null ? null : name.trim(), category, cost, sale, tax, stock, reorder,
            body.containsKey("is_active") ? Body.bool(body, "is_active") : null);
        audit.record("update", "inventory", id, "Updated product \"" + updated.get("name") + "\"");
        return updated;
    }

    @Override
    public Map<String, Object> restock(Long id, Map<String, Object> body) {
        Integer qty = wholeNumber(body.get("quantity"));
        if (qty == null || qty == 0 || qty < -MAX_STOCK_ADJUSTMENT || qty > MAX_STOCK_ADJUSTMENT) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "quantity must be a non-zero whole number (negative to correct an overcount)");
        }
        Map<String, Object> existing = inventoryDao.findProductById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Product not found"));

        int current = intOf(existing.get("stock_qty"));
        String name = String.valueOf(existing.get("name"));
        if (current + qty < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Cannot remove " + Math.abs(qty) + " — only " + current + " of \"" + name + "\" in stock.");
        }

        Map<String, Object> updated = inventoryDao.adjustStock(id, qty);
        audit.record("restock", "inventory", id,
            (qty > 0 ? "Added " : "Removed ") + Math.abs(qty) + " × \"" + name + "\""
                + " (now " + updated.get("stock_qty") + ")");

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Stock for \"" + name + "\" updated to " + updated.get("stock_qty") + ".");
        out.put("product", updated);
        return out;
    }

    @Override
    public Map<String, Object> deleteProduct(Long id) {
        Map<String, Object> existing = inventoryDao.findProductById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Product not found"));
        String name = String.valueOf(existing.get("name"));

        // Deleting a product with sales history would erase revenue from the
        // books — deactivating keeps the history and stops new sales.
        int sales = inventoryDao.countSalesOf(id);
        if (sales > 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "\"" + name + "\" has " + sales + " sale(s) on record — deactivate it instead so the"
                    + " history stays intact.");
        }
        inventoryDao.deleteProduct(id);
        audit.record("delete", "inventory", id, "Deleted product \"" + name + "\"");

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Product \"" + name + "\" deleted.");
        out.put("product", existing);
        return out;
    }

    // ---- sales ---------------------------------------------------------------

    @Override
    public List<Map<String, Object>> listSales(String from, String to, Long memberId, Long productId) {
        requireDate("from", from);
        requireDate("to", to);
        return inventoryDao.findSales(from, to, memberId, productId);
    }

    @Override
    public Map<String, Object> sell(Map<String, Object> body, Long soldBy) {
        Long productId = Body.toLong(body.get("product_id"));
        if (productId == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "product_id is required");
        }
        Integer qty = wholeNumber(body.get("quantity"));
        if (qty == null || qty < 1 || qty > MAX_SALE_QTY) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "quantity must be a whole number between 1 and " + MAX_SALE_QTY);
        }
        String method = Body.str(body, "method");
        if (method != null && !method.isBlank() && !PaymentModes.isValid(method)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, PaymentModes.ERROR);
        }
        String saleDate = Body.str(body, "sale_date");
        requireDate("sale_date", saleDate);
        // The stock decrement happens now, so a future sale date books the money
        // into a period the stock movement never appears in.
        String saleFuture = Dates.futureError("sale date", saleDate);
        if (saleFuture != null) throw new BusinessException(HttpStatus.BAD_REQUEST, saleFuture);
        BigDecimal overridePrice = nonNegative(body, "unit_price");
        Long memberId = Body.toLong(body.get("member_id"));

        // Everything below runs in one transaction: the row lock, the stock
        // check, the sale insert and the decrement.
        Map<String, Object> result = tx.execute(status -> {
            Map<String, Object> product = inventoryDao.lockProduct(productId).orElseThrow(() ->
                new BusinessException(HttpStatus.NOT_FOUND, "Product not found"));
            String name = String.valueOf(product.get("name"));

            if (Boolean.FALSE.equals(product.get("is_active"))) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "\"" + name + "\" is discontinued and cannot be sold.");
            }
            int stock = intOf(product.get("stock_qty"));
            if (stock < qty) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "Only " + stock + " of \"" + name + "\" left in stock — cannot sell " + qty + ".");
            }
            if (memberId != null && !inventoryDao.memberExists(memberId)) {
                throw new BusinessException(HttpStatus.NOT_FOUND, "Member not found");
            }

            BigDecimal price = overridePrice != null ? overridePrice : decimalOf(product.get("sale_price"));
            BigDecimal net = price.multiply(BigDecimal.valueOf(qty));
            BigDecimal taxRate = decimalOf(product.get("tax_rate"));
            BigDecimal tax = net.multiply(taxRate).divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP);
            BigDecimal total = net.add(tax).setScale(2, RoundingMode.HALF_UP);

            Map<String, Object> sale = inventoryDao.insertSale(productId, memberId, qty, price, tax, total,
                method == null || method.isBlank() ? "Cash" : method, soldBy,
                saleDate == null || saleDate.isBlank() ? null : saleDate);
            Map<String, Object> updated = inventoryDao.adjustStock(productId, -qty);

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("message", "Sold " + qty + " × " + name + " for ₹" + total + ".");
            out.put("sale", sale);
            out.put("product", updated);
            out.put("_auditName", name);
            out.put("_auditTotal", total);
            return out;
        });

        Map<String, Object> product = castMap(result.get("product"));
        audit.record("sell", "inventory", productId,
            "Sold " + qty + " × \"" + result.get("_auditName") + "\" for ₹" + result.get("_auditTotal")
                + " (" + product.get("stock_qty") + " left)");
        result.remove("_auditName");
        result.remove("_auditTotal");
        return result;
    }

    @Override
    public Map<String, Object> deleteSale(Long id) {
        Map<String, Object> result = tx.execute(status -> {
            Map<String, Object> sale = inventoryDao.findSaleById(id).orElseThrow(() ->
                new BusinessException(HttpStatus.NOT_FOUND, "Sale not found"));
            inventoryDao.deleteSale(id);
            Map<String, Object> product = inventoryDao.adjustStock(
                Body.toLong(sale.get("product_id")), intOf(sale.get("quantity")));

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("message", "Sale reversed — " + sale.get("quantity") + " unit(s) returned to stock.");
            out.put("sale", sale);
            out.put("product", product);
            return out;
        });
        Map<String, Object> sale = castMap(result.get("sale"));
        Map<String, Object> product = castMap(result.get("product"));
        audit.record("delete", "inventory", id,
            "Reversed sale #" + id + " — " + sale.get("quantity") + " × \"" + product.get("name")
                + "\" returned to stock");
        return result;
    }

    // ---- helpers -------------------------------------------------------------

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Object v) {
        return (Map<String, Object>) v;
    }

    private static void requireCategory(String category) {
        if (category != null && !category.isBlank() && !CATEGORIES.contains(category)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "category must be one of: " + String.join(", ", CATEGORIES));
        }
    }

    private static void requireDate(String field, String value) {
        if (value != null && !value.isBlank() && !Dates.isValidDateString(value)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                field + " must be a valid date in YYYY-MM-DD format");
        }
    }

    private static BigDecimal nonNegative(Map<String, Object> body, String field) {
        Object raw = body.get(field);
        if (raw == null || String.valueOf(raw).isBlank()) {
            return null;
        }
        BigDecimal value = Body.toDecimal(raw);
        if (value == null || value.signum() < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                field + " must be a non-negative number");
        }
        return value;
    }

    private static Integer nonNegativeInt(Map<String, Object> body, String field) {
        Object raw = body.get(field);
        if (raw == null || String.valueOf(raw).isBlank()) {
            return null;
        }
        Integer value = wholeNumber(raw);
        if (value == null || value < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                field + " must be a non-negative whole number");
        }
        return value;
    }

    /** Whole numbers only — 2.5 units of stock is a mistake, not a rounding case. */
    private static Integer wholeNumber(Object v) {
        if (v == null || String.valueOf(v).isBlank()) {
            return null;
        }
        try {
            BigDecimal n = new BigDecimal(String.valueOf(v));
            return n.stripTrailingZeros().scale() > 0 ? null : n.intValueExact();
        } catch (ArithmeticException | NumberFormatException e) {
            return null;
        }
    }

    private static String normalizeSku(String sku) {
        return sku == null || sku.isBlank() ? null : sku.trim().toUpperCase();
    }

    private static BigDecimal orZero(BigDecimal v) {
        return v == null ? BigDecimal.ZERO : v;
    }

    private static BigDecimal decimalOf(Object v) {
        BigDecimal d = Body.toDecimal(v);
        return d == null ? BigDecimal.ZERO : d;
    }

    private static int intOf(Object v) {
        return v instanceof Number n ? n.intValue() : 0;
    }
}
