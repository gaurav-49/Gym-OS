package com.gymos.progress.dao;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/**
 * Member progress tracking data access. All SQL lives in
 * {@link com.gymos.progress.dao.impl.ProgressDaoImpl}.
 */
public interface ProgressDao {

    List<Map<String, Object>> findByMember(Long memberId);

    Map<String, Object> insert(Long memberId, String recordDate, BigDecimal weight, BigDecimal bodyFat,
                               BigDecimal chest, BigDecimal waist, BigDecimal arms, BigDecimal thighs,
                               BigDecimal shoulders, String notes);

    int delete(Long id);
}
