package com.gymos.inventory.service;

import java.util.List;
import java.util.Map;

/**
 * Inventory and the counter POS.
 *
 * <p>A sale decrements stock in the same transaction that records it, so the
 * two can never drift — and two simultaneous sales of the last unit cannot both
 * succeed.
 */
public interface InventoryService {

    List<Map<String, Object>> listProducts(String category, String search, String lowStock);

    Map<String, Object> createProduct(Map<String, Object> body);

    Map<String, Object> updateProduct(Long id, Map<String, Object> body);

    /** @param body {@code quantity} — negative corrects an overcount */
    Map<String, Object> restock(Long id, Map<String, Object> body);

    Map<String, Object> deleteProduct(Long id);

    List<Map<String, Object>> listSales(String from, String to, Long memberId, Long productId);

    Map<String, Object> sell(Map<String, Object> body, Long soldBy);

    /** Reverses a sale and returns the units to stock. */
    Map<String, Object> deleteSale(Long id);
}
