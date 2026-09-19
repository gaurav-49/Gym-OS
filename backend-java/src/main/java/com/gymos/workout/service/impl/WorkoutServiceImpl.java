package com.gymos.workout.service.impl;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.gymos.common.api.BusinessException;
import com.gymos.common.util.Body;
import com.gymos.member.dao.ClientDao;
import com.gymos.workout.dao.WorkoutDao;
import com.gymos.workout.service.WorkoutService;

@Service
public class WorkoutServiceImpl implements WorkoutService {

    private final WorkoutDao workoutDao;
    private final ClientDao clientDao;

    public WorkoutServiceImpl(WorkoutDao workoutDao, ClientDao clientDao) {
        this.workoutDao = workoutDao;
        this.clientDao = clientDao;
    }

    @Override
    public List<Map<String, Object>> list(Long memberId) {
        if (memberId == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "member_id query param is required");
        }
        return workoutDao.findByMember(memberId);
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
        return workoutDao.insert(memberId, Body.str(body, "day"), Body.str(body, "exercise"),
            intOrNull(body.get("sets")), intOrNull(body.get("reps")), num(body.get("weight")),
            intOrNull(body.get("rest_seconds")), Body.str(body, "notes"));
    }

    @Override
    public Map<String, Object> update(Long id, Map<String, Object> body) {
        try {
            return workoutDao.update(id,
            Body.containsKey(body, "day") ? Body.str(body, "day") : null,
            Body.containsKey(body, "exercise") ? Body.str(body, "exercise") : null,
            Body.containsKey(body, "sets") ? intOrNull(body.get("sets")) : null,
            Body.containsKey(body, "reps") ? intOrNull(body.get("reps")) : null,
            Body.containsKey(body, "weight") ? num(body.get("weight")) : null,
            Body.containsKey(body, "rest_seconds") ? intOrNull(body.get("rest_seconds")) : null,
            Body.containsKey(body, "notes") ? Body.str(body, "notes") : null);
        } catch (org.springframework.dao.EmptyResultDataAccessException e) {
            throw new BusinessException(HttpStatus.NOT_FOUND, "Workout not found");
        }
    }

    @Override
    public Map<String, Object> delete(Long id) {
        if (workoutDao.delete(id) == 0) {
            throw new BusinessException(HttpStatus.NOT_FOUND, "Workout not found");
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Workout deleted");
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
