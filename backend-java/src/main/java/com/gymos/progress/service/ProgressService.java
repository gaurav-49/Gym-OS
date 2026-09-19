package com.gymos.progress.service;

import java.util.List;
import java.util.Map;

/**
 * Member progress tracking service — mirrors progressController.js.
 */
public interface ProgressService {

    List<Map<String, Object>> list(Long memberId);

    Map<String, Object> create(Map<String, Object> body);

    Map<String, Object> delete(Long id);
}
