package com.gymos.referrals.dao.impl;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.referrals.dao.ReferralDao;

@Repository
public class ReferralDaoImpl implements ReferralDao {

    private final JdbcTemplate jdbc;

    public ReferralDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String SELECT = """
        SELECT r.*, ref.name AS referrer_name, ref.member_code AS referrer_code,
               ref.referral_code, conv.name AS converted_member_name,
               conv.member_code AS converted_member_code, u.name AS created_by_name
        FROM referrals r
        JOIN clients ref ON ref.id = r.referrer_id
        LEFT JOIN clients conv ON conv.id = r.converted_member_id
        LEFT JOIN users u ON u.id = r.created_by""";

    @Override
    public List<Map<String, Object>> findReferrals(Long referrerId, String status, int limit) {
        List<String> where = new ArrayList<>();
        List<Object> values = new ArrayList<>();
        if (referrerId != null) {
            values.add(referrerId);
            where.add("r.referrer_id = ?");
        }
        if (status != null && !status.isBlank()) {
            values.add(status);
            where.add("r.status = ?");
        }
        values.add(limit);
        String sql = SELECT
            + (where.isEmpty() ? "" : "\nWHERE " + String.join(" AND ", where))
            + "\nORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'joined' THEN 1 ELSE 2 END,"
            + " r.created_at DESC\nLIMIT ?";
        return jdbc.queryForList(sql, values.toArray());
    }

    @Override
    public Optional<Map<String, Object>> findById(Long id) {
        return jdbc.queryForList(SELECT + "\nWHERE r.id = ?", id).stream().findFirst();
    }

    @Override
    public Map<String, Object> insert(Long referrerId, String referredName, String referredPhone,
                                      String referredEmail, Long leadId, String rewardType,
                                      BigDecimal rewardValue, String notes, Long createdBy) {
        return jdbc.queryForMap("""
            INSERT INTO referrals (referrer_id, referred_name, referred_phone, referred_email, lead_id,
                                   reward_type, reward_value, notes, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *""",
            referrerId, referredName, referredPhone, referredEmail, leadId,
            rewardType, rewardValue, notes, createdBy);
    }

    @Override
    public Map<String, Object> update(Long id, String status, Long convertedMemberId, String rewardType,
                                      BigDecimal rewardValue, String notes, boolean payingReward) {
        return jdbc.queryForMap("""
            UPDATE referrals SET
                status = COALESCE(?, status),
                converted_member_id = COALESCE(?, converted_member_id),
                reward_type = COALESCE(?, reward_type),
                reward_value = COALESCE(?, reward_value),
                notes = COALESCE(?, notes),
                reward_paid_on = CASE WHEN ? THEN CURRENT_DATE ELSE reward_paid_on END
            WHERE id = ? RETURNING *""",
            status, convertedMemberId, rewardType, rewardValue, notes, payingReward, id);
    }

    @Override
    public Optional<Map<String, Object>> delete(Long id) {
        return jdbc.queryForList("DELETE FROM referrals WHERE id = ? RETURNING *", id)
            .stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> findByReferralCode(String code) {
        return jdbc.queryForList(
            "SELECT id, name, member_code, referral_code FROM clients WHERE UPPER(referral_code) = UPPER(?)",
            code).stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> findMember(Long memberId) {
        // phone is here so the service can tell a member referring a friend from a
        // member referring themselves. Without it that check read null and passed.
        return jdbc.queryForList("""
            SELECT id, name, member_code, phone, status, membership_expiry, referral_code
            FROM clients WHERE id = ?""", memberId).stream().findFirst();
    }

    @Override
    public Map<String, Object> extendMembership(Long memberId, int days) {
        // Extend from the later of today and the current expiry, so rewarding an
        // already-lapsed member does not silently back-date their new expiry.
        return jdbc.queryForMap("""
            UPDATE clients
            SET membership_expiry = GREATEST(COALESCE(membership_expiry, CURRENT_DATE), CURRENT_DATE)
                                    + ?::int
            WHERE id = ? RETURNING id, name, membership_expiry""", days, memberId);
    }

    @Override
    public List<Map<String, Object>> topReferrers(int limit) {
        return jdbc.queryForList("""
            SELECT c.id, c.name, c.member_code, c.referral_code,
                   COUNT(r.id)::int AS referrals,
                   COUNT(r.id) FILTER (WHERE r.status = 'joined' OR r.status = 'rewarded')::int AS converted,
                   COALESCE(SUM(r.reward_value) FILTER (WHERE r.status = 'rewarded'), 0)::float8 AS rewarded_value
            FROM referrals r
            JOIN clients c ON c.id = r.referrer_id
            GROUP BY c.id
            ORDER BY converted DESC, referrals DESC, c.name
            LIMIT ?""", limit);
    }

    @Override
    public Map<String, Object> counts() {
        return jdbc.queryForMap("""
            SELECT
                COUNT(*)::int                                              AS total,
                COUNT(*) FILTER (WHERE status = 'pending')::int            AS pending,
                COUNT(*) FILTER (WHERE status = 'joined')::int             AS joined,
                COUNT(*) FILTER (WHERE status = 'rewarded')::int           AS rewarded,
                COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - 30)::int AS last_30_days
            FROM referrals""");
    }

    @Override
    public Optional<Map<String, Object>> findOpenInviteByPhone(Long referrerId, String phone) {
        String digits = phone == null ? "" : phone.replaceAll("\\D", "");
        if (referrerId == null || digits.isEmpty()) {
            return Optional.empty();
        }
        // Compared on digits alone: "98765 43210" and "+91 9876543210" are one
        // number, and a member typing it a second time is not a new friend.
        return jdbc.queryForList(SELECT
            + "\nWHERE r.referrer_id = ?"
            + "\n  AND REGEXP_REPLACE(COALESCE(r.referred_phone, ''), '[^0-9]', '', 'g') = ?"
            + "\n  AND r.status <> 'lapsed'"
            + "\nORDER BY r.id DESC LIMIT 1", referrerId, digits)
            .stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> findByConvertedMember(Long memberId) {
        if (memberId == null) {
            return Optional.empty();
        }
        return jdbc.queryForList(SELECT + "\nWHERE r.converted_member_id = ? ORDER BY r.id DESC LIMIT 1",
            memberId).stream().findFirst();
    }

    @Override
    public List<Map<String, Object>> findUnredeemedRewards(Long referrerId) {
        if (referrerId == null) {
            return List.of();
        }
        // Earned (reward_paid_on set) but never spent. Days-type rewards are
        // settled the moment they are paid by extending the membership, so
        // they must not queue up here as a discount as well.
        return jdbc.queryForList(SELECT
            + "\nWHERE r.referrer_id = ?"
            + "\n  AND r.status = 'rewarded'"
            + "\n  AND r.reward_paid_on IS NOT NULL"
            + "\n  AND r.redeemed_on IS NULL"
            + "\n  AND r.reward_type <> 'days'"
            + "\n  AND r.reward_value > 0"
            + "\nORDER BY r.reward_paid_on, r.id", referrerId);
    }

    @Override
    public void markRedeemed(List<Long> referralIds) {
        if (referralIds == null || referralIds.isEmpty()) {
            return;
        }
        // An explicit IN list rather than ANY(?): JdbcTemplate binds a Long[]
        // as one opaque parameter, and Postgres answers "op ANY/ALL (array)
        // requires array on right side". Building the placeholders is less
        // clever and actually works.
        String placeholders = String.join(",", java.util.Collections.nCopies(referralIds.size(), "?"));
        jdbc.update("UPDATE referrals SET redeemed_on = CURRENT_DATE WHERE id IN (" + placeholders + ")",
            referralIds.toArray());
    }

    @Override
    public void setReferredBy(Long memberId, Long referrerId) {
        jdbc.update("UPDATE clients SET referred_by_id = ? WHERE id = ?", referrerId, memberId);
    }

    @Override
    public Map<String, String> rewardSettings() {
        java.util.Map<String, String> out = new java.util.LinkedHashMap<>();
        for (Map<String, Object> row : jdbc.queryForList(
                "SELECT key, value FROM settings WHERE key LIKE 'referral_%'")) {
            out.put(String.valueOf(row.get("key")).substring("referral_".length()),
                row.get("value") == null ? "" : String.valueOf(row.get("value")));
        }
        return out;
    }
}
