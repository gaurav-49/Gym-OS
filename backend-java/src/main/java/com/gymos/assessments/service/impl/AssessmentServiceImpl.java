package com.gymos.assessments.service.impl;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.gymos.assessments.dao.AssessmentDao;
import com.gymos.assessments.dao.impl.AssessmentDaoImpl;
import com.gymos.assessments.service.AssessmentService;
import com.gymos.common.api.BusinessException;
import com.gymos.common.audit.AuditService;
import com.gymos.common.util.Body;
import com.gymos.common.util.Dates;

@Service
public class AssessmentServiceImpl implements AssessmentService {

    private static final int DEFAULT_LIMIT = 200;
    private static final int MAX_LIMIT = 1000;

    /**
     * Sane physiological bounds. These are not medical limits — they exist to
     * catch a decimal-point slip (a 700 kg member, 3% body fat) before it lands
     * in a chart the trainer shows the member.
     */
    private static final Map<String, BigDecimal[]> BOUNDS = Map.ofEntries(
        Map.entry("weight_kg", range(20, 400)),
        Map.entry("height_cm", range(80, 260)),
        Map.entry("body_fat_pct", range(2, 70)),
        Map.entry("muscle_mass_kg", range(5, 200)),
        Map.entry("visceral_fat", range(0, 60)),
        Map.entry("bmi", range(8, 90)),
        Map.entry("chest_cm", range(40, 200)),
        Map.entry("waist_cm", range(30, 200)),
        Map.entry("hip_cm", range(40, 220)),
        Map.entry("arm_cm", range(10, 100)),
        Map.entry("thigh_cm", range(20, 120)));

    /** Metrics where a smaller number is an improvement. */
    private static final List<String> LOWER_IS_BETTER =
        List.of("body_fat_pct", "visceral_fat", "waist_cm", "bmi");

    private static BigDecimal[] range(int lo, int hi) {
        return new BigDecimal[] { BigDecimal.valueOf(lo), BigDecimal.valueOf(hi) };
    }

    private final AssessmentDao assessmentDao;
    private final AuditService audit;

    public AssessmentServiceImpl(AssessmentDao assessmentDao, AuditService audit) {
        this.assessmentDao = assessmentDao;
        this.audit = audit;
    }

    @Override
    public List<Map<String, Object>> list(Long memberId, String from, String to, String limit) {
        requireDate("from", from);
        requireDate("to", to);
        return assessmentDao.findAssessments(memberId, from, to, clamp(limit));
    }

    @Override
    public Map<String, Object> memberProgress(Long memberId) {
        if (!assessmentDao.memberExists(memberId)) {
            throw new BusinessException(HttpStatus.NOT_FOUND, "Member not found");
        }
        List<Map<String, Object>> history = assessmentDao.findForMember(memberId);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("member_id", memberId);
        out.put("history", history);
        out.put("count", history.size());

        if (history.size() >= 2) {
            Map<String, Object> first = history.get(0);
            Map<String, Object> previous = history.get(history.size() - 2);
            Map<String, Object> latest = history.get(history.size() - 1);
            out.put("latest", latest);
            // Two deltas: against the very first assessment (the story the member
            // wants) and against the previous one (what changed since last time).
            out.put("change_since_first", deltas(first, latest));
            out.put("change_since_previous", deltas(previous, latest));
        } else if (history.size() == 1) {
            out.put("latest", history.get(0));
            out.put("change_since_first", Map.of());
            out.put("change_since_previous", Map.of());
        } else {
            out.put("latest", null);
            out.put("change_since_first", Map.of());
            out.put("change_since_previous", Map.of());
        }
        return out;
    }

    /** Per-metric change, with whether that direction counts as an improvement. */
    private static Map<String, Object> deltas(Map<String, Object> from, Map<String, Object> to) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (String metric : AssessmentDaoImpl.MEASURES) {
            BigDecimal a = Body.toDecimal(from.get(metric));
            BigDecimal b = Body.toDecimal(to.get(metric));
            if (a == null || b == null) {
                continue;
            }
            BigDecimal diff = b.subtract(a).setScale(2, RoundingMode.HALF_UP);
            if (diff.signum() == 0) {
                continue;
            }
            boolean improved = LOWER_IS_BETTER.contains(metric) ? diff.signum() < 0 : diff.signum() > 0;
            out.put(metric, Map.of("from", a, "to", b, "change", diff, "improved", improved));
        }
        return out;
    }

    @Override
    public Map<String, Object> create(Map<String, Object> body, Long assessedBy) {
        Long memberId = Body.toLong(body.get("member_id"));
        if (memberId == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "member_id is required");
        }
        if (!assessmentDao.memberExists(memberId)) {
            throw new BusinessException(HttpStatus.NOT_FOUND, "Member not found");
        }
        String assessedOn = Body.str(body, "assessed_on");
        requireDate("assessed_on", assessedOn);

        Map<String, BigDecimal> measures = readMeasures(body);
        deriveBmi(measures);
        Integer restingHr = readRestingHr(body);

        Map<String, Object> assessment = assessmentDao.insert(measures, memberId,
            blankToNull(assessedOn), restingHr, Body.str(body, "notes"), assessedBy);
        audit.record("create", "assessments", assessment.get("id"),
            "Recorded assessment for member #" + memberId + " on " + assessment.get("assessed_on"));
        return assessment;
    }

    @Override
    public Map<String, Object> update(Long id, Map<String, Object> body) {
        assessmentDao.findById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Assessment not found"));

        Map<String, BigDecimal> measures = readMeasures(body);
        deriveBmi(measures);
        Map<String, Object> updated = assessmentDao.update(id, measures, readRestingHr(body),
            body.containsKey("notes") ? Body.str(body, "notes") : null)
            .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "Assessment not found"));
        audit.record("update", "assessments", id, "Updated assessment #" + id);
        return updated;
    }

    @Override
    public Map<String, Object> delete(Long id) {
        Map<String, Object> assessment = assessmentDao.delete(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Assessment not found"));
        audit.record("delete", "assessments", id, "Deleted assessment #" + id);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Assessment removed.");
        out.put("assessment", assessment);
        return out;
    }

    // ---- helpers -------------------------------------------------------------

    private static Map<String, BigDecimal> readMeasures(Map<String, Object> body) {
        Map<String, BigDecimal> measures = new LinkedHashMap<>();
        for (String metric : AssessmentDaoImpl.MEASURES) {
            Object raw = body.get(metric);
            if (raw == null || String.valueOf(raw).isBlank()) {
                continue;
            }
            BigDecimal value = Body.toDecimal(raw);
            if (value == null) {
                throw new BusinessException(HttpStatus.BAD_REQUEST, metric + " must be a number");
            }
            BigDecimal[] bounds = BOUNDS.get(metric);
            if (bounds != null
                && (value.compareTo(bounds[0]) < 0 || value.compareTo(bounds[1]) > 0)) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    metric + " must be between " + bounds[0].toPlainString()
                        + " and " + bounds[1].toPlainString());
            }
            measures.put(metric, value);
        }
        return measures;
    }

    /**
     * BMI is computed from height and weight rather than accepted from the
     * caller, so the three numbers on the record can never contradict each other.
     * An explicitly supplied BMI is kept only when height or weight is missing.
     */
    private static void deriveBmi(Map<String, BigDecimal> measures) {
        BigDecimal weight = measures.get("weight_kg");
        BigDecimal height = measures.get("height_cm");
        if (weight == null || height == null || height.signum() <= 0) {
            return;
        }
        BigDecimal metres = height.divide(BigDecimal.valueOf(100), 4, RoundingMode.HALF_UP);
        BigDecimal bmi = weight.divide(metres.multiply(metres), 2, RoundingMode.HALF_UP);
        measures.put("bmi", bmi);
    }

    private static Integer readRestingHr(Map<String, Object> body) {
        Object raw = body.get("resting_hr");
        if (raw == null || String.valueOf(raw).isBlank()) {
            return null;
        }
        int hr = Body.toInt(raw);
        if (hr < 25 || hr > 250) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "resting_hr must be between 25 and 250");
        }
        return hr;
    }

    private static void requireDate(String field, String value) {
        if (value != null && !value.isBlank() && !Dates.isValidDateString(value)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                field + " must be a valid date in YYYY-MM-DD format");
        }
        // An assessment is a measurement that was taken, not one that is
        // planned — and a future one sorts above the real latest reading.
        if (Dates.isFuture(value)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "An assessment cannot be dated in the future (" + Dates.friendly(value) + ").");
        }
    }

    private static String blankToNull(String v) {
        return v == null || v.isBlank() ? null : v;
    }

    private static int clamp(String raw) {
        if (raw == null || raw.isBlank()) {
            return DEFAULT_LIMIT;
        }
        try {
            return Math.min(MAX_LIMIT, Math.max(1, Integer.parseInt(raw.trim())));
        } catch (NumberFormatException e) {
            return DEFAULT_LIMIT;
        }
    }
}
