package com.gymos.integration;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.LocalDate;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

import tools.jackson.databind.JsonNode;

/**
 * End-to-end integration tests for the ported modules: dashboard, master data,
 * devices, payments, classes, notifications, billing, leads, the member portal
 * and the member tabs (progress / workouts / diet). Runs against the shared
 * Testcontainers Postgres with a fresh schema + admin/trainer seed per test.
 */
class ModulesApiIntegrationTest extends BaseIntegrationTest {

    private String clientJson(String code, String name, String phone, String expiry) {
        return "{\"member_code\":\"" + code + "\",\"name\":\"" + name + "\",\"phone\":\"" + phone
            + "\",\"email\":\"" + name.toLowerCase().replaceAll("[^a-z]", "") + "@gym.local\","
            + "\"membership_type\":\"Monthly\",\"membership_start\":\"2026-01-01\","
            + "\"membership_expiry\":\"" + expiry + "\",\"membership_fee\":1000,"
            + "\"amount_paid\":1000,\"payment_mode\":\"Cash\"}";
    }

    private long createClient(String token, String code, String name, String phone, String expiry) throws Exception {
        MvcResult res = mvc.perform(post("/api/clients")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(clientJson(code, name, phone, expiry)))
            .andExpect(status().isCreated())
            .andReturn();
        return om.readTree(res.getResponse().getContentAsString()).get("id").asLong();
    }

    // ---------- dashboard ----------

    @Test
    void dashboardStatsReturnAllAggregates() throws Exception {
        String token = adminToken();
        createClient(token, "101", "Alice", "9990000001", "2099-01-01");
        mvc.perform(get("/api/dashboard/stats").header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.total_members").value(1))
            .andExpect(jsonPath("$.active_members").value(1))
            .andExpect(jsonPath("$.expiring_soon").isNumber())
            .andExpect(jsonPath("$.today_collection").isNumber())
            .andExpect(jsonPath("$.monthly_revenue").isArray());
    }

    // ---------- master data ----------

    @Test
    void exceptionsAndFieldRulesServeMasterData() throws Exception {
        String token = adminToken();
        mvc.perform(get("/api/exceptions?module=members").header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].code").value("E101"))
            .andExpect(jsonPath("$[0].module").value("members"))
            .andExpect(jsonPath("$[0].message").value("MEMBER ID IS MANDATORY"));
        // /field-rules is the legacy alias — same data.
        mvc.perform(get("/api/field-rules?module=members").header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].code").value("E101"));
    }

    // ---------- devices ----------

    @Test
    void devicesCrud() throws Exception {
        String token = adminToken();
        MvcResult created = mvc.perform(post("/api/devices")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Front Gate\",\"ip_address\":\"192.168.1.50\",\"port\":80}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.name").value("Front Gate"))
            .andReturn();
        long id = om.readTree(created.getResponse().getContentAsString()).get("id").asLong();

        mvc.perform(get("/api/devices").header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[?(@.id == " + id + ")]").exists());

        mvc.perform(put("/api/devices/" + id)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Front Gate 2\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.name").value("Front Gate 2"));

        mvc.perform(delete("/api/devices/" + id).header("Authorization", "Bearer " + token))
            .andExpect(status().isOk());
    }

    @Test
    void devicePunchIsPublicAndMarksAttendance() throws Exception {
        String token = adminToken();
        createClient(token, "101", "Alice", "9990000001", "2099-01-01");
        mvc.perform(post("/api/device/punch")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"member_id\":\"101\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.message").exists());
    }

    // ---------- payments ----------

    @Test
    void paymentsFlow() throws Exception {
        String token = adminToken();
        // Alice joins with nothing paid yet → ₹1000 outstanding.
        MvcResult client = mvc.perform(post("/api/clients")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"member_code\":\"101\",\"name\":\"Alice\",\"phone\":\"9990000001\","
                    + "\"membership_type\":\"Monthly\",\"membership_start\":\"2026-01-01\","
                    + "\"membership_expiry\":\"2099-01-01\",\"membership_fee\":1000,"
                    + "\"amount_paid\":0,\"payment_mode\":\"Cash\"}"))
            .andExpect(status().isCreated())
            .andReturn();
        long memberId = om.readTree(client.getResponse().getContentAsString()).get("id").asLong();

        mvc.perform(post("/api/payments")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"member_id\":" + memberId + ",\"amount\":400,\"method\":\"Cash\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.member_id").value(memberId));

        mvc.perform(get("/api/payments?member_id=" + memberId).header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].member_name").value("Alice"));

        // One-click collection of the outstanding balance.
        mvc.perform(post("/api/payments/" + memberId + "/collect")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"method\":\"Cash\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("Dues cleared.")));
    }

    @Test
    void paymentsRejectBadInput() throws Exception {
        String token = adminToken();
        mvc.perform(post("/api/payments")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"member_id\":1,\"amount\":-5}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("member_id and a positive amount are required"));
    }

    // ---------- classes ----------

    @Test
    void classesStaffBookingWaitlistAndPromotion() throws Exception {
        String token = adminToken();
        long alice = createClient(token, "101", "Alice", "9990000001", "2099-01-01");
        long bob = createClient(token, "102", "Bob", "9990000002", "2099-01-01");

        MvcResult cls = mvc.perform(post("/api/classes")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Morning Yoga\",\"trainer_id\":2,"
                    + "\"class_date\":\"" + LocalDate.now().plusDays(1) + "\","
                    + "\"start_time\":\"10:00\",\"end_time\":\"11:00\",\"capacity\":1}"))
            .andExpect(status().isCreated())
            .andReturn();
        long classId = om.readTree(cls.getResponse().getContentAsString()).get("id").asLong();

        mvc.perform(get("/api/classes/trainers").header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[?(@.username == 'trainer')]").exists());

        // First booking fills the single seat.
        mvc.perform(post("/api/classes/" + classId + "/book")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"member_id\":" + alice + "}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.status").value("booked"));

        // Second member goes to the waitlist.
        mvc.perform(post("/api/classes/" + classId + "/book")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"member_id\":" + bob + "}"))
            .andExpect(status().isAccepted())
            .andExpect(jsonPath("$.status").value("waitlisted"));

        // Cancelling Alice promotes Bob from the waitlist.
        mvc.perform(post("/api/classes/" + classId + "/cancel-booking")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"member_id\":" + alice + "}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.promoted").value("Bob"));

        mvc.perform(get("/api/classes/" + classId).header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.bookings[0].member_name").value("Bob"))
            .andExpect(jsonPath("$.booked").value(1));
    }

    @Test
    void memberSelfServiceClasses() throws Exception {
        String token = adminToken();
        createClient(token, "101", "Alice", "9990000001", "2099-01-01");
        mvc.perform(post("/api/classes")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Morning Yoga\",\"trainer_id\":2,"
                    + "\"class_date\":\"" + LocalDate.now().plusDays(1) + "\","
                    + "\"start_time\":\"10:00\",\"capacity\":10}"))
            .andExpect(status().isCreated());

        // Self-service handshake → member JWT.
        // The booking page is a second front door to the same account, so it
        // takes the same credential the portal does — the registered phone is
        // not one. Every member starts on the gym default password.
        MvcResult verify = mvc.perform(post("/api/member/classes/verify")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"member_code\":\"101\",\"password\":\"admin\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.expires_in").value("12h"))
            .andReturn();
        String memberToken = om.readTree(verify.getResponse().getContentAsString()).get("token").asText();

        mvc.perform(get("/api/member/classes").header("Authorization", "Bearer " + memberToken))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].name").value("Morning Yoga"))
            .andExpect(jsonPath("$[0].my_status").value(org.hamcrest.Matchers.nullValue()));

        long classId = om.readTree(mvc.perform(get("/api/member/classes")
                .header("Authorization", "Bearer " + memberToken)).andReturn()
            .getResponse().getContentAsString()).get(0).get("id").asLong();

        mvc.perform(post("/api/member/classes/" + classId + "/book")
                .header("Authorization", "Bearer " + memberToken))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.status").value("booked"));

        mvc.perform(get("/api/member/classes/my").header("Authorization", "Bearer " + memberToken))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].name").value("Morning Yoga"));

        mvc.perform(post("/api/member/classes/" + classId + "/cancel")
                .header("Authorization", "Bearer " + memberToken))
            .andExpect(status().isOk());
    }

    // ---------- notifications ----------

    @Test
    void notificationsSettingsExpiringAndLog() throws Exception {
        String token = adminToken();
        createClient(token, "101", "Alice", "9990000001", LocalDate.now().plusDays(5).toString());

        mvc.perform(get("/api/notifications/settings").header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.expiry_reminder_days").value(7));

        mvc.perform(put("/api/notifications/settings")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"expiry_reminder_days\":10}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.expiry_reminder_days").value(10));

        mvc.perform(get("/api/notifications/expiring?days=10").header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.days").value(10))
            .andExpect(jsonPath("$.members[0].name").value("Alice"))
            .andExpect(jsonPath("$.members[0].reminder_sent").value(false))
            .andExpect(jsonPath("$.members[0].channels_available.email").value(true));

        mvc.perform(get("/api/notifications/log").header("Authorization", "Bearer " + token))
            .andExpect(status().isOk());
    }

    // ---------- billing ----------

    @Test
    void billingOverviewRetryAndMarkPaid() throws Exception {
        String token = adminToken();
        String yesterday = LocalDate.now().minusDays(1).toString();
        long memberId = createClient(token, "101", "Alice", "9990000001", yesterday);

        mvc.perform(get("/api/billing/overview").header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.settings.auto_renew_enabled").value(true));

        // Enable auto-renew with a saved method, then force the charge.
        mvc.perform(put("/api/billing/members/" + memberId)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"auto_renew\":true,\"recurring_method\":\"UPI\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.member.auto_renew").value(true));

        mvc.perform(post("/api/billing/members/" + memberId + "/retry")
                .header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("renewed"))
            .andExpect(jsonPath("$.new_expiry").exists());

        // Manual override renewal.
        mvc.perform(post("/api/billing/members/" + memberId + "/mark-paid")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"method\":\"Cash\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.new_expiry").exists());
    }

    // ---------- leads ----------

    @Test
    void leadsConvertToMember() throws Exception {
        String token = adminToken();
        MvcResult lead = mvc.perform(post("/api/leads")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Ravi Kumar\",\"phone\":\"9990000001\","
                    + "\"interest\":\"Monthly\",\"source\":\"walk-in\"}"))
            .andExpect(status().isCreated())
            .andReturn();
        long leadId = om.readTree(lead.getResponse().getContentAsString()).get("id").asLong();

        mvc.perform(get("/api/leads?status=new").header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].name").value("Ravi Kumar"));

        // Converting is onboarding: the body goes through the same rules as any
        // walk-in, rather than a member being assembled from the enquiry alone.
        mvc.perform(post("/api/leads/" + leadId + "/convert")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"membership_fee\":1000,\"amount_paid\":5000}"))
            .andExpect(status().isBadRequest());

        mvc.perform(post("/api/leads/" + leadId + "/convert")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"membership_fee\":2000,\"amount_paid\":2000,\"payment_mode\":\"Cash\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("ID 1")))
            .andExpect(jsonPath("$.member.status").value("active"))
            .andExpect(jsonPath("$.member.membership_fee").value(2000))
            .andExpect(jsonPath("$.lead.status").value("converted"));

        // Converting again is rejected.
        mvc.perform(post("/api/leads/" + leadId + "/convert")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.containsString("already converted")));
    }

    // ---------- member portal ----------

    @Test
    void memberPortalLoginAndMe() throws Exception {
        String token = adminToken();
        createClient(token, "101", "Alice", "9990000001", "2099-01-01");

        // The registered phone is not a credential — only the password is.
        mvc.perform(post("/api/member/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"member_code\":\"101\",\"password\":\"9990000001\"}"))
            .andExpect(status().isUnauthorized());

        // Every member starts on the gym default, so a brand-new member is in
        // straight away with nothing but the ID the desk gave them.
        MvcResult login = mvc.perform(post("/api/member/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"member_code\":\"101\",\"password\":\"admin\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.qr_payload").value("GYMOS:101"))
            .andExpect(jsonPath("$.password_is_default").value(true))
            .andReturn();
        String memberToken = om.readTree(login.getResponse().getContentAsString()).get("token").asText();

        mvc.perform(get("/api/member/me").header("Authorization", "Bearer " + memberToken))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.name").value("Alice"))
            .andExpect(jsonPath("$.membership_type").value("Monthly"))
            .andExpect(jsonPath("$.qr_payload").value("GYMOS:101"))
            .andExpect(jsonPath("$.payments").isArray());

        // There is no member check-in endpoint at all. A member's own token is
        // the only thing a self check-in would need, so it could be done from
        // anywhere and would prove nothing about who was at the gym; only the
        // staff scanner in the main app writes attendance.
        mvc.perform(post("/api/member/checkin").header("Authorization", "Bearer " + memberToken))
            .andExpect(result ->
                org.junit.jupiter.api.Assertions.assertTrue(
                    result.getResponse().getStatus() >= 400,
                    "member self check-in must not succeed, got "
                        + result.getResponse().getStatus()));
    }

    @Test
    void aMemberCanChangeTheirPasswordOffTheGymDefault() throws Exception {
        String token = adminToken();
        createClient(token, "202", "Bob", "9990000002", "2099-01-01");

        mvc.perform(post("/api/member/change-password")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"member_code\":\"202\",\"current_password\":\"admin\","
                    + "\"new_password\":\"Member#Pass1\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.password_is_default").value(false));

        // The default stops working the moment they move off it.
        mvc.perform(post("/api/member/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"member_code\":\"202\",\"password\":\"admin\"}"))
            .andExpect(status().isUnauthorized());

        mvc.perform(post("/api/member/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"member_code\":\"202\",\"password\":\"Member#Pass1\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.password_is_default").value(false));
    }

    // ---------- member tabs ----------

    @Test
    void progressWorkoutDietCrud() throws Exception {
        String token = adminToken();
        long memberId = createClient(token, "101", "Alice", "9990000001", "2099-01-01");

        // Progress
        mvc.perform(post("/api/progress")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"member_id\":" + memberId + ",\"weight\":75.5,\"body_fat\":18}")
            )
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.weight").value(75.5));
        mvc.perform(get("/api/progress?member_id=" + memberId).header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].weight").value(75.5));
        mvc.perform(get("/api/progress").header("Authorization", "Bearer " + token))
            .andExpect(status().isBadRequest());

        // Workouts
        MvcResult wo = mvc.perform(post("/api/workouts")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"member_id\":" + memberId + ",\"day\":\"Monday\","
                    + "\"exercise\":\"Squat\",\"sets\":3,\"reps\":12}"))
            .andExpect(status().isCreated())
            .andReturn();
        long woId = om.readTree(wo.getResponse().getContentAsString()).get("id").asLong();
        mvc.perform(put("/api/workouts/" + woId)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"reps\":15}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.reps").value(15));
        mvc.perform(delete("/api/workouts/" + woId).header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.message").value("Workout deleted"));
        mvc.perform(delete("/api/workouts/" + woId).header("Authorization", "Bearer " + token))
            .andExpect(status().isNotFound());

        // Diet (+ legacy /diets alias)
        mvc.perform(post("/api/diet")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"member_id\":" + memberId + ",\"meal\":\"Breakfast\","
                    + "\"food_item\":\"Oats\",\"calories\":300}"))
            .andExpect(status().isCreated());
        mvc.perform(get("/api/diets?member_id=" + memberId).header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].food_item").value("Oats"));
    }

    // ---------- guards ----------

    @Test
    void roleGuardsAcrossModules() throws Exception {
        String trainer = trainerToken();
        // Writes are admin-only.
        mvc.perform(post("/api/clients")
                .header("Authorization", "Bearer " + trainer)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"member_code\":\"101\",\"name\":\"Sneaky\"}"))
            .andExpect(status().isForbidden());
        mvc.perform(post("/api/payments")
                .header("Authorization", "Bearer " + trainer)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"member_id\":1,\"amount\":10}"))
            .andExpect(status().isForbidden());
        mvc.perform(put("/api/billing/settings")
                .header("Authorization", "Bearer " + trainer)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isForbidden());

        // Anonymous → 401.
        mvc.perform(get("/api/dashboard/stats"))
            .andExpect(status().isUnauthorized());

        // Member token cannot reach admin routes.
        createClient(adminToken(), "101", "Alice", "9990000001", "2099-01-01");
        MvcResult login = mvc.perform(post("/api/member/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"member_code\":\"101\",\"password\":\"admin\"}"))
            .andExpect(status().isOk())
            .andReturn();
        String memberToken = om.readTree(login.getResponse().getContentAsString()).get("token").asText();
        mvc.perform(get("/api/users").header("Authorization", "Bearer " + memberToken))
            .andExpect(status().isForbidden());
    }
}
