package com.gymos.branding.dao.impl;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.branding.dao.BrandingDao;

@Repository
public class BrandingDaoImpl implements BrandingDao {

    private static final String PREFIX = "brand_";

    private final JdbcTemplate jdbc;

    public BrandingDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Map<String, String> load() {
        Map<String, String> out = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbc.queryForList(
                "SELECT key, value FROM settings WHERE key LIKE ?", PREFIX + "%")) {
            String key = String.valueOf(row.get("key")).substring(PREFIX.length());
            out.put(key, row.get("value") == null ? "" : String.valueOf(row.get("value")));
        }
        return out;
    }

    @Override
    public void save(String key, String value) {
        jdbc.update("""
            INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value""",
            PREFIX + key, value == null ? "" : value);
    }
}
