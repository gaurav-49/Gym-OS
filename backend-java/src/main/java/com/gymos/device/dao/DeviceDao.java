package com.gymos.device.dao;

import java.util.List;
import java.util.Map;
import java.util.Optional;

public interface DeviceDao {

    List<Map<String, Object>> findAll();

    Optional<Map<String, Object>> findById(Long id);

    Optional<Map<String, Object>> findName(Long id);

    Map<String, Object> insert(String name, String ipAddress, Integer port, Boolean active);

    Map<String, Object> update(Long id, String name, String ipAddress, Integer port, Boolean active);

    int delete(Long id);
}
