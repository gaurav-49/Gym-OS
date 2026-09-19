package com.gymos.diet.service;

import java.util.List;
import java.util.Map;

/**
 * Diet / nutrition plan service — mirrors dietController.js.
 */
public interface DietService {

    List<Map<String, Object>> list(Long memberId);

    Map<String, Object> create(Map<String, Object> body);

    Map<String, Object> update(Long id, Map<String, Object> body);

    Map<String, Object> delete(Long id);
}
