package com.gymos.diet.dao;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/**
 * Diet plan data access. All SQL lives in
 * {@link com.gymos.diet.dao.impl.DietDaoImpl}.
 */
public interface DietDao {

    List<Map<String, Object>> findByMember(Long memberId);

    Map<String, Object> insert(Long memberId, String meal, String foodItem, Integer calories,
                               BigDecimal proteinG, BigDecimal carbsG, BigDecimal fatsG, String notes);

    Map<String, Object> update(Long id, String meal, String foodItem, Integer calories,
                               BigDecimal proteinG, BigDecimal carbsG, BigDecimal fatsG, String notes);

    int delete(Long id);
}
