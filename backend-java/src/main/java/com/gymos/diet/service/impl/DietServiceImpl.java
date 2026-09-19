package com.gymos.diet.service.impl;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.gymos.common.api.BusinessException;
import com.gymos.common.util.Body;
import com.gymos.diet.dao.DietDao;
import com.gymos.diet.service.DietService;
import com.gymos.member.dao.ClientDao;

@Service
public class DietServiceImpl implements DietService {

    private final DietDao dietDao;
    private final ClientDao clientDao;

    public DietServiceImpl(DietDao dietDao, ClientDao clientDao) {
        this.dietDao = dietDao;
        this.clientDao = clientDao;
    }

    @Override
    public List<Map<String, Object>> list(Long memberId) {
        if (memberId == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "member_id query param is required");
        }
        return dietDao.findByMember(memberId);
    }

    @Override
    public Map<String, Object> create(Map<String, Object> body) {
        Long memberId = Body.toLong(body.get("member_id"));
        if (memberId == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "member_id is required");
        }
        if (clientDao.findById(memberId).isEmpty()) {
            throw new BusinessException(HttpStatus.NOT_FOUND, "Member not found");
        }
        return dietDao.insert(memberId, Body.str(body, "meal"), Body.str(body, "food_item"),
            intOrNull(body.get("calories")), num(body.get("protein_g")), num(body.get("carbs_g")),
            num(body.get("fats_g")), Body.str(body, "notes"));
    }

    @Override
    public Map<String, Object> update(Long id, Map<String, Object> body) {
        try {
            return dietDao.update(id,
            Body.containsKey(body, "meal") ? Body.str(body, "meal") : null,
            Body.containsKey(body, "food_item") ? Body.str(body, "food_item") : null,
            Body.containsKey(body, "calories") ? intOrNull(body.get("calories")) : null,
            Body.containsKey(body, "protein_g") ? num(body.get("protein_g")) : null,
            Body.containsKey(body, "carbs_g") ? num(body.get("carbs_g")) : null,
            Body.containsKey(body, "fats_g") ? num(body.get("fats_g")) : null,
            Body.containsKey(body, "notes") ? Body.str(body, "notes") : null);
        } catch (org.springframework.dao.EmptyResultDataAccessException e) {
            throw new BusinessException(HttpStatus.NOT_FOUND, "Diet item not found");
        }
    }

    @Override
    public Map<String, Object> delete(Long id) {
        if (dietDao.delete(id) == 0) {
            throw new BusinessException(HttpStatus.NOT_FOUND, "Diet item not found");
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Diet item deleted");
        return out;
    }

    private static Integer intOrNull(Object v) {
        if (v == null) return null;
        return Body.toInt(v);
    }

    private static BigDecimal num(Object v) {
        if (v == null) return null;
        return v instanceof BigDecimal bd ? bd : Body.toDecimal(v);
    }
}
