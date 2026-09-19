package com.gymos.inventory.dao.impl;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.inventory.dao.InventoryDao;

@Repository
public class InventoryDaoImpl implements InventoryDao {

    private static final int SALES_LIMIT = 500;

    private final JdbcTemplate jdbc;

    public InventoryDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<Map<String, Object>> findProducts(String category, String search, boolean lowStockOnly) {
        List<String> where = new ArrayList<>();
        List<Object> values = new ArrayList<>();
        if (isSet(category)) {
            values.add(category);
            where.add("category = ?");
        }
        if (isSet(search)) {
            String like = "%" + search.toLowerCase() + "%";
            values.add(like);
            values.add(like);
            where.add("(LOWER(name) LIKE ? OR LOWER(COALESCE(sku, '')) LIKE ?)");
        }
        if (lowStockOnly) {
            where.add("stock_qty <= reorder_level");
        }
        // needs_reorder and unit_margin are derived here so the list, the
        // dashboard and any export all agree on the same definition.
        String sql = """
            SELECT *, (stock_qty <= reorder_level) AS needs_reorder,
                   (sale_price - cost_price) AS unit_margin
            FROM products"""
            + (where.isEmpty() ? "" : "\nWHERE " + String.join(" AND ", where))
            + "\nORDER BY is_active DESC, name";
        return values.isEmpty() ? jdbc.queryForList(sql) : jdbc.queryForList(sql, values.toArray());
    }

    private static boolean isSet(String v) {
        return v != null && !v.isBlank();
    }

    @Override
    public Optional<Map<String, Object>> findProductById(Long id) {
        return jdbc.queryForList("SELECT * FROM products WHERE id = ?", id).stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> lockProduct(Long id) {
        return jdbc.queryForList("SELECT * FROM products WHERE id = ? FOR UPDATE", id).stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> findProductBySku(String sku, Long excludeId) {
        if (excludeId == null) {
            return jdbc.queryForList("SELECT id, name FROM products WHERE UPPER(sku) = ?", sku)
                .stream().findFirst();
        }
        return jdbc.queryForList("SELECT id, name FROM products WHERE UPPER(sku) = ? AND id <> ?", sku, excludeId)
            .stream().findFirst();
    }

    @Override
    public Map<String, Object> insertProduct(String sku, String name, String category, BigDecimal costPrice,
                                             BigDecimal salePrice, BigDecimal taxRate, int stockQty,
                                             int reorderLevel) {
        return jdbc.queryForMap("""
            INSERT INTO products (sku, name, category, cost_price, sale_price, tax_rate, stock_qty, reorder_level)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *""",
            sku, name, category, costPrice, salePrice, taxRate, stockQty, reorderLevel);
    }

    @Override
    public Map<String, Object> updateProduct(Long id, String sku, String name, String category, BigDecimal costPrice,
                                             BigDecimal salePrice, BigDecimal taxRate, Integer stockQty,
                                             Integer reorderLevel, Boolean isActive) {
        return jdbc.queryForMap("""
            UPDATE products SET
                sku = COALESCE(?, sku), name = COALESCE(?, name), category = COALESCE(?, category),
                cost_price = COALESCE(?, cost_price), sale_price = COALESCE(?, sale_price),
                tax_rate = COALESCE(?, tax_rate), stock_qty = COALESCE(?, stock_qty),
                reorder_level = COALESCE(?, reorder_level), is_active = COALESCE(?, is_active)
            WHERE id = ? RETURNING *""",
            sku, name, category, costPrice, salePrice, taxRate, stockQty, reorderLevel, isActive, id);
    }

    @Override
    public Map<String, Object> adjustStock(Long id, int delta) {
        return jdbc.queryForMap(
            "UPDATE products SET stock_qty = stock_qty + ? WHERE id = ? RETURNING *", delta, id);
    }

    @Override
    public void deleteProduct(Long id) {
        jdbc.update("DELETE FROM products WHERE id = ?", id);
    }

    @Override
    public int countSalesOf(Long productId) {
        Integer n = jdbc.queryForObject(
            "SELECT COUNT(*)::int FROM product_sales WHERE product_id = ?", Integer.class, productId);
        return n == null ? 0 : n;
    }

    @Override
    public List<Map<String, Object>> findSales(String from, String to, Long memberId, Long productId) {
        List<String> where = new ArrayList<>();
        List<Object> values = new ArrayList<>();
        if (isSet(from)) {
            values.add(from);
            where.add("s.sale_date >= ?");
        }
        if (isSet(to)) {
            values.add(to);
            where.add("s.sale_date <= ?");
        }
        if (memberId != null) {
            values.add(memberId);
            where.add("s.member_id = ?");
        }
        if (productId != null) {
            values.add(productId);
            where.add("s.product_id = ?");
        }
        String sql = """
            SELECT s.*, p.name AS product_name, p.sku, c.name AS member_name, c.member_code, u.name AS sold_by_name
            FROM product_sales s
            JOIN products p ON p.id = s.product_id
            LEFT JOIN clients c ON c.id = s.member_id
            LEFT JOIN users u ON u.id = s.sold_by"""
            + (where.isEmpty() ? "" : "\nWHERE " + String.join(" AND ", where))
            + "\nORDER BY s.sale_date DESC, s.id DESC\nLIMIT " + SALES_LIMIT;
        return values.isEmpty() ? jdbc.queryForList(sql) : jdbc.queryForList(sql, values.toArray());
    }

    @Override
    public Optional<Map<String, Object>> findSaleById(Long id) {
        return jdbc.queryForList("SELECT * FROM product_sales WHERE id = ?", id).stream().findFirst();
    }

    @Override
    public Map<String, Object> insertSale(Long productId, Long memberId, int quantity, BigDecimal unitPrice,
                                          BigDecimal taxAmount, BigDecimal total, String method, Long soldBy,
                                          String saleDate) {
        return jdbc.queryForMap("""
            INSERT INTO product_sales (product_id, member_id, quantity, unit_price, tax_amount, total,
                                       method, sold_by, sale_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?::date, CURRENT_DATE)) RETURNING *""",
            productId, memberId, quantity, unitPrice, taxAmount, total, method, soldBy, saleDate);
    }

    @Override
    public void deleteSale(Long id) {
        jdbc.update("DELETE FROM product_sales WHERE id = ?", id);
    }

    @Override
    public boolean memberExists(Long memberId) {
        Integer n = jdbc.queryForObject("SELECT COUNT(*)::int FROM clients WHERE id = ?", Integer.class, memberId);
        return n != null && n > 0;
    }
}
