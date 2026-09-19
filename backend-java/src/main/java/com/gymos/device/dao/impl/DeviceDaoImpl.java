package com.gymos.device.dao.impl;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.device.dao.DeviceDao;

@Repository
public class DeviceDaoImpl implements DeviceDao {

    private final JdbcTemplate jdbc;

    public DeviceDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<Map<String, Object>> findAll() {
        return jdbc.queryForList("SELECT * FROM devices ORDER BY id DESC");
    }

    @Override
    public Optional<Map<String, Object>> findById(Long id) {
        return jdbc.queryForList("SELECT * FROM devices WHERE id = ?", id).stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> findName(Long id) {
        return jdbc.queryForList("SELECT name FROM devices WHERE id = ?", id).stream().findFirst();
    }

    @Override
    public Map<String, Object> insert(String name, String ipAddress, Integer port, Boolean active) {
        return jdbc.queryForMap("""
            INSERT INTO devices (name, ip_address, port, is_active)
            VALUES (?, ?, ?, ?) RETURNING *""",
            name, ipAddress, port, active);
    }

    @Override
    public Map<String, Object> update(Long id, String name, String ipAddress, Integer port, Boolean active) {
        return jdbc.queryForMap("""
            UPDATE devices SET
                name = COALESCE(?, name),
                ip_address = COALESCE(?, ip_address),
                port = COALESCE(?, port),
                is_active = COALESCE(?, is_active),
                updated_at = NOW()
            WHERE id = ? RETURNING *""", name, ipAddress, port, active, id);
    }

    @Override
    public int delete(Long id) {
        return jdbc.update("DELETE FROM devices WHERE id = ?", id);
    }
}
