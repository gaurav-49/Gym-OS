package com.gymos.branches.dao.impl;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.branches.dao.BranchDao;

@Repository
public class BranchDaoImpl implements BranchDao {

    /**
     * Tables that carry a branch_id. Kept in one place so the counts on the
     * Branches page and the delete guard can never disagree — and used as an
     * allow-list, since the table name is interpolated into SQL below.
     */
    public static final Set<String> BRANCHED_TABLES =
        Set.of("clients", "users", "devices", "expenses", "products", "lockers", "invoices");

    private final JdbcTemplate jdbc;

    public BranchDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<Map<String, Object>> findBranches() {
        return jdbc.queryForList("""
            SELECT b.*,
                   (SELECT COUNT(*)::int FROM clients c WHERE c.branch_id = b.id) AS member_count,
                   (SELECT COUNT(*)::int FROM clients c WHERE c.branch_id = b.id AND c.status = 'active') AS active_members,
                   (SELECT COUNT(*)::int FROM users u WHERE u.branch_id = b.id) AS staff_count,
                   (SELECT COUNT(*)::int FROM devices d WHERE d.branch_id = b.id) AS device_count
            FROM branches b
            ORDER BY b.id""");
    }

    @Override
    public Optional<Map<String, Object>> findById(Long id) {
        return jdbc.queryForList("SELECT * FROM branches WHERE id = ?", id).stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> findClash(String code, String name) {
        return jdbc.queryForList(
            "SELECT id, name, code FROM branches WHERE UPPER(code) = ? OR LOWER(name) = LOWER(?)",
            code, name).stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> findByNameExcluding(String name, Long excludeId) {
        return jdbc.queryForList(
            "SELECT id FROM branches WHERE LOWER(name) = LOWER(?) AND id <> ?",
            name, excludeId).stream().findFirst();
    }

    @Override
    public Map<String, Object> insert(String name, String code, String address, String phone,
                                      String email, String gstNumber) {
        return jdbc.queryForMap("""
            INSERT INTO branches (name, code, address, phone, email, gst_number)
            VALUES (?, ?, ?, ?, ?, ?) RETURNING *""",
            name, code, address, phone, email, gstNumber);
    }

    @Override
    public Map<String, Object> update(Long id, String name, String address, String phone,
                                      String email, String gstNumber, Boolean isActive) {
        return jdbc.queryForMap("""
            UPDATE branches SET
                name = COALESCE(?, name), address = COALESCE(?, address), phone = COALESCE(?, phone),
                email = COALESCE(?, email), gst_number = COALESCE(?, gst_number),
                is_active = COALESCE(?, is_active)
            WHERE id = ? RETURNING *""",
            name, address, phone, email, gstNumber, isActive, id);
    }

    @Override
    public void delete(Long id) {
        jdbc.update("DELETE FROM branches WHERE id = ?", id);
    }

    @Override
    public int countRowsIn(String table, Long branchId) {
        // The table name cannot be a bind parameter, so it must come from the
        // allow-list above — never from anything a caller supplied.
        if (!BRANCHED_TABLES.contains(table)) {
            throw new IllegalArgumentException("not a branched table: " + table);
        }
        Integer n = jdbc.queryForObject(
            "SELECT COUNT(*)::int FROM " + table + " WHERE branch_id = ?", Integer.class, branchId);
        return n == null ? 0 : n;
    }
}
