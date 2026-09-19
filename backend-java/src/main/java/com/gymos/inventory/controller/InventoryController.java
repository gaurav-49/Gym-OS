package com.gymos.inventory.controller;

import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.gymos.common.security.AuthUser;
import com.gymos.inventory.service.InventoryService;

/**
 * Products and the counter POS.
 *
 * <p>Selling is open to any signed-in staff — that is the front desk's job.
 * Changing the catalogue, correcting stock and reversing a sale are admin-only,
 * because each of those rewrites the books.
 */
@RestController
@RequestMapping("/api")
public class InventoryController {

    private final InventoryService inventoryService;

    public InventoryController(InventoryService inventoryService) {
        this.inventoryService = inventoryService;
    }

    @GetMapping("/products")
    public List<Map<String, Object>> listProducts(@RequestParam(required = false) String category,
                                                  @RequestParam(required = false) String search,
                                                  @RequestParam(name = "low_stock", required = false) String lowStock) {
        return inventoryService.listProducts(category, search, lowStock);
    }

    @PostMapping("/products")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> createProduct(@RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(inventoryService.createProduct(body));
    }

    @PutMapping("/products/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> updateProduct(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return inventoryService.updateProduct(id, body);
    }

    @PostMapping("/products/{id}/restock")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> restock(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return inventoryService.restock(id, body);
    }

    @DeleteMapping("/products/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> deleteProduct(@PathVariable Long id) {
        return inventoryService.deleteProduct(id);
    }

    @GetMapping("/product-sales")
    public List<Map<String, Object>> listSales(@RequestParam(required = false) String from,
                                               @RequestParam(required = false) String to,
                                               @RequestParam(name = "member_id", required = false) Long memberId,
                                               @RequestParam(name = "product_id", required = false) Long productId) {
        return inventoryService.listSales(from, to, memberId, productId);
    }

    @PostMapping("/product-sales")
    public ResponseEntity<Map<String, Object>> sell(@RequestBody Map<String, Object> body,
                                                    @AuthenticationPrincipal AuthUser user) {
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(inventoryService.sell(body, user == null ? null : user.id()));
    }

    @DeleteMapping("/product-sales/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> deleteSale(@PathVariable Long id) {
        return inventoryService.deleteSale(id);
    }
}
