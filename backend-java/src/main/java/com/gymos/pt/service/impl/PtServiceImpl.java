package com.gymos.pt.service.impl;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.gymos.common.api.BusinessException;
import com.gymos.common.audit.AuditService;
import com.gymos.common.util.Body;
import com.gymos.common.util.Dates;
import com.gymos.common.util.PaymentModes;
import com.gymos.pt.dao.PtDao;
import com.gymos.pt.service.PtService;

@Service
public class PtServiceImpl implements PtService {

    private static final List<String> SUB_STATUSES = List.of("active", "completed", "expired", "cancelled");
    private static final int MAX_VALIDITY_DAYS = 1095; // three years
    private static final int DEFAULT_VALIDITY_DAYS = 90;

    private final PtDao ptDao;
    private final AuditService audit;
    private final TransactionTemplate tx;

    public PtServiceImpl(PtDao ptDao, AuditService audit, TransactionTemplate tx) {
        this.ptDao = ptDao;
        this.audit = audit;
        this.tx = tx;
    }

    // ---- packages ------------------------------------------------------------

    @Override
    public List<Map<String, Object>> listPackages(String active) {
        return ptDao.findPackages("true".equals(active));
    }

    @Override
    public Map<String, Object> createPackage(Map<String, Object> body) {
        String name = Body.str(body, "name");
        if (name == null || name.isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Package name is required");
        }
        // Personal training is sold by duration, like membership: a term of the
        // trainer's time. There is no per-session product, so a plan never
        // carries a count of visits — the column survives only so packages sold
        // before the change keep their history.
        String planType = requirePlanType(body);
        Integer sessions = null;
        BigDecimal price = Body.toDecimal(body.get("price"));
        if (price == null || price.signum() < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "price must be a non-negative number");
        }
        Integer validity = optionalValidity(body);
        BigDecimal percent = optionalPercent(body);

        String trimmed = name.trim();
        ptDao.findPackageByName(trimmed).ifPresent(clash -> {
            throw new BusinessException(HttpStatus.CONFLICT,
                "A package named \"" + trimmed + "\" already exists.");
        });

        Map<String, Object> pkg = ptDao.insertPackage(trimmed, planType, sessions, price,
            validity == null ? durationOf(planType) : validity,
            percent == null ? BigDecimal.ZERO : percent);
        audit.record("create", "pt", pkg.get("id"),
            "Added PT plan \"" + pkg.get("name") + "\" — " + planType + " at ₹" + price);
        return pkg;
    }

    @Override
    public Map<String, Object> updatePackage(Long id, Map<String, Object> body) {
        BigDecimal price = null;
        if (body.get("price") != null && !String.valueOf(body.get("price")).isBlank()) {
            price = Body.toDecimal(body.get("price"));
            if (price == null || price.signum() < 0) {
                throw new BusinessException(HttpStatus.BAD_REQUEST, "price must be a non-negative number");
            }
        }
        BigDecimal percent = optionalPercent(body);
        Integer validity = optionalValidity(body);
        String name = body.containsKey("name") ? Body.str(body, "name") : null;

        String planType = body.containsKey("plan_type") ? requirePlanType(body) : null;
        // Written out rather than folded into a ternary: mixing durationOf's
        // primitive int with a nullable Integer makes Java unbox the Integer,
        // so an update that named neither a term nor a validity — "just make
        // this package inactive" — threw a NullPointerException and came back
        // as a 500.
        Integer effectiveValidity = validity;
        if (effectiveValidity == null && planType != null) {
            effectiveValidity = Integer.valueOf(durationOf(planType));
        }
        Map<String, Object> updated = ptDao.updatePackage(id,
            name == null ? null : name.trim(), planType, null, price,
            effectiveValidity, percent,
            body.containsKey("is_active") ? Body.bool(body, "is_active") : null)
            .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "Package not found"));
        audit.record("update", "pt", id, "Updated PT package \"" + updated.get("name") + "\"");
        return updated;
    }

    @Override
    public Map<String, Object> deletePackage(Long id) {
        Map<String, Object> pkg = ptDao.findPackageById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Package not found"));
        String name = String.valueOf(pkg.get("name"));

        int subs = ptDao.countSubscriptionsOf(id);
        if (subs > 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "\"" + name + "\" has " + subs + " subscription(s) — deactivate it instead so the"
                    + " history stays intact.");
        }
        ptDao.deletePackage(id);
        audit.record("delete", "pt", id, "Deleted PT package \"" + name + "\"");

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Package \"" + name + "\" deleted.");
        out.put("package", pkg);
        return out;
    }

    // ---- subscriptions -------------------------------------------------------

    @Override
    public List<Map<String, Object>> listSubscriptions(Long memberId, Long trainerId, String status) {
        if (status != null && !status.isBlank() && !SUB_STATUSES.contains(status)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "status must be one of: " + String.join(", ", SUB_STATUSES));
        }
        return ptDao.findSubscriptions(memberId, trainerId, status);
    }

    @Override
    public Map<String, Object> sellSubscription(Map<String, Object> body) {
        Long memberId = Body.toLong(body.get("member_id"));
        if (memberId == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "member_id is required");
        }
        Long packageId = Body.toLong(body.get("package_id"));
        if (packageId == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "package_id is required");
        }
        String method = Body.str(body, "method");
        if (!PaymentModes.isValid(method)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, PaymentModes.ERROR);
        }
        String startDate = Body.str(body, "start_date");
        if (startDate != null && !startDate.isBlank() && !Dates.isValidDateString(startDate)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "start_date must be a valid date in YYYY-MM-DD format");
        }
        BigDecimal override = null;
        if (body.get("price") != null && !String.valueOf(body.get("price")).isBlank()) {
            override = Body.toDecimal(body.get("price"));
            if (override == null || override.signum() < 0) {
                throw new BusinessException(HttpStatus.BAD_REQUEST, "price must be a non-negative number");
            }
        }
        Long trainerId = Body.toLong(body.get("trainer_id"));
        BigDecimal finalOverride = override;

        // Subscription + ledger payment + commission all commit together, or
        // none of them do. In 1.0 these three were impossible to reconcile.
        Map<String, Object> result = tx.execute(status -> {
            Map<String, Object> member = ptDao.findMember(memberId).orElseThrow(() ->
                new BusinessException(HttpStatus.NOT_FOUND, "Member not found"));
            String memberName = String.valueOf(member.get("name"));
            if (!"active".equals(String.valueOf(member.get("status")))) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    memberName + " is inactive — reactivate the membership first.");
            }

            Map<String, Object> pkg = ptDao.findPackageById(packageId).orElseThrow(() ->
                new BusinessException(HttpStatus.NOT_FOUND, "Package not found"));
            String packageName = String.valueOf(pkg.get("name"));
            if (Boolean.FALSE.equals(pkg.get("is_active"))) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "\"" + packageName + "\" is no longer offered.");
            }

            Map<String, Object> trainer = null;
            if (trainerId != null) {
                trainer = ptDao.findTrainer(trainerId).orElseThrow(() ->
                    new BusinessException(HttpStatus.NOT_FOUND, "Trainer not found"));
            }

            // One live package at a time — otherwise sessions burn against
            // whichever row is found first, which nobody can reason about.
            ptDao.findActiveSubscription(memberId).ifPresent(live -> {
                throw new BusinessException(HttpStatus.CONFLICT,
                    memberName + " already has an active PT package."
                        + " Complete or cancel it before selling another.");
            });

            String start = startDate == null || startDate.isBlank() ? Dates.todayStr() : startDate;
            int validityDays = intOf(pkg.get("validity_days"), DEFAULT_VALIDITY_DAYS);
            String expiry = Dates.addDays(start, validityDays);
            // What is sold is the term. Even a package left over from the
            // session era sells as its term now, so nothing new ever carries a
            // count that could run out mid-plan.
            Integer sessions = null;
            BigDecimal amount = finalOverride != null ? finalOverride : decimalOf(pkg.get("price"));

            Map<String, Object> sub = ptDao.insertSubscription(memberId, packageId, trainerId,
                sessions, amount, start, expiry);
            Long subId = Body.toLong(sub.get("id"));

            // Money in — the same ledger the membership payments use.
            if (amount.signum() > 0) {
                ptDao.insertPayment(memberId, amount, start,
                    method == null || method.isBlank() ? "Cash" : method, "PT package: " + packageName,
                    subId, packageName, start, expiry);
            }

            // Trainer commission, pending until the payroll run pays it.
            Map<String, Object> commission = null;
            BigDecimal percent = decimalOf(pkg.get("trainer_commission_percent"));
            if (trainerId != null && percent.signum() > 0 && amount.signum() > 0) {
                BigDecimal commissionAmount = amount.multiply(percent)
                    .divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP);
                commission = ptDao.insertCommission(trainerId, subId, memberId, amount, percent,
                    commissionAmount, start);
            }

            String trainerName = trainer == null ? null : String.valueOf(trainer.get("name"));
            String planType = pkg.get("plan_type") == null ? "" : String.valueOf(pkg.get("plan_type"));
            String message = packageName + " sold to " + memberName + " — "
                + (planType.isBlank() ? "" : planType.toLowerCase() + " plan, ")
                + "valid until " + expiry + ".";
            if (commission != null) {
                message += " ₹" + commission.get("amount") + " commission booked for " + trainerName + ".";
            }

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("message", message);
            out.put("subscription", sub);
            out.put("commission", commission);
            out.put("_auditSummary", "Sold \"" + packageName + "\" ("
                + (sessions == null ? planType : sessions + " sessions") + ") to "
                + memberName + " for ₹" + amount
                + (commission == null ? "" : " — ₹" + commission.get("amount") + " commission to " + trainerName));
            out.put("_subId", subId);
            return out;
        });

        audit.record("sell", "pt", result.get("_subId"), String.valueOf(result.get("_auditSummary")));
        result.remove("_auditSummary");
        result.remove("_subId");
        return result;
    }

    @Override
    public Map<String, Object> updateSubscription(Long id, Map<String, Object> body) {
        String status = body.containsKey("status") ? Body.str(body, "status") : null;
        if (status != null && !SUB_STATUSES.contains(status)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "status must be one of: " + String.join(", ", SUB_STATUSES));
        }
        Long trainerId = Body.toLong(body.get("trainer_id"));

        ptDao.findSubscriptionById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Subscription not found"));
        if (trainerId != null) {
            ptDao.findTrainer(trainerId).orElseThrow(() ->
                new BusinessException(HttpStatus.NOT_FOUND, "Trainer not found"));
        }
        Map<String, Object> updated = ptDao.updateSubscription(id, status, trainerId);
        audit.record("update", "pt", id, "PT subscription #" + id + " → " + updated.get("status"));
        return updated;
    }

    /**
     * How long a PT plan runs. Deliberately the same vocabulary as the gym's
     * own membership plans — a member buying "3 months of training" should not
     * have to think about a different set of words for the same idea.
     */
    private static final java.util.Map<String, Integer> PLAN_DURATIONS = java.util.Map.of(
        "Monthly", 30, "Quarterly", 90, "Half-Yearly", 180, "Yearly", 365);

    private static final java.util.List<String> PLAN_ORDER =
        java.util.List.of("Monthly", "Quarterly", "Half-Yearly", "Yearly");

    private static String requirePlanType(Map<String, Object> body) {
        String raw = Body.str(body, "plan_type");
        if (raw == null || raw.isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "plan_type is required — one of: " + String.join(", ", PLAN_ORDER));
        }
        for (String known : PLAN_ORDER) {
            if (known.equalsIgnoreCase(raw.trim())) {
                return known;
            }
        }
        throw new BusinessException(HttpStatus.BAD_REQUEST,
            "plan_type must be one of: " + String.join(", ", PLAN_ORDER));
    }

    private static int durationOf(String planType) {
        return PLAN_DURATIONS.getOrDefault(planType, DEFAULT_VALIDITY_DAYS);
    }


    // ---- sessions ------------------------------------------------------------

    @Override
    public Map<String, Object> logSession(Long subscriptionId, Map<String, Object> body) {
        String sessionDate = Body.str(body, "session_date");
        if (sessionDate != null && !sessionDate.isBlank() && !Dates.isValidDateString(sessionDate)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "session_date must be a valid date in YYYY-MM-DD format");
        }
        String sessionTime = Body.str(body, "session_time");
        String notes = Body.str(body, "notes");

        Map<String, Object> result = tx.execute(status -> {
            // Locked so two trainers logging at once cannot both burn the last session.
            Map<String, Object> sub = ptDao.lockSubscription(subscriptionId).orElseThrow(() ->
                new BusinessException(HttpStatus.NOT_FOUND, "Subscription not found"));

            String subStatus = String.valueOf(sub.get("status"));
            String packageName = String.valueOf(sub.get("package_name"));
            String memberName = String.valueOf(sub.get("member_name"));
            int used = intOf(sub.get("sessions_used"), 0);
            // A session is a record of what the trainer delivered, not a token
            // being spent. The member bought a term, so the term is the only
            // thing that can run out — packages sold before the change keep
            // their old count in the column, but it no longer stops anybody
            // training on a plan they have paid for and not yet used up.
            if (!"active".equals(subStatus)) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "This plan is " + subStatus + " — no more sessions can be logged.");
            }
            // A session has to fall inside the term the member paid for. The
            // expiry check below asks whether the plan is live TODAY, which says
            // nothing about a session_date typed as 2030 — or as last year.
            if (sessionDate != null && !sessionDate.isBlank()) {
                Object subStart = sub.get("start_date");
                Object subEnd = sub.get("expiry_date");
                if (subStart != null && sessionDate.compareTo(String.valueOf(subStart)) < 0) {
                    throw new BusinessException(HttpStatus.BAD_REQUEST,
                        "That session date is before the plan started ("
                            + Dates.friendly(String.valueOf(subStart)) + ").");
                }
                if (subEnd != null && sessionDate.compareTo(String.valueOf(subEnd)) > 0) {
                    throw new BusinessException(HttpStatus.BAD_REQUEST,
                        "That session date is after the plan ends ("
                            + Dates.friendly(String.valueOf(subEnd)) + ").");
                }
                String sessFuture = Dates.futureError("session date", sessionDate);
                if (sessFuture != null) throw new BusinessException(HttpStatus.BAD_REQUEST, sessFuture);
            }

            Object expiry = sub.get("expiry_date");
            if (expiry != null && String.valueOf(expiry).compareTo(Dates.todayStr()) < 0) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "\"" + packageName + "\" expired on " + expiry + ". Sell a new package to continue.");
            }

            Map<String, Object> session = ptDao.insertSession(subscriptionId,
                Body.toLong(sub.get("trainer_id")),
                sessionDate == null || sessionDate.isBlank() ? null : sessionDate,
                sessionTime == null || sessionTime.isBlank() ? null : sessionTime, notes);

            int nextUsed = used + 1;
            // A plan ends when its term does, never on a count.
            Map<String, Object> updated = ptDao.setSessionsUsed(subscriptionId, nextUsed, "active");

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("message", "Session logged for " + memberName
                + " — " + packageName + " runs to " + sub.get("expiry_date") + ".");
            out.put("session", session);
            out.put("subscription", updated);
            out.put("_auditSummary", "Logged PT session " + nextUsed + " for " + memberName);
            return out;
        });

        audit.record("session", "pt", subscriptionId, String.valueOf(result.get("_auditSummary")));
        result.remove("_auditSummary");
        return result;
    }

    @Override
    public List<Map<String, Object>> listSessions(Long subscriptionId) {
        return ptDao.findSessions(subscriptionId);
    }

    // ---- commissions ---------------------------------------------------------

    @Override
    public List<Map<String, Object>> listCommissions(Long trainerId, String status) {
        if (status != null && !status.isBlank() && !List.of("pending", "paid").contains(status)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "status must be pending or paid");
        }
        return ptDao.findCommissions(trainerId, status);
    }

    // ---- helpers -------------------------------------------------------------

    private static Integer optionalValidity(Map<String, Object> body) {
        Object raw = body.get("validity_days");
        if (raw == null || String.valueOf(raw).isBlank()) {
            return null;
        }
        Integer validity = wholeNumber(raw);
        if (validity == null || validity < 1 || validity > MAX_VALIDITY_DAYS) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "validity_days must be a whole number between 1 and " + MAX_VALIDITY_DAYS);
        }
        return validity;
    }

    private static BigDecimal optionalPercent(Map<String, Object> body) {
        Object raw = body.get("trainer_commission_percent");
        if (raw == null || String.valueOf(raw).isBlank()) {
            return null;
        }
        BigDecimal percent = Body.toDecimal(raw);
        if (percent == null || percent.signum() < 0 || percent.compareTo(BigDecimal.valueOf(100)) > 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "trainer_commission_percent must be between 0 and 100");
        }
        return percent;
    }

    private static Integer wholeNumber(Object v) {
        if (v == null || String.valueOf(v).isBlank()) {
            return null;
        }
        try {
            BigDecimal n = new BigDecimal(String.valueOf(v));
            return n.stripTrailingZeros().scale() > 0 ? null : n.intValueExact();
        } catch (ArithmeticException | NumberFormatException e) {
            return null;
        }
    }

    private static BigDecimal decimalOf(Object v) {
        BigDecimal d = Body.toDecimal(v);
        return d == null ? BigDecimal.ZERO : d;
    }

    private static int intOf(Object v, int fallback) {
        return v instanceof Number n ? n.intValue() : fallback;
    }
}
