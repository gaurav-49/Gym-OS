package com.gymos.lookup.dao.impl;

import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.lookup.dao.LookupDao;

@Repository
public class LookupDaoImpl implements LookupDao {

    private final JdbcTemplate jdbc;

    public LookupDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<Map<String, Object>> listExceptions(String module) {
        String sql = """
            SELECT id, code, module, field_name, field_label, message,
                   format_message, is_mandatory, input_type, allowed_chars,
                   severity, sort_order
            FROM exceptions
            WHERE is_active = TRUE%s
            ORDER BY sort_order, id""".formatted(module != null && !module.isBlank() ? " AND module = ?" : "");
        return module != null && !module.isBlank() ? jdbc.queryForList(sql, module.trim()) : jdbc.queryForList(sql);
    }
}
