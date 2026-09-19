package com.gymos.inventory.dao;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Products the gym stocks, and the counter sales made against them. */
public interface InventoryDao {

    List<Map<String, Object>> findProducts(String category, String search, boolean lowStockOnly);

    Optional<Map<String, Object>> findProductById(Long id);

    /**
     * The product row locked with {@code SELECT … FOR UPDATE}. Held until the
     * surrounding transaction commits, so a second concurrent sale of the last
     * unit waits and then sees the decremented stock.
     */
    Optional<Map<String, Object>> lockProduct(Long id);

    Optional<Map<String, Object>> findProductBySku(String sku, Long excludeId);

    Map<String, Object> insertProduct(String sku, String name, String category, BigDecimal costPrice,
                                      BigDecimal salePrice, BigDecimal taxRate, int stockQty, int reorderLevel);

    Map<String, Object> updateProduct(Long id, String sku, String name, String category, BigDecimal costPrice,
                                      BigDecimal salePrice, BigDecimal taxRate, Integer stockQty,
                                      Integer reorderLevel, Boolean isActive);

    Map<String, Object> adjustStock(Long id, int delta);

    void deleteProduct(Long id);

    int countSalesOf(Long productId);

    // ---- sales ----

    List<Map<String, Object>> findSales(String from, String to, Long memberId, Long productId);

    Optional<Map<String, Object>> findSaleById(Long id);

    Map<String, Object> insertSale(Long productId, Long memberId, int quantity, BigDecimal unitPrice,
                                   BigDecimal taxAmount, BigDecimal total, String method, Long soldBy,
                                   String saleDate);

    void deleteSale(Long id);

    boolean memberExists(Long memberId);
}
