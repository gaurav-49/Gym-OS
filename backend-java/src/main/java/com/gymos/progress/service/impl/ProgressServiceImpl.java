package com.gymos.progress.service.impl;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.gymos.common.api.BusinessException;
import com.gymos.common.util.Body;
import com.gymos.common.util.Dates;
import com.gymos.member.dao.ClientDao;
import com.gymos.progress.dao.ProgressDao;
import com.gymos.progress.service.ProgressService;

@Service
public class ProgressServiceImpl implements ProgressService {

    private final ProgressDao progressDao;
    private final ClientDao clientDao;

    public ProgressServiceImpl(ProgressDao progressDao, ClientDao clientDao) {
        this.progressDao = progressDao;
        this.clientDao = clientDao;
    }

    @Override
    public List<Map<String, Object>> list(Long memberId) {
        if (memberId == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "member_id query param is required");
        }
        return progressDao.findByMember(memberId);
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
        String recordDate = Body.str(body, "record_date");
        if (recordDate != null && !recordDate.isBlank() && !Dates.isValidDateString(recordDate)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "record_date must be a valid date in YYYY-MM-DD format");
        }
        // A measurement is something that was taken, so it cannot be in the
        // future — and a future row sorts to the top of the trend chart, which
        // is where the member reads their "latest" weight from.
        if (Dates.isFuture(recordDate)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "A measurement cannot be dated in the future (" + Dates.friendly(recordDate) + ").");
        }
        // Bounds wide enough for any real person and narrow enough to catch a
        // slipped decimal point. -70 kg and 900 kg both went in happily and
        // then wrecked the scale of the member's weight chart.
        requireRange(body, "weight", 20, 500, "kg");
        requireRange(body, "body_fat", 1, 75, "%");
        for (String girth : List.of("chest", "waist", "arms", "thighs", "shoulders")) {
            requireRange(body, girth, 5, 300, "cm");
        }
        return progressDao.insert(memberId, recordDate,
            num(body.get("weight")), num(body.get("body_fat")), num(body.get("chest")),
            num(body.get("waist")), num(body.get("arms")), num(body.get("thighs")),
            num(body.get("shoulders")), Body.str(body, "notes"));
    }

    /** Rejects a measurement outside what a human body can be. */
    private static void requireRange(Map<String, Object> body, String field,
                                     double min, double max, String unit) {
        Object raw = body.get(field);
        if (raw == null || String.valueOf(raw).isBlank()) {
            return;
        }
        double value;
        try {
            value = Double.parseDouble(String.valueOf(raw).trim());
        } catch (NumberFormatException e) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                field.replace('_', ' ') + " must be a number.");
        }
        if (value < min || value > max) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                field.replace('_', ' ') + " must be between " + trim(min) + " and "
                    + trim(max) + " " + unit + " — check for a misplaced decimal point.");
        }
    }

    private static String trim(double v) {
        return v == Math.floor(v) ? String.valueOf((long) v) : String.valueOf(v);
    }

    @Override
    public Map<String, Object> delete(Long id) {
        if (progressDao.delete(id) == 0) {
            throw new BusinessException(HttpStatus.NOT_FOUND, "Progress record not found");
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Progress record deleted");
        return out;
    }

    private static BigDecimal num(Object v) {
        if (v == null) return null;
        return v instanceof BigDecimal bd ? bd : Body.toDecimal(v);
    }
}
