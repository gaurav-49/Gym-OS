package com.gymos.diet.dao.impl;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.diet.dao.DietDao;

@Repository
public class DietDaoImpl implements DietDao {

    private final JdbcTemplate jdbc;

    public DietDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<Map<String, Object>> findByMember(Long memberId) {
        return jdbc.queryForList("SELECT * FROM diet_plans WHERE member_id = ? ORDER BY id", memberId);
    }

    @Override
    public Map<String, Object> insert(Long memberId, String meal, String foodItem, Integer calories,
                                      BigDecimal proteinG, BigDecimal carbsG, BigDecimal fatsG, String notes) {
        return jdbc.queryForMap("""
            INSERT INTO diet_plans (member_id, meal, food_item, calories, protein_g, carbs_g, fats_g, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *""",
            memberId, meal, foodItem, calories, proteinG, carbsG, fatsG, notes);
    }

    @Override
    public Map<String, Object> update(Long id, String meal, String foodItem, Integer calories,
                                      BigDecimal proteinG, BigDecimal carbsG, BigDecimal fatsG, String notes) {
        return jdbc.queryForMap("""
            UPDATE diet_plans SET
                meal = COALESCE(?, meal),
                food_item = COALESCE(?, food_item),
                calories = COALESCE(?, calories),
                protein_g = COALESCE(?, protein_g),
                carbs_g = COALESCE(?, carbs_g),
                fats_g = COALESCE(?, fats_g),
                notes = COALESCE(?, notes)
            WHERE id = ? RETURNING *""", meal, foodItem, calories, proteinG, carbsG, fatsG, notes, id);
    }

    @Override
    public int delete(Long id) {
        return jdbc.update("DELETE FROM diet_plans WHERE id = ?", id);
    }
}
