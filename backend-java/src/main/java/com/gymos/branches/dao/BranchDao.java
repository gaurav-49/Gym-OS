package com.gymos.branches.dao;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Multi-branch support — locations a gym operates. */
public interface BranchDao {

    /** Branches with their member / staff / device counts. */
    List<Map<String, Object>> findBranches();

    Optional<Map<String, Object>> findById(Long id);

    /** A branch whose code or name would clash with the one being created. */
    Optional<Map<String, Object>> findClash(String code, String name);

    Optional<Map<String, Object>> findByNameExcluding(String name, Long excludeId);

    Map<String, Object> insert(String name, String code, String address, String phone,
                               String email, String gstNumber);

    Map<String, Object> update(Long id, String name, String address, String phone,
                               String email, String gstNumber, Boolean isActive);

    void delete(Long id);

    /** Rows in {@code table} still pointing at this branch — the delete guard. */
    int countRowsIn(String table, Long branchId);
}
