-- ============================================================
-- GYM OS 2.0 — base tables (PostgreSQL)
--
-- This is the 1.0 core schema. It is the FIRST half of the 2.0 schema: the
-- 2.0 tables, columns and seed data are applied on top of it by migrate.js,
-- which runs this file automatically when the database is empty.
--
--   Do not run this by hand. Use:  node migrate.js
--
-- Every statement is CREATE ... IF NOT EXISTS, so re-running is harmless.
-- ============================================================

-- Members (clients)
CREATE TABLE IF NOT EXISTS clients (
    id                SERIAL PRIMARY KEY,
    member_code       VARCHAR(20) NOT NULL,         -- gym-assigned numeric member ID (unique)
    name              VARCHAR(100) NOT NULL,
    phone             VARCHAR(20),
    email             VARCHAR(150),
    address           TEXT,
    gender            VARCHAR(20),          -- Male / Female / Other
    dob               DATE,                 -- Date of birth
    join_date         DATE DEFAULT CURRENT_DATE,
    membership_type   VARCHAR(50) DEFAULT 'Monthly',  -- Monthly / Quarterly / Half-Yearly / Yearly / Custom
    membership_start  DATE DEFAULT CURRENT_DATE,
    membership_expiry DATE,
    membership_fee    NUMERIC(10,2) DEFAULT 0,         -- plan price
    amount_paid       NUMERIC(10,2) DEFAULT 0,         -- paid at onboarding
    amount_due        NUMERIC(10,2) DEFAULT 0,         -- outstanding balance (editable; > 0 locks the gate)
    payment_mode      VARCHAR(20),                     -- Cash / UPI / Card / Bank Transfer / Online
    trainer_id        INTEGER,                         -- assigned trainer (users.id)
    card_uid          VARCHAR(50),                     -- RFID card number used for card punch at the gate
    fingerprint_status VARCHAR(20) DEFAULT 'not_enrolled', -- not_enrolled / pending (sent to machine) / enrolled
    auto_renew        BOOLEAN DEFAULT FALSE,           -- renew automatically when the membership expires
    recurring_method  VARCHAR(100),                    -- saved payment method used for auto-charges
    frozen_until      DATE,                            -- membership is on hold until this date (gate blocked)
    freeze_reason     TEXT,                            -- why the membership was frozen
    status            VARCHAR(20) DEFAULT 'active',    -- active / inactive
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Attendance
CREATE TABLE IF NOT EXISTS attendance (
    id           SERIAL PRIMARY KEY,
    member_id    INTEGER NOT NULL,
    member_name  VARCHAR(100) NOT NULL,
    date         DATE NOT NULL,
    time         TIME,
    status       VARCHAR(20) DEFAULT 'Present',  -- Present / Absent
    source       VARCHAR(20) DEFAULT 'manual',   -- manual / device
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Biometric / fingerprint devices (eSSL X990 terminals)
CREATE TABLE IF NOT EXISTS devices (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(100) DEFAULT 'eSSL X990',
    ip_address VARCHAR(45),
    port       INTEGER DEFAULT 80,
    is_active  BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users (admin / trainer accounts)
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name          VARCHAR(100),
    role          VARCHAR(20) DEFAULT 'trainer',  -- admin / trainer
    email         VARCHAR(150),                   -- used for OTP delivery
    phone         VARCHAR(20),                    -- used for OTP delivery
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- One-time passwords for password recovery
CREATE TABLE IF NOT EXISTS password_resets (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    otp_hash   VARCHAR(64) NOT NULL,
    method     VARCHAR(10) DEFAULT 'email',  -- email / sms
    expires_at TIMESTAMPTZ NOT NULL,
    used       BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id);

-- OTP rate-limit / lockout tracking
CREATE TABLE IF NOT EXISTS otp_attempts (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER UNIQUE NOT NULL,
    failed_count    INTEGER DEFAULT 0,
    locked_until    TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payments / billing
CREATE TABLE IF NOT EXISTS payments (
    id           SERIAL PRIMARY KEY,
    member_id    INTEGER NOT NULL,
    amount       NUMERIC(10,2) NOT NULL,
    payment_date DATE DEFAULT CURRENT_DATE,
    method       VARCHAR(20) DEFAULT 'Cash',  -- Cash / UPI / Card / Bank Transfer / Online
    note         TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_member ON payments (member_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments (payment_date);

-- Member progress tracking (weight / body metrics)
CREATE TABLE IF NOT EXISTS member_progress (
    id          SERIAL PRIMARY KEY,
    member_id   INTEGER NOT NULL,
    record_date DATE DEFAULT CURRENT_DATE,
    weight      NUMERIC(5,2),
    body_fat    NUMERIC(4,1),
    chest       NUMERIC(5,2),
    waist       NUMERIC(5,2),
    arms        NUMERIC(5,2),
    thighs      NUMERIC(5,2),
    shoulders   NUMERIC(5,2),
    notes       TEXT
);
CREATE INDEX IF NOT EXISTS idx_progress_member ON member_progress (member_id);

-- Workout plans (one row per exercise in a member's weekly plan)
CREATE TABLE IF NOT EXISTS workout_plans (
    id           SERIAL PRIMARY KEY,
    member_id    INTEGER NOT NULL,
    day          VARCHAR(20),
    exercise     VARCHAR(100),
    sets         INTEGER,
    reps         INTEGER,
    weight       NUMERIC(6,2),
    rest_seconds INTEGER,
    notes        TEXT
);
CREATE INDEX IF NOT EXISTS idx_workouts_member ON workout_plans (member_id);

-- Diet / nutrition plans
CREATE TABLE IF NOT EXISTS diet_plans (
    id         SERIAL PRIMARY KEY,
    member_id  INTEGER NOT NULL,
    meal       VARCHAR(50),       -- Breakfast / Lunch / Snacks / Dinner / Supplements
    food_item  VARCHAR(150),
    calories   INTEGER,
    protein_g  NUMERIC(6,1),
    carbs_g    NUMERIC(6,1),
    fats_g     NUMERIC(6,1),
    notes      TEXT
);
CREATE INDEX IF NOT EXISTS idx_diet_member ON diet_plans (member_id);

-- One attendance per member per day, and fast per-date lookups.
-- UNIQUE backs the in-app duplicate check so one member ID can never be
-- punched twice (or under two different names) for the same date.
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_member_date ON attendance (member_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (date);

-- Key/value app settings (expiry reminders, receipts, etc.)
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- History of automated messages (expiry reminders, renewal receipts)
CREATE TABLE IF NOT EXISTS notification_log (
    id         SERIAL PRIMARY KEY,
    member_id  INTEGER,
    kind       VARCHAR(30) NOT NULL,   -- expiry_reminder / renewal_receipt
    cycle      VARCHAR(10),            -- the membership_expiry the message is tied to
    channel    VARCHAR(30),            -- email / whatsapp / both / console
    recipient  VARCHAR(200),
    message    TEXT,
    status     VARCHAR(20) DEFAULT 'sent',  -- sent / console / failed
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notification_log_member ON notification_log (member_id, kind);

-- Default notification settings (overridable from the UI)
INSERT INTO settings (key, value) VALUES
    ('expiry_reminder_enabled', 'true'),
    ('expiry_reminder_days', '7'),
    ('expiry_reminder_channel', 'both'),
    ('expiry_reminder_message', 'Hi {name}, your gym membership (ID {id}) will expire on {expiry}. Please renew to continue your workouts. — GYM OS'),
    ('renewal_receipt_enabled', 'true'),
    ('auto_renew_enabled', 'true'),
    ('auto_renew_days_before', '0'),
    ('auto_renew_retry_days', '3'),
    ('auto_renew_max_attempts', '3'),
    ('auto_renew_dunning_message', 'Hi {name}, your auto-renewal of ₹{amount} could not be processed ({error}). Please update your payment method to keep your membership active. — GYM OS')
ON CONFLICT (key) DO NOTHING;

-- Class scheduling & member bookings (one row per scheduled session)
CREATE TABLE IF NOT EXISTS gym_classes (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    trainer_id  INTEGER,
    class_date  DATE NOT NULL,
    start_time  TIME NOT NULL,
    end_time    TIME,
    capacity    INTEGER NOT NULL DEFAULT 20,
    status      VARCHAR(20) DEFAULT 'active',   -- active / cancelled
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_classes_date ON gym_classes (class_date);

-- Bookings: booked / waitlisted / cancelled / attended (one per member per class)
CREATE TABLE IF NOT EXISTS class_bookings (
    id         SERIAL PRIMARY KEY,
    class_id   INTEGER NOT NULL,
    member_id  INTEGER NOT NULL,
    status     VARCHAR(20) DEFAULT 'booked',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (class_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_bookings_class ON class_bookings (class_id);
CREATE INDEX IF NOT EXISTS idx_bookings_member ON class_bookings (member_id);

-- Walk-in inquiries / leads (CRM) — captured at the front desk, converted to members
CREATE TABLE IF NOT EXISTS leads (
    id                  SERIAL PRIMARY KEY,
    name                VARCHAR(100) NOT NULL,
    phone               VARCHAR(20),
    email               VARCHAR(150),
    interest            VARCHAR(50),              -- plan of interest: Monthly / Quarterly / etc.
    source              VARCHAR(30) DEFAULT 'walk-in',  -- walk-in / website / phone / social / referral
    status              VARCHAR(20) DEFAULT 'new',      -- new / contacted / visited / converted / lost
    notes               TEXT,
    created_by          INTEGER,                  -- users.id who captured the lead
    converted_member_id INTEGER,                  -- clients.id once converted
    converted_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads (phone);

-- Membership lifecycle events (freeze / resume / upgrade / cancel) — audit trail
CREATE TABLE IF NOT EXISTS membership_events (
    id         SERIAL PRIMARY KEY,
    member_id  INTEGER NOT NULL,
    action     VARCHAR(30) NOT NULL,   -- freeze / resume / upgrade / cancel
    detail     TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_membership_events_member ON membership_events (member_id);

-- Recurring billing: one attempt chain per member per expiry cycle
CREATE TABLE IF NOT EXISTS billing_attempts (
    id             SERIAL PRIMARY KEY,
    member_id      INTEGER NOT NULL,
    cycle          DATE NOT NULL,              -- the membership_expiry this attempt is tied to
    amount         NUMERIC(10,2),
    method         VARCHAR(50),                -- recurring method used (or attempted)
    status         VARCHAR(20) DEFAULT 'pending',  -- pending / success / failed
    attempt_count  INTEGER DEFAULT 1,
    next_retry_at  TIMESTAMPTZ,                -- when the next retry is due (null = no more retries)
    error          TEXT,                       -- why the charge failed
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    settled_at     TIMESTAMPTZ,
    UNIQUE (member_id, cycle)
);
CREATE INDEX IF NOT EXISTS idx_billing_attempts_member ON billing_attempts (member_id);
CREATE INDEX IF NOT EXISTS idx_billing_attempts_retry ON billing_attempts (next_retry_at);

-- Member IDs are unique; usernames are unique ignoring case
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_member_code ON clients (member_code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));

-- One card UID can only ever belong to one member (RFID cards are unique)
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_card_uid
    ON clients (card_uid) WHERE card_uid IS NOT NULL AND card_uid <> '';

-- ---------------------------------------------------------------------------
-- EXCEPTIONS MASTER TABLE (all modules)
-- One row per field/action per module: an exception code (E-code), the module
-- it belongs to, and the exact alert details (message) the UI must render as
-- [E-code] MESSAGE. The frontend loads these via GET /api/exceptions?module=…
-- so every validation alert is driven by data, not hardcoded strings.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exceptions (
    id             SERIAL PRIMARY KEY,
    code           VARCHAR(10) UNIQUE NOT NULL,   -- e.g. E101
    module         VARCHAR(50) NOT NULL,          -- members / attendance / payments / workout / diet / progress / leads / users / devices / classes / billing
    field_name     VARCHAR(60) NOT NULL,          -- form field key, e.g. member_code
    field_label    VARCHAR(100) NOT NULL,         -- human label used in messages
    message        VARCHAR(255),                  -- exception details, e.g. 'MEMBER ID IS MANDATORY' (mandatory-block alert)
    format_message VARCHAR(200),                  -- shown when the value has wrong characters, e.g. 'NUMBER ONLY ALLOWED'
    is_mandatory   BOOLEAN DEFAULT FALSE,
    input_type     VARCHAR(20) DEFAULT 'text',    -- text / number / date / select / toggle / time
    allowed_chars  VARCHAR(20) DEFAULT NULL,      -- numeric / alpha / alphanumeric / NULL (any)
    severity       VARCHAR(10) DEFAULT 'error',   -- error / warning
    sort_order     INTEGER DEFAULT 0,
    is_active      BOOLEAN DEFAULT TRUE,
    UNIQUE (module, field_name)
);

INSERT INTO exceptions (code, module, field_name, field_label, message, format_message, is_mandatory, input_type, allowed_chars, severity, sort_order) VALUES
    -- Members / onboarding
    ('E101', 'members', 'member_code', 'Member ID', 'MEMBER ID IS MANDATORY', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 1),
    ('E102', 'members', 'name', 'Full Name', 'FULL NAME IS MANDATORY', 'ALPHABETS ONLY ALLOWED', TRUE, 'text', 'alpha', 'error', 2),
    ('E103', 'members', 'phone', 'Phone', 'PHONE IS MANDATORY', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 3),
    ('E104', 'members', 'email', 'Email', 'EMAIL IS MANDATORY', NULL, TRUE, 'text', NULL, 'error', 4),
    ('E105', 'members', 'gender', 'Gender', 'GENDER IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 5),
    ('E106', 'members', 'join_date', 'Join Date', 'JOIN DATE IS MANDATORY', NULL, TRUE, 'date', NULL, 'error', 6),
    ('E107', 'members', 'membership_type', 'Membership Type', 'MEMBERSHIP TYPE IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 7),
    ('E108', 'members', 'status', 'Status', 'STATUS IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 8),
    ('E109', 'members', 'membership_start', 'Membership Start', 'MEMBERSHIP START IS MANDATORY', NULL, TRUE, 'date', NULL, 'error', 9),
    ('E110', 'members', 'membership_expiry', 'Membership Expiry', 'MEMBERSHIP EXPIRY IS MANDATORY', NULL, TRUE, 'date', NULL, 'error', 10),
    ('E111', 'members', 'trainer_id', 'Trainer', 'TRAINER IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 11),
    ('E112', 'members', 'membership_fee', 'Membership Fee', 'MEMBERSHIP FEE IS MANDATORY', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 12),
    ('E113', 'members', 'amount_paid', 'Amount Paid', 'AMOUNT PAID IS MANDATORY', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 13),
    ('E114', 'members', 'payment_mode', 'Mode of Payment', 'MODE OF PAYMENT IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 14),
    ('E115', 'members', 'card_uid', 'Card UID / Number', NULL, 'LETTERS AND NUMBERS ONLY ALLOWED', FALSE, 'text', 'alphanumeric', 'error', 15),
    ('E116', 'members', 'recurring_method', 'Recurring payment method', NULL, NULL, FALSE, 'text', NULL, 'error', 16),
    -- Attendance (manual entry)
    ('E2001', 'attendance', 'member_id', 'Member ID', 'MEMBER ID IS NOT REGISTERED. USE THE LEADS FEATURE FOR WALK-INS.', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 1),
    ('E2002', 'attendance', 'member_name', 'Member Name', 'MEMBER NAME IS MANDATORY', 'ALPHABETS ONLY ALLOWED', TRUE, 'text', 'alpha', 'error', 2),
    -- Payments
    ('E201', 'payments', 'member_id', 'Member', 'MEMBER IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 1),
    ('E202', 'payments', 'amount', 'Amount', 'AMOUNT IS MANDATORY', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 2),
    ('E203', 'payments', 'method', 'Method', 'METHOD IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 3),
    -- Leads
    ('E301', 'leads', 'name', 'Name', 'NAME IS MANDATORY', 'ALPHABETS ONLY ALLOWED', TRUE, 'text', 'alpha', 'error', 1),
    ('E302', 'leads', 'phone', 'Phone', NULL, 'NUMBER ONLY ALLOWED', FALSE, 'number', 'numeric', 'error', 2),
    ('E303', 'leads', 'interest', 'Plan of Interest', NULL, NULL, FALSE, 'select', NULL, 'error', 3),
    -- Workout plans
    ('E401', 'workout', 'day', 'Day', 'DAY IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 1),
    ('E402', 'workout', 'exercise', 'Exercise', 'EXERCISE IS MANDATORY', 'ALPHABETS ONLY ALLOWED', TRUE, 'text', 'alpha', 'error', 2),
    ('E403', 'workout', 'sets', 'Sets', NULL, 'NUMBER ONLY ALLOWED', FALSE, 'number', 'numeric', 'error', 3),
    ('E404', 'workout', 'reps', 'Reps', NULL, 'NUMBER ONLY ALLOWED', FALSE, 'number', 'numeric', 'error', 4),
    ('E405', 'workout', 'weight', 'Weight', NULL, 'NUMBER ONLY ALLOWED', FALSE, 'number', 'numeric', 'error', 5),
    -- Diet plans
    ('E501', 'diet', 'meal', 'Meal', 'MEAL IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 1),
    ('E502', 'diet', 'food_item', 'Food Item', 'FOOD ITEM IS MANDATORY', 'ALPHABETS ONLY ALLOWED', TRUE, 'text', 'alpha', 'error', 2),
    ('E503', 'diet', 'calories', 'Calories', NULL, 'NUMBER ONLY ALLOWED', FALSE, 'number', 'numeric', 'error', 3),
    -- Progress tracking
    ('E601', 'progress', 'record_date', 'Date', 'DATE IS MANDATORY', NULL, TRUE, 'date', NULL, 'error', 1),
    ('E602', 'progress', 'weight', 'Weight', NULL, 'NUMBER ONLY ALLOWED', FALSE, 'number', 'numeric', 'error', 2),
    -- Users
    ('E701', 'users', 'username', 'Username', 'USERNAME IS MANDATORY', NULL, TRUE, 'text', NULL, 'error', 1),
    ('E702', 'users', 'name', 'Name', 'NAME IS MANDATORY', 'ALPHABETS ONLY ALLOWED', TRUE, 'text', 'alpha', 'error', 2),
    ('E703', 'users', 'password', 'Password', 'PASSWORD IS MANDATORY', NULL, TRUE, 'text', NULL, 'error', 3),
    -- Devices
    ('E801', 'devices', 'name', 'Device Name', 'DEVICE NAME IS MANDATORY', NULL, TRUE, 'text', NULL, 'error', 1),
    ('E802', 'devices', 'ip_address', 'IP Address', NULL, NULL, FALSE, 'text', NULL, 'error', 2),
    ('E803', 'devices', 'port', 'Port', NULL, 'NUMBER ONLY ALLOWED', FALSE, 'number', 'numeric', 'error', 3),
    -- Classes
    ('E901', 'classes', 'name', 'Class Name', 'CLASS NAME IS MANDATORY', NULL, TRUE, 'text', NULL, 'error', 1),
    ('E902', 'classes', 'class_date', 'Date', 'DATE IS MANDATORY', NULL, TRUE, 'date', NULL, 'error', 2),
    ('E903', 'classes', 'start_time', 'Start Time', 'START TIME IS MANDATORY', NULL, TRUE, 'time', NULL, 'error', 3),
    ('E904', 'classes', 'capacity', 'Capacity', 'CAPACITY IS MANDATORY', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 4),
    -- Billing / renewal
    ('E1001', 'billing', 'membership_fee', 'Membership Fee', 'MEMBERSHIP FEE IS MANDATORY', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 1),
    ('E1002', 'billing', 'amount_paid', 'Amount Paid', 'AMOUNT PAID IS MANDATORY', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 2),
    ('E1003', 'billing', 'payment_mode', 'Mode of Payment', 'MODE OF PAYMENT IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 3)
ON CONFLICT (module, field_name) DO NOTHING;
