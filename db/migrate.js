// Gym 2.0/db/migrate.js
//
// The complete, idempotent GYM OS 2.0 schema. It runs the 1.0 tables first and
// then the 2.0 additions, so a brand-new database and an upgraded 1.0 database
// finish in exactly the same shape. Safe to run as many times as you like —
// every statement is CREATE/ALTER … IF NOT EXISTS or ON CONFLICT DO NOTHING.
//
// Standalone on purpose: Gym 2.0 owns its schema and does not reach back into
// the 1.0 backend for a connection, so the two can be run side by side.
//
//   cd "Gym 2.0/db" && node migrate.js
//
// Connection settings come from the environment (same names as 1.0):
//   DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD

const path = require('path');
const { Pool } = require('pg');

// Read a .env from this folder, the 2.0 root, or the repo root — whichever exists.
for (const candidate of ['.env', '../.env', '../../.env', '../../backend/.env']) {
    require('dotenv').config({ path: path.resolve(__dirname, candidate) });
}

// Placeholder values in a copied .env would otherwise be sent to Postgres
// verbatim and fail with a confusing authentication error.
const PLACEHOLDERS = new Set([
    'your_postgres_user', 'your_postgres_password', 'your_db_name',
    'changeme', 'change-me', 'placeholder', 'todo', 'xxx',
]);
const envOr = (key, fallback) => {
    const v = (process.env[key] || '').trim();
    if (!v) return fallback;
    return PLACEHOLDERS.has(v.toLowerCase()) ? fallback : v;
};

const pool = new Pool({
    host: envOr('DB_HOST', 'localhost'),
    port: Number(envOr('DB_PORT', '5432')),
    database: envOr('DB_NAME', 'gymdb'),
    user: envOr('DB_USER', process.env.USER || process.env.USERNAME || 'postgres'),
    password: envOr('DB_PASSWORD', ''),
});

// Everything below this file assumes the 1.0 core tables (clients, users,
// attendance, ...) already exist, because 2.0 grew out of an upgrade path. On a
// genuinely empty database there is nothing to alter, so lay the base schema
// down first. schema.sql is all CREATE ... IF NOT EXISTS, so this is a no-op on
// a database that has already been migrated.
const fs = require('fs');
const bootstrapBaseSchema = async () => {
    const { rows } = await pool.query(
        "SELECT to_regclass('public.clients') IS NOT NULL AS present");
    if (rows[0].present) {
        return;
    }
    const schemaPath = path.resolve(__dirname, 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
        throw new Error(`empty database and no schema.sql beside migrate.js (${schemaPath})`);
    }
    await pool.query(fs.readFileSync(schemaPath, 'utf8'));
    console.log('✅ base schema created (empty database)');
};

const columns = [
    ["email", "VARCHAR(150)"],
    ["address", "TEXT"],
    ["gender", "VARCHAR(20)"],
    ["dob", "DATE"],
    ["membership_type", "VARCHAR(50) DEFAULT 'Monthly'"],
    ["membership_start", "DATE DEFAULT CURRENT_DATE"],
    ["membership_expiry", "DATE"],
    ["membership_fee", "NUMERIC(10,2) DEFAULT 0"],
    ["amount_paid", "NUMERIC(10,2) DEFAULT 0"],
    ["payment_mode", "VARCHAR(20)"],
];

(async () => {
    await bootstrapBaseSchema();
    for (const [name, definition] of columns) {
        await pool.query(
            `ALTER TABLE clients ADD COLUMN IF NOT EXISTS ${name} ${definition}`
        );
        console.log(`✅ column ${name}`);
    }
    // One attendance per member per day — UNIQUE backs the in-app duplicate
    // check so a member ID can never be punched twice (or under two names)
    // for the same date. Replaces the old non-unique index on existing DBs.
    await pool.query('DROP INDEX IF EXISTS idx_attendance_member_date');
    await pool.query('CREATE UNIQUE INDEX idx_attendance_member_date ON attendance (member_id, date)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (date)');
    console.log('✅ indexes (attendance member+date now UNIQUE)');
    await pool.query(
        "ALTER TABLE attendance ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'manual'"
    );
    console.log('✅ attendance.source column');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS devices (
            id         SERIAL PRIMARY KEY,
            name       VARCHAR(100) DEFAULT 'eSSL X990',
            ip_address VARCHAR(45),
            port       INTEGER DEFAULT 80,
            is_active  BOOLEAN DEFAULT TRUE,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    console.log('✅ devices table');
    await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS trainer_id INTEGER");
    console.log('✅ clients.trainer_id column');
    // Gym-assigned numeric member ID (unique). Backfill existing rows from the
    // serial id so history keeps matching, then enforce uniqueness + NOT NULL.
    await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS member_code VARCHAR(20)');
    await pool.query('UPDATE clients SET member_code = id::text WHERE member_code IS NULL');
    await pool.query('ALTER TABLE clients ALTER COLUMN member_code SET NOT NULL');
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_member_code ON clients (member_code)');
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username))');
    console.log('✅ clients.member_code (numeric, unique) + case-insensitive unique usernames');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id            SERIAL PRIMARY KEY,
            username      VARCHAR(50) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            name          VARCHAR(100),
            role          VARCHAR(20) DEFAULT 'trainer',
            email         VARCHAR(150),
            phone         VARCHAR(20),
            created_at    TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(150)');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20)');
    // The security-question recovery was replaced by OTP — drop its columns if present.
    await pool.query('ALTER TABLE users DROP COLUMN IF EXISTS security_question');
    await pool.query('ALTER TABLE users DROP COLUMN IF EXISTS security_answer_hash');

    // Theme preference, for both the staff app and the member portal. NULL
    // means "follow the device" (prefers-color-scheme) rather than a stored
    // choice, which is why it is nullable and has no default: we need to tell
    // "never chose" apart from "chose light". Stored server-side rather than in
    // localStorage so the choice follows a person across their phone, the desk
    // machine and anything else they sign in on.
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_preference VARCHAR(8)");
    await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS theme_preference VARCHAR(8)");
    await pool.query(`
        DO $$ BEGIN
            ALTER TABLE users ADD CONSTRAINT users_theme_preference_chk
                CHECK (theme_preference IS NULL OR theme_preference IN ('light','dark','system'));
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await pool.query(`
        DO $$ BEGIN
            ALTER TABLE clients ADD CONSTRAINT clients_theme_preference_chk
                CHECK (theme_preference IS NULL OR theme_preference IN ('light','dark','system'));
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS password_resets (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER NOT NULL,
            otp_hash   VARCHAR(64) NOT NULL,
            method     VARCHAR(10) DEFAULT 'email',
            expires_at TIMESTAMPTZ NOT NULL,
            used       BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id)');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS otp_attempts (
            id              SERIAL PRIMARY KEY,
            user_id         INTEGER UNIQUE NOT NULL,
            failed_count    INTEGER DEFAULT 0,
            locked_until    TIMESTAMPTZ,
            last_attempt_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    console.log('✅ users email/phone columns + password_resets + otp_attempts tables (OTP recovery)');

    // Login throttling. Keyed by (scope, identifier) rather than user_id because
    // a failed login is often for a username that does not exist — and those
    // attempts are exactly the ones worth counting. `scope` separates the three
    // login doors ('staff', 'member', 'booking') from the per-IP counter ('ip'),
    // so one gym's typo does not lock out the whole front desk.
    await pool.query(`
        CREATE TABLE IF NOT EXISTS login_attempts (
            id              SERIAL PRIMARY KEY,
            scope           VARCHAR(20) NOT NULL,
            identifier      VARCHAR(160) NOT NULL,
            failed_count    INTEGER NOT NULL DEFAULT 0,
            locked_until    TIMESTAMPTZ,
            first_attempt_at TIMESTAMPTZ DEFAULT NOW(),
            last_attempt_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (scope, identifier)
        )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_login_attempts_last ON login_attempts (last_attempt_at)');
    console.log('✅ login_attempts table (login lockout)');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS payments (
            id           SERIAL PRIMARY KEY,
            member_id    INTEGER NOT NULL,
            amount       NUMERIC(10,2) NOT NULL,
            payment_date DATE DEFAULT CURRENT_DATE,
            method       VARCHAR(20) DEFAULT 'Cash',
            note         TEXT,
            created_at   TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_payments_member ON payments (member_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_payments_date ON payments (payment_date)');
    await pool.query(`
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
        )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_progress_member ON member_progress (member_id)');
    await pool.query(`
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
        )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_workouts_member ON workout_plans (member_id)');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS diet_plans (
            id         SERIAL PRIMARY KEY,
            member_id  INTEGER NOT NULL,
            meal       VARCHAR(50),
            food_item  VARCHAR(150),
            calories   INTEGER,
            protein_g  NUMERIC(6,1),
            carbs_g    NUMERIC(6,1),
            fats_g     NUMERIC(6,1),
            notes      TEXT
        )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_diet_member ON diet_plans (member_id)');
    console.log('✅ users / payments / member_progress / workout_plans / diet_plans tables');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    `);
    // Branding customization is a paid feature, not every gym's default —
    // off (N) unless a reseller flips it to Y for this install's settings row.
    await pool.query(`
        INSERT INTO settings (key, value) VALUES ('feature_branding_ui', 'N')
        ON CONFLICT (key) DO NOTHING
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS notification_log (
            id         SERIAL PRIMARY KEY,
            member_id  INTEGER,
            kind       VARCHAR(30) NOT NULL,
            cycle      VARCHAR(10),
            channel    VARCHAR(30),
            recipient  VARCHAR(200),
            message    TEXT,
            status     VARCHAR(20) DEFAULT 'sent',
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_notification_log_member ON notification_log (member_id, kind)');
    await pool.query(`
        INSERT INTO settings (key, value) VALUES
            ('expiry_reminder_enabled', 'true'),
            ('expiry_reminder_days', '7'),
            ('expiry_reminder_channel', 'both'),
            ('expiry_reminder_message', 'Hi {name}, your gym membership (ID {id}) will expire on {expiry}. Please renew to continue your workouts. — GYM OS'),
            ('renewal_receipt_enabled', 'true')
        ON CONFLICT (key) DO NOTHING
    `);
    console.log('✅ settings + notification_log tables (expiry reminders & receipts)');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS gym_classes (
            id          SERIAL PRIMARY KEY,
            name        VARCHAR(100) NOT NULL,
            description TEXT,
            trainer_id  INTEGER,
            class_date  DATE NOT NULL,
            start_time  TIME NOT NULL,
            end_time    TIME,
            capacity    INTEGER NOT NULL DEFAULT 20,
            status      VARCHAR(20) DEFAULT 'active',
            created_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_classes_date ON gym_classes (class_date)');
    // A class is 'active' or 'cancelled'. Nothing else. The demo seeder once
    // wrote 'scheduled', which every query in the module filters out, and the
    // whole Classes screen went blank over 56 classes and 2,118 bookings with
    // no error anywhere. Repair any stragglers, then make the state
    // unrepresentable so a seeder cannot invent a status again.
    await pool.query("UPDATE gym_classes SET status = 'active' WHERE status NOT IN ('active','cancelled') OR status IS NULL");
    await pool.query(`DO $$ BEGIN
        ALTER TABLE gym_classes ADD CONSTRAINT gym_classes_status_chk
            CHECK (status IN ('active','cancelled'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS class_bookings (
            id         SERIAL PRIMARY KEY,
            class_id   INTEGER NOT NULL,
            member_id  INTEGER NOT NULL,
            status     VARCHAR(20) DEFAULT 'booked',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (class_id, member_id)
        )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_bookings_class ON class_bookings (class_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_bookings_member ON class_bookings (member_id)');
    console.log('✅ gym_classes + class_bookings tables (class scheduling & bookings)');
    await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS amount_due NUMERIC(10,2) DEFAULT 0');
    // Backfill: existing members start with the balance they had at onboarding
    // (idempotent — recalculating the same value is harmless).
    await pool.query(`UPDATE clients SET amount_due = GREATEST(0, COALESCE(membership_fee, 0) - COALESCE(amount_paid, 0))`);
    console.log('✅ clients.amount_due (editable balance; > 0 locks the gate)');
    await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN DEFAULT FALSE');
    await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS recurring_method VARCHAR(100)');
    await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS frozen_until DATE');
    await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS freeze_reason TEXT');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS membership_events (
            id         SERIAL PRIMARY KEY,
            member_id  INTEGER NOT NULL,
            action     VARCHAR(30) NOT NULL,
            detail     TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_membership_events_member ON membership_events (member_id)');
    console.log('✅ frozen_until/freeze_reason columns + membership_events table (freeze/upgrade/cancel)');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS leads (
            id                  SERIAL PRIMARY KEY,
            name                VARCHAR(100) NOT NULL,
            phone               VARCHAR(20),
            email               VARCHAR(150),
            interest            VARCHAR(50),
            source              VARCHAR(30) DEFAULT 'walk-in',
            status              VARCHAR(20) DEFAULT 'new',
            notes               TEXT,
            created_by          INTEGER,
            converted_member_id INTEGER,
            converted_at        TIMESTAMPTZ,
            created_at          TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads (phone)');
    console.log('✅ leads table (CRM)');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS billing_attempts (
            id             SERIAL PRIMARY KEY,
            member_id      INTEGER NOT NULL,
            cycle          DATE NOT NULL,
            amount         NUMERIC(10,2),
            method         VARCHAR(50),
            status         VARCHAR(20) DEFAULT 'pending',
            attempt_count  INTEGER DEFAULT 1,
            next_retry_at  TIMESTAMPTZ,
            error          TEXT,
            created_at     TIMESTAMPTZ DEFAULT NOW(),
            settled_at     TIMESTAMPTZ,
            UNIQUE (member_id, cycle)
        )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_billing_attempts_member ON billing_attempts (member_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_billing_attempts_retry ON billing_attempts (next_retry_at)');
    await pool.query(`
        INSERT INTO settings (key, value) VALUES
            ('auto_renew_enabled', 'true'),
            ('auto_renew_days_before', '0'),
            ('auto_renew_retry_days', '3'),
            ('auto_renew_max_attempts', '3'),
            ('auto_renew_dunning_message', 'Hi {name}, your auto-renewal of ₹{amount} could not be processed ({error}). Please update your payment method to keep your membership active. — GYM OS')
        ON CONFLICT (key) DO NOTHING
    `);
    console.log('✅ auto_renew columns + billing_attempts table + settings (recurring billing)');
    // Gate credentials: RFID card UID (card punch) + fingerprint enrollment state.
    await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS card_uid VARCHAR(50)");
    await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS fingerprint_status VARCHAR(20) DEFAULT 'not_enrolled'");
    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_card_uid
            ON clients (card_uid) WHERE card_uid IS NOT NULL AND card_uid <> ''
    `);
    console.log('✅ clients.card_uid + clients.fingerprint_status (gate credentials: card punch + fingerprint enrollment)');
    // Field validation rules master table (one row per form field per module).
    // Consumed by the frontend via GET /api/field-rules?module=…
    await pool.query(`
        CREATE TABLE IF NOT EXISTS field_rules (
            id            SERIAL PRIMARY KEY,
            code          VARCHAR(10) UNIQUE NOT NULL,
            module        VARCHAR(50) NOT NULL,
            field_name    VARCHAR(60) NOT NULL,
            field_label   VARCHAR(100) NOT NULL,
            is_mandatory  BOOLEAN DEFAULT FALSE,
            input_type    VARCHAR(20) DEFAULT 'text',
            allowed_chars VARCHAR(20) DEFAULT NULL,
            error_message VARCHAR(200) DEFAULT NULL,
            sort_order    INTEGER DEFAULT 0,
            UNIQUE (module, field_name)
        )
    `);
    await pool.query(`
        INSERT INTO field_rules (code, module, field_name, field_label, is_mandatory, input_type, allowed_chars, error_message, sort_order) VALUES
            ('E101', 'members', 'member_code', 'Member ID', TRUE, 'number', 'numeric', 'Number only allowed', 1),
            ('E102', 'members', 'name', 'Full Name', TRUE, 'text', 'alpha', 'Alphabets only allowed', 2),
            ('E103', 'members', 'phone', 'Phone', TRUE, 'number', 'numeric', 'Number only allowed', 3),
            ('E104', 'members', 'email', 'Email', FALSE, 'text', NULL, NULL, 4),
            ('E105', 'members', 'gender', 'Gender', TRUE, 'select', NULL, NULL, 5),
            ('E106', 'members', 'join_date', 'Join Date', TRUE, 'date', NULL, NULL, 6),
            ('E107', 'members', 'membership_type', 'Membership Type', TRUE, 'select', NULL, NULL, 7),
            ('E108', 'members', 'status', 'Status', TRUE, 'select', NULL, NULL, 8),
            ('E109', 'members', 'membership_start', 'Membership Start', TRUE, 'date', NULL, NULL, 9),
            ('E110', 'members', 'membership_expiry', 'Membership Expiry', TRUE, 'date', NULL, NULL, 10),
            ('E111', 'members', 'trainer_id', 'Trainer', FALSE, 'select', NULL, NULL, 11),
            ('E112', 'members', 'membership_fee', 'Membership Fee', TRUE, 'number', 'numeric', 'Number only allowed', 12),
            ('E113', 'members', 'amount_paid', 'Amount Paid', TRUE, 'number', 'numeric', 'Number only allowed', 13),
            ('E114', 'members', 'payment_mode', 'Mode of Payment', TRUE, 'select', NULL, NULL, 14),
            ('E115', 'members', 'card_uid', 'Card UID / Number', FALSE, 'text', 'alphanumeric', 'Letters and numbers only allowed', 15),
            ('E116', 'members', 'recurring_method', 'Recurring payment method', FALSE, 'text', NULL, NULL, 16),
            ('E201', 'payments', 'member_id', 'Member', TRUE, 'select', NULL, NULL, 1),
            ('E202', 'payments', 'amount', 'Amount', TRUE, 'number', 'numeric', 'Number only allowed', 2),
            ('E203', 'payments', 'method', 'Method', TRUE, 'select', NULL, NULL, 3),
            ('E301', 'leads', 'name', 'Name', TRUE, 'text', 'alpha', 'Alphabets only allowed', 1),
            ('E302', 'leads', 'phone', 'Phone', FALSE, 'number', 'numeric', 'Number only allowed', 2),
            ('E303', 'leads', 'interest', 'Plan of Interest', FALSE, 'select', NULL, NULL, 3),
            ('E401', 'workout', 'day', 'Day', TRUE, 'select', NULL, NULL, 1),
            ('E402', 'workout', 'exercise', 'Exercise', TRUE, 'text', 'alpha', 'Alphabets only allowed', 2),
            ('E403', 'workout', 'sets', 'Sets', FALSE, 'number', 'numeric', 'Number only allowed', 3),
            ('E404', 'workout', 'reps', 'Reps', FALSE, 'number', 'numeric', 'Number only allowed', 4),
            ('E405', 'workout', 'weight', 'Weight', FALSE, 'number', 'numeric', 'Number only allowed', 5),
            ('E501', 'diet', 'meal', 'Meal', TRUE, 'select', NULL, NULL, 1),
            ('E502', 'diet', 'food_item', 'Food Item', TRUE, 'text', 'alpha', 'Alphabets only allowed', 2),
            ('E503', 'diet', 'calories', 'Calories', FALSE, 'number', 'numeric', 'Number only allowed', 3),
            ('E601', 'progress', 'record_date', 'Date', TRUE, 'date', NULL, NULL, 1),
            ('E602', 'progress', 'weight', 'Weight', FALSE, 'number', 'numeric', 'Number only allowed', 2),
            ('E701', 'users', 'username', 'Username', TRUE, 'text', NULL, NULL, 1),
            ('E702', 'users', 'name', 'Name', TRUE, 'text', 'alpha', 'Alphabets only allowed', 2),
            ('E703', 'users', 'password', 'Password', TRUE, 'text', NULL, NULL, 3),
            ('E801', 'devices', 'name', 'Device Name', TRUE, 'text', NULL, NULL, 1),
            ('E802', 'devices', 'ip_address', 'IP Address', FALSE, 'text', NULL, NULL, 2),
            ('E803', 'devices', 'port', 'Port', FALSE, 'number', 'numeric', 'Number only allowed', 3),
            ('E901', 'classes', 'name', 'Class Name', TRUE, 'text', NULL, NULL, 1),
            ('E902', 'classes', 'class_date', 'Date', TRUE, 'date', NULL, NULL, 2),
            ('E903', 'classes', 'start_time', 'Start Time', TRUE, 'time', NULL, NULL, 3),
            ('E904', 'classes', 'capacity', 'Capacity', TRUE, 'number', 'numeric', 'Number only allowed', 4),
            ('E1001', 'billing', 'membership_fee', 'Membership Fee', TRUE, 'number', 'numeric', 'Number only allowed', 1),
            ('E1002', 'billing', 'amount_paid', 'Amount Paid', TRUE, 'number', 'numeric', 'Number only allowed', 2),
            ('E1003', 'billing', 'payment_mode', 'Mode of Payment', TRUE, 'select', NULL, NULL, 3)
        ON CONFLICT (module, field_name) DO NOTHING
    `);
    console.log('✅ field_rules master table + seed (validation rules for all modules)');
    // -----------------------------------------------------------------------
    // EXCEPTIONS MASTER TABLE — the single source of truth for validation
    // alerts. One row per field/action per module: code (E-code), module,
    // and the exact message the UI renders as [E-code] MESSAGE. Replaces
    // field_rules: existing rows are migrated with derived messages, the
    // attendance module gets its own exceptions (e.g. walk-in not registered),
    // and the legacy table is dropped so there is exactly one master table.
    // -----------------------------------------------------------------------
    await pool.query(`
        CREATE TABLE IF NOT EXISTS exceptions (
            id             SERIAL PRIMARY KEY,
            code           VARCHAR(10) UNIQUE NOT NULL,
            module         VARCHAR(50) NOT NULL,
            field_name     VARCHAR(60) NOT NULL,
            field_label    VARCHAR(100) NOT NULL,
            message        VARCHAR(255),
            format_message VARCHAR(200),
            is_mandatory   BOOLEAN DEFAULT FALSE,
            input_type     VARCHAR(20) DEFAULT 'text',
            allowed_chars  VARCHAR(20) DEFAULT NULL,
            severity       VARCHAR(10) DEFAULT 'error',
            sort_order     INTEGER DEFAULT 0,
            is_active      BOOLEAN DEFAULT TRUE,
            UNIQUE (module, field_name)
        )
    `);
    // One-time migration of the legacy field_rules data (if the table still
    // exists), then drop it so exceptions is the only master table.
    const legacy = await pool.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = current_schema() AND table_name = 'field_rules'`
    );
    if (legacy.rows.length) {
        await pool.query(`
            INSERT INTO exceptions (code, module, field_name, field_label, message, format_message, is_mandatory, input_type, allowed_chars, severity, sort_order)
            SELECT code, module, field_name, field_label,
                   CASE WHEN is_mandatory THEN UPPER(field_label) || ' IS MANDATORY' ELSE NULL END,
                   UPPER(error_message),
                   is_mandatory, input_type, allowed_chars, 'error', sort_order
            FROM field_rules
            ON CONFLICT (module, field_name) DO NOTHING
        `);
        await pool.query('DROP TABLE IF EXISTS field_rules');
        console.log('✅ migrated field_rules → exceptions (legacy table dropped)');
    }
    // Seed: all modules + attendance exceptions. ON CONFLICT keeps this
    // idempotent on re-runs and preserves any admin-edited messages.
    await pool.query(`
        INSERT INTO exceptions (code, module, field_name, field_label, message, format_message, is_mandatory, input_type, allowed_chars, severity, sort_order) VALUES
            ('E101', 'members', 'member_code', 'Member ID', 'MEMBER ID IS MANDATORY', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 1),
            ('E102', 'members', 'name', 'Full Name', 'FULL NAME IS MANDATORY', 'ALPHABETS ONLY ALLOWED', TRUE, 'text', 'alpha', 'error', 2),
            ('E103', 'members', 'phone', 'Phone', 'PHONE IS MANDATORY', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 3),
            ('E104', 'members', 'email', 'Email', NULL, NULL, FALSE, 'text', NULL, 'error', 4),
            ('E105', 'members', 'gender', 'Gender', 'GENDER IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 5),
            ('E106', 'members', 'join_date', 'Join Date', 'JOIN DATE IS MANDATORY', NULL, TRUE, 'date', NULL, 'error', 6),
            ('E107', 'members', 'membership_type', 'Membership Type', 'MEMBERSHIP TYPE IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 7),
            ('E108', 'members', 'status', 'Status', 'STATUS IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 8),
            ('E109', 'members', 'membership_start', 'Membership Start', 'MEMBERSHIP START IS MANDATORY', NULL, TRUE, 'date', NULL, 'error', 9),
            ('E110', 'members', 'membership_expiry', 'Membership Expiry', 'MEMBERSHIP EXPIRY IS MANDATORY', NULL, TRUE, 'date', NULL, 'error', 10),
            ('E111', 'members', 'trainer_id', 'Trainer', NULL, NULL, FALSE, 'select', NULL, 'error', 11),
            ('E112', 'members', 'membership_fee', 'Membership Fee', 'MEMBERSHIP FEE IS MANDATORY', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 12),
            ('E113', 'members', 'amount_paid', 'Amount Paid', 'AMOUNT PAID IS MANDATORY', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 13),
            ('E114', 'members', 'payment_mode', 'Mode of Payment', 'MODE OF PAYMENT IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 14),
            ('E115', 'members', 'card_uid', 'Card UID / Number', NULL, 'LETTERS AND NUMBERS ONLY ALLOWED', FALSE, 'text', 'alphanumeric', 'error', 15),
            ('E116', 'members', 'recurring_method', 'Recurring payment method', NULL, NULL, FALSE, 'text', NULL, 'error', 16),
            ('E2001', 'attendance', 'member_id', 'Member ID', 'MEMBER ID IS NOT REGISTERED. USE THE LEADS FEATURE FOR WALK-INS.', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 1),
            ('E2002', 'attendance', 'member_name', 'Member Name', 'MEMBER NAME IS MANDATORY', 'ALPHABETS ONLY ALLOWED', TRUE, 'text', 'alpha', 'error', 2),
            ('E201', 'payments', 'member_id', 'Member', 'MEMBER IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 1),
            ('E202', 'payments', 'amount', 'Amount', 'AMOUNT IS MANDATORY', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 2),
            ('E203', 'payments', 'method', 'Method', 'METHOD IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 3),
            ('E301', 'leads', 'name', 'Name', 'NAME IS MANDATORY', 'ALPHABETS ONLY ALLOWED', TRUE, 'text', 'alpha', 'error', 1),
            ('E302', 'leads', 'phone', 'Phone', NULL, 'NUMBER ONLY ALLOWED', FALSE, 'number', 'numeric', 'error', 2),
            ('E303', 'leads', 'interest', 'Plan of Interest', NULL, NULL, FALSE, 'select', NULL, 'error', 3),
            ('E401', 'workout', 'day', 'Day', 'DAY IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 1),
            ('E402', 'workout', 'exercise', 'Exercise', 'EXERCISE IS MANDATORY', 'ALPHABETS ONLY ALLOWED', TRUE, 'text', 'alpha', 'error', 2),
            ('E403', 'workout', 'sets', 'Sets', NULL, 'NUMBER ONLY ALLOWED', FALSE, 'number', 'numeric', 'error', 3),
            ('E404', 'workout', 'reps', 'Reps', NULL, 'NUMBER ONLY ALLOWED', FALSE, 'number', 'numeric', 'error', 4),
            ('E405', 'workout', 'weight', 'Weight', NULL, 'NUMBER ONLY ALLOWED', FALSE, 'number', 'numeric', 'error', 5),
            ('E501', 'diet', 'meal', 'Meal', 'MEAL IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 1),
            ('E502', 'diet', 'food_item', 'Food Item', 'FOOD ITEM IS MANDATORY', 'ALPHABETS ONLY ALLOWED', TRUE, 'text', 'alpha', 'error', 2),
            ('E503', 'diet', 'calories', 'Calories', NULL, 'NUMBER ONLY ALLOWED', FALSE, 'number', 'numeric', 'error', 3),
            ('E601', 'progress', 'record_date', 'Date', 'DATE IS MANDATORY', NULL, TRUE, 'date', NULL, 'error', 1),
            ('E602', 'progress', 'weight', 'Weight', NULL, 'NUMBER ONLY ALLOWED', FALSE, 'number', 'numeric', 'error', 2),
            ('E701', 'users', 'username', 'Username', 'USERNAME IS MANDATORY', NULL, TRUE, 'text', NULL, 'error', 1),
            ('E702', 'users', 'name', 'Name', 'NAME IS MANDATORY', 'ALPHABETS ONLY ALLOWED', TRUE, 'text', 'alpha', 'error', 2),
            ('E703', 'users', 'password', 'Password', 'PASSWORD IS MANDATORY', NULL, TRUE, 'text', NULL, 'error', 3),
            ('E801', 'devices', 'name', 'Device Name', 'DEVICE NAME IS MANDATORY', NULL, TRUE, 'text', NULL, 'error', 1),
            ('E802', 'devices', 'ip_address', 'IP Address', NULL, NULL, FALSE, 'text', NULL, 'error', 2),
            ('E803', 'devices', 'port', 'Port', NULL, 'NUMBER ONLY ALLOWED', FALSE, 'number', 'numeric', 'error', 3),
            ('E901', 'classes', 'name', 'Class Name', 'CLASS NAME IS MANDATORY', NULL, TRUE, 'text', NULL, 'error', 1),
            ('E902', 'classes', 'class_date', 'Date', 'DATE IS MANDATORY', NULL, TRUE, 'date', NULL, 'error', 2),
            ('E903', 'classes', 'start_time', 'Start Time', 'START TIME IS MANDATORY', NULL, TRUE, 'time', NULL, 'error', 3),
            ('E904', 'classes', 'capacity', 'Capacity', 'CAPACITY IS MANDATORY', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 4),
            ('E1001', 'billing', 'membership_fee', 'Membership Fee', 'MEMBERSHIP FEE IS MANDATORY', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 1),
            ('E1002', 'billing', 'amount_paid', 'Amount Paid', 'AMOUNT PAID IS MANDATORY', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 2),
            ('E1003', 'billing', 'payment_mode', 'Mode of Payment', 'MODE OF PAYMENT IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 3)
        ON CONFLICT (module, field_name) DO NOTHING
    `);
    console.log('✅ exceptions master table + seed (E-codes with details for all modules incl. attendance)');

    // Email and Trainer were seeded mandatory, and the seed above is
    // ON CONFLICT DO NOTHING — so an existing database keeps whatever it was
    // first given and would go on demanding both forever. Nothing else writes
    // these rows (the exceptions API is read-only), so repairing them here is
    // idempotent and safe to re-run: a walk-in often has no email address, and
    // a trainer is assigned later, not at the door.
    await pool.query(`
        UPDATE exceptions SET is_mandatory = FALSE, message = NULL
        WHERE code IN ('E104', 'E111') AND is_mandatory
    `);
    console.log('✅ exceptions: members.email + members.trainer_id are optional');

    // =======================================================================
    // MEMBERSHIP PLANS MASTER
    // Plan durations and prices used to be hardcoded constants in the
    // controllers, so a gym could not price its own packages. `clients.
    // membership_type` already stores the plan NAME, so seeding the master
    // with the previous constants keeps every existing member valid.
    // =======================================================================
    await pool.query(`
        CREATE TABLE IF NOT EXISTS plans (
            id SERIAL PRIMARY KEY,
            name VARCHAR(80) NOT NULL UNIQUE,
            duration_days INTEGER NOT NULL CHECK (duration_days > 0),
            price NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
            signup_fee NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (signup_fee >= 0),
            description TEXT,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`
        INSERT INTO plans (name, duration_days, price, sort_order, description) VALUES
            ('Monthly',     30,  1500, 1, 'Rolling one-month membership'),
            ('Quarterly',   90,  4000, 2, 'Three months — best value for regulars'),
            ('Half-Yearly', 180, 7500, 3, 'Six months'),
            ('Yearly',      365, 14000, 4, 'Twelve months — lowest monthly cost'),
            ('Custom',      30,  0,    5, 'Custom duration set per member')
        ON CONFLICT (name) DO NOTHING
    `);
    console.log('✅ plans master table + seed (membership packages with duration & price)');

    // =======================================================================
    // LOCKERS
    // =======================================================================
    await pool.query(`
        CREATE TABLE IF NOT EXISTS lockers (
            id SERIAL PRIMARY KEY,
            locker_number VARCHAR(20) NOT NULL UNIQUE,
            location VARCHAR(60),
            size VARCHAR(20) NOT NULL DEFAULT 'Medium',
            monthly_rent NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (monthly_rent >= 0),
            status VARCHAR(20) NOT NULL DEFAULT 'free',
            member_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
            assigned_from DATE,
            assigned_until DATE,
            notes TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_lockers_member ON lockers (member_id)');
    console.log('✅ lockers table (assignment, rent, expiry)');

    // =======================================================================
    // INVENTORY / POS — products and counter sales
    // =======================================================================
    await pool.query(`
        CREATE TABLE IF NOT EXISTS products (
            id SERIAL PRIMARY KEY,
            sku VARCHAR(40) UNIQUE,
            name VARCHAR(120) NOT NULL,
            category VARCHAR(40) NOT NULL DEFAULT 'Supplement',
            cost_price NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
            sale_price NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
            tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
            stock_qty INTEGER NOT NULL DEFAULT 0,
            reorder_level INTEGER NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS product_sales (
            id SERIAL PRIMARY KEY,
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
            member_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
            quantity INTEGER NOT NULL CHECK (quantity > 0),
            unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
            tax_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
            total NUMERIC(10,2) NOT NULL,
            method VARCHAR(20) NOT NULL DEFAULT 'Cash',
            sold_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
            invoice_id INTEGER,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_product_sales_date ON product_sales (sale_date)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_product_sales_member ON product_sales (member_id)');
    console.log('✅ products + product_sales tables (inventory & counter POS)');

    // =======================================================================
    // EXPENSES — the missing half of the ledger (payments were income only)
    // =======================================================================
    await pool.query(`
        CREATE TABLE IF NOT EXISTS expenses (
            id SERIAL PRIMARY KEY,
            category VARCHAR(40) NOT NULL,
            description VARCHAR(255) NOT NULL,
            amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
            expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
            method VARCHAR(20) NOT NULL DEFAULT 'Cash',
            vendor VARCHAR(120),
            reference VARCHAR(80),
            recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (expense_date)');
    console.log('✅ expenses table (P&L: the outgoing side of the ledger)');

    // =======================================================================
    // INVOICES — numbered, tax-bearing documents over payments / POS sales
    // =======================================================================
    await pool.query(`
        CREATE TABLE IF NOT EXISTS invoices (
            id SERIAL PRIMARY KEY,
            invoice_no VARCHAR(30) NOT NULL UNIQUE,
            member_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
            customer_name VARCHAR(120) NOT NULL,
            invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
            subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
            tax_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
            total NUMERIC(10,2) NOT NULL DEFAULT 0,
            status VARCHAR(20) NOT NULL DEFAULT 'issued',
            method VARCHAR(20),
            notes TEXT,
            issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS invoice_items (
            id SERIAL PRIMARY KEY,
            invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
            description VARCHAR(255) NOT NULL,
            hsn_sac VARCHAR(20),
            quantity NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
            unit_price NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
            tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
            tax_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
            line_total NUMERIC(10,2) NOT NULL DEFAULT 0
        )
    `);
    // invoice_no was NOT NULL and nothing more. The table lock serialises two
    // clerks issuing at the same instant, but nothing stopped a duplicate
    // arriving another way — and the series is a per-gym setting now, so a gym
    // that changes it and changes back would restart a sequence that has
    // already been used. A tax invoice number has to be unique; let the
    // database say so rather than trusting every path that writes one.
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_invoice_no ON invoices (invoice_no)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_invoices_member ON invoices (member_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices (invoice_date)');
    // An invoice is 'issued', 'paid' or 'cancelled'. The demo seeder wrote
    // 'unpaid' — a word nothing else in the product knows — so three invoices
    // sat outside every status tile and outside every filter: the tiles summed
    // to 16 while "All invoices" said 19, and there was no way to open the
    // missing three. Same fault as 'scheduled' on gym_classes; same fix, so a
    // seeder cannot invent a fourth status again.
    await pool.query("UPDATE invoices SET status = 'issued' WHERE status = 'unpaid'");
    await pool.query("UPDATE invoices SET status = 'issued' WHERE status IS NULL OR status NOT IN ('issued','paid','cancelled')");
    await pool.query(`DO $$ BEGIN
        ALTER TABLE invoices ADD CONSTRAINT invoices_status_chk
            CHECK (status IN ('issued','paid','cancelled'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    // Attendance is 'Present' or 'Absent' — the two the form offers and the
    // only two the list can colour. The column was free text all the way to
    // the database.
    await pool.query("UPDATE attendance SET status = 'Present' WHERE status IS NULL OR status NOT IN ('Present','Absent')");
    await pool.query(`DO $$ BEGIN
        ALTER TABLE attendance ADD CONSTRAINT attendance_status_chk
            CHECK (status IN ('Present','Absent'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items (invoice_id)');
    console.log('✅ invoices + invoice_items tables (numbered GST/tax invoices)');

    // =======================================================================
    // STAFF — attendance, shifts and payroll for employees (not members)
    // =======================================================================
    await pool.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_salary NUMERIC(10,2) DEFAULT 0;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2) DEFAULT 0;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS joined_on DATE;
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS staff_attendance (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            work_date DATE NOT NULL,
            check_in TIME,
            check_out TIME,
            status VARCHAR(20) NOT NULL DEFAULT 'Present',
            notes TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE (user_id, work_date)
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS staff_shifts (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            shift_date DATE NOT NULL,
            start_time TIME NOT NULL,
            end_time TIME NOT NULL,
            role_note VARCHAR(120),
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS payroll (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
            period_year INTEGER NOT NULL,
            base_salary NUMERIC(10,2) NOT NULL DEFAULT 0,
            commission NUMERIC(10,2) NOT NULL DEFAULT 0,
            deductions NUMERIC(10,2) NOT NULL DEFAULT 0,
            net_pay NUMERIC(10,2) NOT NULL DEFAULT 0,
            days_present INTEGER NOT NULL DEFAULT 0,
            status VARCHAR(20) NOT NULL DEFAULT 'draft',
            paid_on DATE,
            method VARCHAR(20),
            notes TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE (user_id, period_month, period_year)
        )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_staff_attendance_date ON staff_attendance (work_date)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_staff_shifts_date ON staff_shifts (shift_date)');
    console.log('✅ staff_attendance + staff_shifts + payroll tables (staff salary/commission columns on users)');

    // =======================================================================
    // PERSONAL TRAINING — sellable session packages + trainer commissions
    // =======================================================================
    await pool.query(`
        CREATE TABLE IF NOT EXISTS pt_packages (
            id SERIAL PRIMARY KEY,
            name VARCHAR(80) NOT NULL UNIQUE,
            sessions INTEGER NOT NULL CHECK (sessions > 0),
            price NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
            validity_days INTEGER NOT NULL DEFAULT 90 CHECK (validity_days > 0),
            trainer_commission_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS pt_subscriptions (
            id SERIAL PRIMARY KEY,
            member_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
            package_id INTEGER NOT NULL REFERENCES pt_packages(id) ON DELETE RESTRICT,
            trainer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            sessions_total INTEGER NOT NULL,
            sessions_used INTEGER NOT NULL DEFAULT 0,
            price NUMERIC(10,2) NOT NULL DEFAULT 0,
            start_date DATE NOT NULL DEFAULT CURRENT_DATE,
            expiry_date DATE,
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS pt_sessions (
            id SERIAL PRIMARY KEY,
            subscription_id INTEGER NOT NULL REFERENCES pt_subscriptions(id) ON DELETE CASCADE,
            trainer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            session_date DATE NOT NULL DEFAULT CURRENT_DATE,
            session_time TIME,
            notes TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS commissions (
            id SERIAL PRIMARY KEY,
            trainer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            source VARCHAR(30) NOT NULL,
            source_id INTEGER,
            member_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
            base_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
            percent NUMERIC(5,2) NOT NULL DEFAULT 0,
            amount NUMERIC(10,2) NOT NULL DEFAULT 0,
            earned_on DATE NOT NULL DEFAULT CURRENT_DATE,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            paid_on DATE,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_pt_subs_member ON pt_subscriptions (member_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_commissions_trainer ON commissions (trainer_id)');
    console.log('✅ pt_packages + pt_subscriptions + pt_sessions + commissions tables (personal training)');

    // =======================================================================
    // AUDIT LOG — who did what, across every module (membership_events only
    // ever covered member lifecycle actions)
    // =======================================================================
    await pool.query(`
        CREATE TABLE IF NOT EXISTS audit_log (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            username VARCHAR(50),
            action VARCHAR(20) NOT NULL,
            module VARCHAR(40) NOT NULL,
            entity_id VARCHAR(40),
            summary VARCHAR(255),
            request_id VARCHAR(80),
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_log (module)');
    console.log('✅ audit_log table (staff action trail across every module)');

    // =======================================================================
    // BRANCHES — multi-location support. Every existing row belongs to the
    // seeded "Main Branch" so single-gym installs behave exactly as before.
    // =======================================================================
    await pool.query(`
        CREATE TABLE IF NOT EXISTS branches (
            id SERIAL PRIMARY KEY,
            name VARCHAR(80) NOT NULL UNIQUE,
            code VARCHAR(20) NOT NULL UNIQUE,
            address TEXT,
            phone VARCHAR(20),
            email VARCHAR(150),
            gst_number VARCHAR(20),
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`
        INSERT INTO branches (name, code, address)
        VALUES ('Main Branch', 'MAIN', 'Head office')
        ON CONFLICT (code) DO NOTHING
    `);
    const mainBranch = (await pool.query("SELECT id FROM branches WHERE code = 'MAIN'")).rows[0];
    for (const table of ['clients', 'users', 'devices', 'expenses', 'products', 'lockers', 'invoices']) {
        await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL`);
        await pool.query(`UPDATE ${table} SET branch_id = $1 WHERE branch_id IS NULL`, [mainBranch.id]);
        // Backfilling only fixed the rows that already existed — every member,
        // product and invoice created afterwards came out with a NULL branch, so
        // a single-gym install slowly filled up with unassigned records. The
        // column default puts new rows in the main branch unless told otherwise.
        await pool.query(`ALTER TABLE ${table} ALTER COLUMN branch_id SET DEFAULT ${mainBranch.id}`);
    }
    console.log('✅ branches table + branch_id on clients/users/devices/expenses/products/lockers/invoices');

    // =======================================================================
    // E-codes for the new modules (same master table, same UI treatment)
    // =======================================================================
    await pool.query(`
        INSERT INTO exceptions (code, module, field_name, field_label, message, format_message, is_mandatory, input_type, allowed_chars, severity, sort_order) VALUES
            ('E1101', 'plans', 'name', 'Plan Name', 'PLAN NAME IS MANDATORY', NULL, TRUE, 'text', NULL, 'error', 1),
            ('E1102', 'plans', 'duration_days', 'Duration (days)', 'DURATION IS MANDATORY', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 2),
            ('E1103', 'plans', 'price', 'Price', 'PRICE IS MANDATORY', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 3),
            ('E1104', 'plans', 'signup_fee', 'Sign-up Fee', NULL, 'NUMBER ONLY ALLOWED', FALSE, 'number', 'numeric', 'error', 4),
            ('E1201', 'lockers', 'locker_number', 'Locker Number', 'LOCKER NUMBER IS MANDATORY', NULL, TRUE, 'text', NULL, 'error', 1),
            ('E1202', 'lockers', 'size', 'Size', 'SIZE IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 2),
            ('E1203', 'lockers', 'monthly_rent', 'Monthly Rent', NULL, 'NUMBER ONLY ALLOWED', FALSE, 'number', 'numeric', 'error', 3),
            ('E1204', 'lockers', 'location', 'Location', NULL, NULL, FALSE, 'text', NULL, 'error', 4),
            ('E1301', 'inventory', 'name', 'Product Name', 'PRODUCT NAME IS MANDATORY', NULL, TRUE, 'text', NULL, 'error', 1),
            ('E1302', 'inventory', 'category', 'Category', 'CATEGORY IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 2),
            ('E1303', 'inventory', 'sale_price', 'Sale Price', 'SALE PRICE IS MANDATORY', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 3),
            ('E1304', 'inventory', 'cost_price', 'Cost Price', NULL, 'NUMBER ONLY ALLOWED', FALSE, 'number', 'numeric', 'error', 4),
            ('E1305', 'inventory', 'stock_qty', 'Stock Quantity', NULL, 'NUMBER ONLY ALLOWED', FALSE, 'number', 'numeric', 'error', 5),
            ('E1401', 'expenses', 'category', 'Category', 'CATEGORY IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 1),
            ('E1402', 'expenses', 'description', 'Description', 'DESCRIPTION IS MANDATORY', NULL, TRUE, 'text', NULL, 'error', 2),
            ('E1403', 'expenses', 'amount', 'Amount', 'AMOUNT IS MANDATORY', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 3),
            ('E1404', 'expenses', 'expense_date', 'Date', 'DATE IS MANDATORY', NULL, TRUE, 'date', NULL, 'error', 4),
            ('E1405', 'expenses', 'method', 'Payment Method', 'PAYMENT METHOD IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 5),
            ('E1501', 'invoices', 'customer_name', 'Customer', 'CUSTOMER IS MANDATORY', NULL, TRUE, 'text', NULL, 'error', 1),
            ('E1502', 'invoices', 'invoice_date', 'Invoice Date', 'INVOICE DATE IS MANDATORY', NULL, TRUE, 'date', NULL, 'error', 2),
            ('E1601', 'staff', 'user_id', 'Staff Member', 'STAFF MEMBER IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 1),
            ('E1602', 'staff', 'work_date', 'Date', 'DATE IS MANDATORY', NULL, TRUE, 'date', NULL, 'error', 2),
            ('E1603', 'staff', 'status', 'Status', 'STATUS IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 3),
            ('E1701', 'pt', 'name', 'Package Name', 'PACKAGE NAME IS MANDATORY', NULL, TRUE, 'text', NULL, 'error', 1),
            ('E1702', 'pt', 'sessions', 'Sessions', 'SESSIONS IS MANDATORY', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 2),
            ('E1703', 'pt', 'price', 'Price', 'PRICE IS MANDATORY', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 3),
            ('E1801', 'branches', 'name', 'Branch Name', 'BRANCH NAME IS MANDATORY', NULL, TRUE, 'text', NULL, 'error', 1),
            ('E1802', 'branches', 'code', 'Branch Code', 'BRANCH CODE IS MANDATORY', 'LETTERS AND NUMBERS ONLY ALLOWED', TRUE, 'text', 'alphanumeric', 'error', 2)
        ON CONFLICT (module, field_name) DO NOTHING
    `);
    console.log('✅ E-codes seeded for plans / lockers / inventory / expenses / invoices / staff / pt / branches');

    // =======================================================================
    // GYM OS 2.0 — engagement, retention and front-desk workflow tables.
    //
    // Everything above this line is the 1.0 schema. What follows is new in 2.0
    // and was chosen from what the leading platforms (Mindbody, Glofox,
    // Zen Planner, Gymdesk, PushPress, Trainerize) treat as table stakes and
    // 1.0 had no answer for: churn prediction, class waitlists, referrals,
    // challenges/streaks, body-composition assessments, a staff task queue and
    // a member announcement feed.
    // =======================================================================

    // ---- Churn risk & habit streaks (cached on the member row) ----
    // Risk is recomputed by the retention service rather than joined live: the
    // dashboard reads it on every load and the underlying attendance scan is
    // far too heavy to run per request.
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS risk_score INTEGER`);
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS risk_band VARCHAR(10)`);
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS risk_reason TEXT`);
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS risk_updated_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_visit_date DATE`);
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS visit_streak INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS best_streak INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_clients_risk_band ON clients (risk_band)`);
    console.log('✅ clients risk/streak columns (churn prediction + habit streaks)');

    // Daily history so "risk is trending up/down" is answerable, not just "today".
    await pool.query(`
        CREATE TABLE IF NOT EXISTS retention_snapshots (
            id          SERIAL PRIMARY KEY,
            snapshot_on DATE NOT NULL,
            at_risk     INTEGER NOT NULL DEFAULT 0,
            watch       INTEGER NOT NULL DEFAULT 0,
            healthy     INTEGER NOT NULL DEFAULT 0,
            active      INTEGER NOT NULL DEFAULT 0,
            created_at  TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (snapshot_on)
        )
    `);
    console.log('✅ retention_snapshots table (churn trend over time)');

    // ---- Class waitlists ----
    // Deliberately NOT a new table. 1.0 already waitlists through
    // class_bookings.status = 'waitlisted' and promotes the next person when a
    // seat frees, so a parallel class_waitlist table would have been a second
    // source of truth for the same queue. What was actually missing was the
    // member-facing half: their position in the queue, and being told when they
    // get promoted. Both are handled in ClassService — see waitlistPosition()
    // and notifyPromotion().
    //
    // An early 2.0 build did create this table; drop it so an upgraded database
    // does not keep an unused one around.
    await pool.query('DROP TABLE IF EXISTS class_waitlist');
    console.log('✅ class waitlist stays on class_bookings (position + promotion notice added)');

    // ---- Referrals ----
    // Every member gets a shareable code; a referral pays out once the referred
    // person actually becomes a paying member, not when the lead is created.
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS referral_code VARCHAR(16)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_referral_code ON clients (referral_code) WHERE referral_code IS NOT NULL`);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS referrals (
            id               SERIAL PRIMARY KEY,
            referrer_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
            referred_name    VARCHAR(100) NOT NULL,
            referred_phone   VARCHAR(20),
            referred_email   VARCHAR(150),
            lead_id          INTEGER REFERENCES leads(id) ON DELETE SET NULL,
            converted_member_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
            status           VARCHAR(15) NOT NULL DEFAULT 'pending',
            reward_type      VARCHAR(20) DEFAULT 'days',
            reward_value     NUMERIC(10,2) NOT NULL DEFAULT 0,
            reward_paid_on   DATE,
            notes            TEXT,
            created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at       TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals (referrer_id)`);
    console.log('✅ referrals table + clients.referral_code (member-get-member)');

    // ---- Challenges, leaderboards & streaks ----
    await pool.query(`
        CREATE TABLE IF NOT EXISTS challenges (
            id           SERIAL PRIMARY KEY,
            name         VARCHAR(100) NOT NULL,
            description  TEXT,
            metric       VARCHAR(20) NOT NULL DEFAULT 'visits',
            goal         NUMERIC(12,2) NOT NULL DEFAULT 0,
            unit         VARCHAR(20) DEFAULT 'visits',
            starts_on    DATE NOT NULL,
            ends_on      DATE NOT NULL,
            reward       VARCHAR(150),
            status       VARCHAR(15) NOT NULL DEFAULT 'active',
            created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at   TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS challenge_participants (
            id            SERIAL PRIMARY KEY,
            challenge_id  INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
            member_id     INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
            progress      NUMERIC(12,2) NOT NULL DEFAULT 0,
            completed_on  DATE,
            joined_at     TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (challenge_id, member_id)
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_challenge_participants ON challenge_participants (challenge_id, progress DESC)`);
    console.log('✅ challenges + challenge_participants tables (gamification & leaderboards)');

    // ---- Body-composition assessments ----
    // 1.0 tracked weight only. Trainers sell on body composition, so this is a
    // full assessment record with the girths and derived numbers they quote.
    await pool.query(`
        CREATE TABLE IF NOT EXISTS assessments (
            id               SERIAL PRIMARY KEY,
            member_id        INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
            assessed_on      DATE NOT NULL,
            weight_kg        NUMERIC(6,2),
            height_cm        NUMERIC(6,2),
            body_fat_pct     NUMERIC(5,2),
            muscle_mass_kg   NUMERIC(6,2),
            visceral_fat     NUMERIC(5,2),
            bmi              NUMERIC(5,2),
            chest_cm         NUMERIC(6,2),
            waist_cm         NUMERIC(6,2),
            hip_cm           NUMERIC(6,2),
            arm_cm           NUMERIC(6,2),
            thigh_cm         NUMERIC(6,2),
            resting_hr       INTEGER,
            notes            TEXT,
            assessed_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at       TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_assessments_member ON assessments (member_id, assessed_on DESC)`);
    console.log('✅ assessments table (body composition & girths)');

    // ---- Staff task queue ----
    // Where an at-risk member, an overdue payment or an untouched lead turns
    // into something a named person has to do by a named date.
    await pool.query(`
        CREATE TABLE IF NOT EXISTS tasks (
            id           SERIAL PRIMARY KEY,
            title        VARCHAR(150) NOT NULL,
            details      TEXT,
            category     VARCHAR(25) NOT NULL DEFAULT 'follow-up',
            priority     VARCHAR(10) NOT NULL DEFAULT 'normal',
            status       VARCHAR(15) NOT NULL DEFAULT 'open',
            due_on       DATE,
            member_id    INTEGER REFERENCES clients(id) ON DELETE CASCADE,
            lead_id      INTEGER REFERENCES leads(id) ON DELETE CASCADE,
            assigned_to  INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
            completed_at TIMESTAMPTZ,
            auto_source  VARCHAR(30),
            created_at   TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_open ON tasks (status, due_on)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks (assigned_to, status)`);
    // Stops the retention sweep from raising the same follow-up every hour.
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_auto_dedupe ON tasks (member_id, auto_source) WHERE auto_source IS NOT NULL AND status = 'open'`);
    console.log('✅ tasks table (staff follow-up queue with auto-raised items)');

    // ---- Announcements (member-facing feed) ----
    await pool.query(`
        CREATE TABLE IF NOT EXISTS announcements (
            id          SERIAL PRIMARY KEY,
            title       VARCHAR(150) NOT NULL,
            body        TEXT NOT NULL,
            audience    VARCHAR(20) NOT NULL DEFAULT 'all',
            pinned      BOOLEAN NOT NULL DEFAULT FALSE,
            publish_on  DATE NOT NULL DEFAULT CURRENT_DATE,
            expires_on  DATE,
            created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    console.log('✅ announcements table (member feed)');

    // ---- Member feedback / NPS ----
    await pool.query(`
        CREATE TABLE IF NOT EXISTS member_feedback (
            id         SERIAL PRIMARY KEY,
            member_id  INTEGER REFERENCES clients(id) ON DELETE SET NULL,
            score      INTEGER NOT NULL,
            comment    TEXT,
            category   VARCHAR(25) DEFAULT 'general',
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    console.log('✅ member_feedback table (NPS & comments)');

    // ---- E-codes for the 2.0 modules (same master table, same UI treatment) ----
    await pool.query(`
        INSERT INTO exceptions (code, module, field_name, field_label, message, format_message, is_mandatory, input_type, allowed_chars, severity, sort_order) VALUES
            ('E2401', 'challenges', 'name', 'Challenge Name', 'CHALLENGE NAME IS MANDATORY', NULL, TRUE, 'text', NULL, 'error', 1),
            ('E2402', 'challenges', 'metric', 'Metric', 'METRIC IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 2),
            ('E2403', 'challenges', 'goal', 'Goal', 'GOAL IS MANDATORY', 'NUMBER ONLY ALLOWED', TRUE, 'number', 'numeric', 'error', 3),
            ('E2404', 'challenges', 'starts_on', 'Start Date', 'START DATE IS MANDATORY', NULL, TRUE, 'date', NULL, 'error', 4),
            ('E2405', 'challenges', 'ends_on', 'End Date', 'END DATE IS MANDATORY', NULL, TRUE, 'date', NULL, 'error', 5),
            ('E2501', 'assessments', 'member_id', 'Member', 'MEMBER IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 1),
            ('E2502', 'assessments', 'assessed_on', 'Assessment Date', 'ASSESSMENT DATE IS MANDATORY', NULL, TRUE, 'date', NULL, 'error', 2),
            ('E2503', 'assessments', 'weight_kg', 'Weight (kg)', NULL, 'NUMBER ONLY ALLOWED', FALSE, 'number', 'numeric', 'error', 3),
            ('E2504', 'assessments', 'body_fat_pct', 'Body Fat %', NULL, 'NUMBER ONLY ALLOWED', FALSE, 'number', 'numeric', 'error', 4),
            ('E2601', 'tasks', 'title', 'Task', 'TASK TITLE IS MANDATORY', NULL, TRUE, 'text', NULL, 'error', 1),
            ('E2602', 'tasks', 'category', 'Category', 'CATEGORY IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 2),
            ('E2603', 'tasks', 'due_on', 'Due Date', NULL, NULL, FALSE, 'date', NULL, 'error', 3),
            ('E2701', 'referrals', 'referrer_id', 'Referring Member', 'REFERRING MEMBER IS MANDATORY', NULL, TRUE, 'select', NULL, 'error', 1),
            ('E2702', 'referrals', 'referred_name', 'Friend''s Name', 'NAME IS MANDATORY', NULL, TRUE, 'text', NULL, 'error', 2),
            ('E2703', 'referrals', 'referred_phone', 'Friend''s Phone', NULL, 'NUMBER ONLY ALLOWED', FALSE, 'text', 'numeric', 'error', 3),
            ('E2801', 'announcements', 'title', 'Title', 'TITLE IS MANDATORY', NULL, TRUE, 'text', NULL, 'error', 1),
            ('E2802', 'announcements', 'body', 'Message', 'MESSAGE IS MANDATORY', NULL, TRUE, 'text', NULL, 'error', 2)
        ON CONFLICT (module, field_name) DO NOTHING
    `);
    console.log('✅ E-codes seeded for challenges / assessments / tasks / referrals / announcements');

    // ---- Referral codes ----
    // First four letters of the member's name plus their Member ID padded to
    // four digits: Gaurav, member 1, is GAUR0001.
    //
    // The old scheme was 'GYM' plus the internal row id, which was neither
    // readable nor the number on the member's card — GYM01768 belonged to
    // member 744 — despite a comment here claiming it came from the member
    // code. Codes are rewritten into the new shape, so a member who shared the
    // old one needs to share the new one.
    //
    // Mirrors ReferralCodes.forMember() on the Java side, which assigns a code
    // to every member created from now on. Change one and change the other.
    //
    // The row_number suffix is the tie-break for the one case the format can
    // collide in — Member IDs "1" and "0001" both pad to 0001 — because
    // referral_code carries a unique index and a bare UPDATE would abort the
    // whole migration.
    await pool.query(`
        WITH derived AS (
            SELECT id,
                   RPAD(
                       SUBSTRING(UPPER(REGEXP_REPLACE(COALESCE(name, ''), '[^A-Za-z]', '', 'g')) FROM 1 FOR 4),
                       4, 'X')
                   ||
                   CASE
                       WHEN LENGTH(REGEXP_REPLACE(COALESCE(member_code, ''), '[^0-9]', '', 'g')) >= 4
                           THEN REGEXP_REPLACE(COALESCE(member_code, ''), '[^0-9]', '', 'g')
                       ELSE LPAD(REGEXP_REPLACE(COALESCE(member_code, ''), '[^0-9]', '', 'g'), 4, '0')
                   END AS base
            FROM clients
        ), numbered AS (
            SELECT id, base, ROW_NUMBER() OVER (PARTITION BY base ORDER BY id) AS n
            FROM derived
        )
        UPDATE clients c
        SET referral_code = CASE WHEN n.n = 1 THEN n.base ELSE n.base || n.n::text END
        FROM numbered n
        WHERE n.id = c.id
          AND c.referral_code IS DISTINCT FROM
              (CASE WHEN n.n = 1 THEN n.base ELSE n.base || n.n::text END)
    `);
    console.log('✅ referral codes rebuilt as NAME + Member ID (e.g. GAUR0001)');


    // ── Password policy ───────────────────────────────────────────────────
    // Two rules the login screen now depends on:
    //
    //  1. Burning through the failed-attempt allowance does not just lock the
    //     account for fifteen minutes — it forces a password change. A run of
    //     wrong guesses means the password is either forgotten or being
    //     attacked, and both are best answered by replacing it.
    //  2. The replacement may not be one of the previous PASSWORD_HISTORY
    //     passwords, which is why old hashes are kept. Only hashes are stored,
    //     never anything reversible, and the row is deleted with the user.
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS must_reset_password BOOLEAN NOT NULL DEFAULT FALSE');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS password_history (
            id            SERIAL PRIMARY KEY,
            user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            password_hash VARCHAR(255) NOT NULL,
            changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_password_history_user ON password_history (user_id, changed_at DESC)');

    // Seed the history with each account's current password, so the very first
    // reset after this migration already cannot reuse what is in place today.
    await pool.query(`
        INSERT INTO password_history (user_id, password_hash)
        SELECT u.id, u.password_hash FROM users u
        WHERE NOT EXISTS (SELECT 1 FROM password_history h WHERE h.user_id = u.id)
    `);
    console.log('✅ password_history table + users.must_reset_password (reuse prevention)');


    // ── White-label branding ──────────────────────────────────────────────
    // The product is sold to many gyms, so every gym-facing name, logo and
    // contact detail is data rather than a string in the source. "GYM OS" then
    // survives only as the discreet "Powered by" line in the footer.
    //
    // These live in the existing key/value settings table: one row per field,
    // read by an unauthenticated /api/branding so the login screen can carry
    // the gym's own name before anyone has signed in.
    // Nothing is seeded here any more. The install's identity lives in
    // backend-java/src/main/resources/branding.properties (overridable by a
    // branding.properties beside the war, or GYM_BRANDING_* in the
    // environment), and this table holds only what an admin has since changed
    // in the app. Seeding defaults here made the database always win, so
    // editing the properties file changed nothing — the symptom being a gym
    // that renamed itself and still saw "GYM OS" on every screen.
    //
    // Rows still holding a shipped default are removed so the properties file
    // takes effect. Anything a gym actually customised is left alone.
    await pool.query(`
        DELETE FROM settings WHERE (key, value) IN (
            ('brand_name',      'GYM OS'),
            ('brand_tagline',   'Management System'),
            ('brand_logo',      '🏋️'),
            ('brand_colour',    '#059669'),
            ('brand_phone',     ''),
            ('brand_email',     ''),
            ('brand_address',   ''),
            ('brand_website',   ''),
            ('brand_powered_by','true')
        )
    `);
    console.log('✅ branding now comes from branding.properties (db keeps admin overrides only)');


    // ── Member passwords ──────────────────────────────────────────────────
    // The portal used to authenticate on Member ID + registered phone. Neither
    // is a secret: the ID is printed on the member's own card and the phone
    // number is known to anyone in their contacts, so one member could sign in
    // as another, read their dues, and check them in by QR.
    //
    // Members now sign in with a password. It starts at the gym-wide default
    // (set further down) and each member changes it when they choose;
    // password_set_at is NULL for as long as they have not.
    await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)');
    await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ');
    await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS must_reset_password BOOLEAN NOT NULL DEFAULT FALSE');

    // The OTP tables are keyed on a bare user_id. Members live in a different
    // table whose ids overlap with users.id, so without a scope a member's OTP
    // could satisfy a staff reset. Existing rows are all staff.
    await pool.query("ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS scope VARCHAR(10) NOT NULL DEFAULT 'staff'");
    await pool.query("ALTER TABLE otp_attempts ADD COLUMN IF NOT EXISTS scope VARCHAR(10) NOT NULL DEFAULT 'staff'");
    await pool.query('CREATE INDEX IF NOT EXISTS idx_password_resets_scope ON password_resets (scope, user_id)');

    // otp_attempts.user_id was UNIQUE on its own, which would collide the
    // moment member 5 and staff 5 both had a failed OTP. The key is the pair.
    await pool.query(`
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'otp_attempts_user_id_key') THEN
                ALTER TABLE otp_attempts DROP CONSTRAINT otp_attempts_user_id_key;
            END IF;
        END $$;
    `);
    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_otp_attempts_scope_user
        ON otp_attempts (scope, user_id)
    `);
    console.log('✅ clients password columns + OTP scope (members authenticate with a password)');


    // ── Referral reward settings ─────────────────────────────────────────
    // The offer a gym makes for a successful referral. Kept as settings rather
    // than constants so each gym can run its own promotion, and so changing it
    // never rewrites what past referrals were promised (the amount is copied
    // onto the referral row when it is created).
    await pool.query(`
        INSERT INTO settings (key, value) VALUES
            ('referral_reward_type',   'discount'),
            ('referral_reward_value',  '100'),
            ('referral_reward_plan',   'Quarterly'),
            ('referral_reward_label',  '₹100 off your next 3-month membership'),
            ('referral_enabled',       'true')
        ON CONFLICT (key) DO NOTHING
    `);
    console.log('✅ referral reward settings (member-get-member offer)');


    // ── Referral rewards that actually pay out ───────────────────────────
    // The loop the gym wants: a member shares their code, the friend gives it
    // at the desk when they sign up, and once that friend has paid in full the
    // referrer's next renewal is discounted. Three columns carry it:
    //
    //   clients.referred_by_id  who brought this member in — set once, at
    //                           onboarding, from the code they handed over.
    //   referrals.redeemed_on   when a rewarded referral was actually spent.
    //                           An earned-but-unspent reward is a referral with
    //                           reward_paid_on set and this still NULL, so the
    //                           balance is derived from the ledger rather than
    //                           kept as a second number that can drift from it.
    //   referrals.reward_note   what the receipt should say about it.
    await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS referred_by_id INTEGER');
    await pool.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'clients_referred_by_id_fkey'
            ) THEN
                ALTER TABLE clients ADD CONSTRAINT clients_referred_by_id_fkey
                    FOREIGN KEY (referred_by_id) REFERENCES clients(id) ON DELETE SET NULL;
            END IF;
        END $$;
    `);
    await pool.query('ALTER TABLE referrals ADD COLUMN IF NOT EXISTS redeemed_on DATE');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_clients_referred_by ON clients (referred_by_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_referrals_converted ON referrals (converted_member_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_referrals_phone ON referrals (referrer_id, referred_phone)');
    console.log('✅ referral rewards (referred_by_id, redeemed_on) — discount applies on renewal');


    // ── Member portal: everyone starts on the default password ───────────
    // The gym hands a new member their ID at the desk and wants them able to
    // sign in on the spot, so every member's password starts as "admin" and
    // they change it whenever they like. The trade is deliberate and the
    // owner's call: until a member changes it, anyone holding their Member ID
    // can open their portal. What makes that survivable is that the portal is
    // read-mostly — attendance is no longer something a member can write, it
    // is marked only when staff scan the QR in the main app.
    //
    // The hash is a literal rather than generated per run so the migration is
    // deterministic and re-running it never invalidates anyone's login. It is
    // BCrypt("admin"), cost 10 — no secret to protect, the password is public
    // by design.
    const DEFAULT_MEMBER_PASSWORD_HASH =
        '$2b$10$sOOEabmhG.aZIwAeMpbhP.CnyIPVWZXXZGBl87e6ZCMLv/KO3yUOa';

    // New members inherit it without every insert path having to remember to
    // set it — imports and the API alike.
    await pool.query(
        `ALTER TABLE clients ALTER COLUMN password_hash SET DEFAULT '${DEFAULT_MEMBER_PASSWORD_HASH}'`);

    // Existing members who never completed the old activation handshake.
    // password_set_at stays NULL: that NULL is what "still on the default"
    // means, and it is what makes the portal nag them to change it.
    await pool.query(
        `UPDATE clients SET password_hash = '${DEFAULT_MEMBER_PASSWORD_HASH}'
         WHERE password_hash IS NULL OR password_hash = ''`);
    console.log('✅ member portal default password (every member starts on "admin")');


    // ── Usernames are case-insensitive ───────────────────────────────────
    // A phone keyboard capitalises the first letter of a text field, so a
    // trainer signing in from the floor types "Munna" and the account is
    // "munna". Treating those as different accounts is a login failure with no
    // visible cause — and worse, it gave a password guesser a fresh
    // five-attempt allowance for every capitalisation of the same name,
    // because the throttle counts per username string.
    //
    // Existing rows are folded to lower case (the canonical form the app now
    // stores), and a unique index on LOWER(username) stops two accounts that
    // differ only in case ever existing again.
    await pool.query(`UPDATE users SET username = LOWER(username) WHERE username <> LOWER(username)`);
    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username))
    `);
    console.log('✅ usernames folded to lower case + case-insensitive unique index');


    // ── Personal training is sold by duration, not by session ────────────
    // The gym sells PT the way it sells membership: a monthly, 3-month,
    // 6-month or yearly plan at a monthly fee, with the trainer's time
    // included. Counting sessions was the wrong model — it made the desk
    // tick off visits nobody was tracking, and the member's portal showed a
    // "9 of 12 left" figure that meant nothing to them.
    //
    // Sessions survive as an optional cap for gyms that do sell blocks of
    // them: NULL means "unlimited for the duration", which is the default.
    await pool.query(
        "ALTER TABLE pt_packages ADD COLUMN IF NOT EXISTS plan_type VARCHAR(20) NOT NULL DEFAULT 'Monthly'");
    await pool.query('ALTER TABLE pt_packages ALTER COLUMN sessions DROP NOT NULL');
    await pool.query('ALTER TABLE pt_packages DROP CONSTRAINT IF EXISTS pt_packages_sessions_check');
    await pool.query(`
        ALTER TABLE pt_packages ADD CONSTRAINT pt_packages_sessions_check
        CHECK (sessions IS NULL OR sessions > 0)
    `);
    await pool.query('ALTER TABLE pt_subscriptions ALTER COLUMN sessions_total DROP NOT NULL');

    // Existing packages keep their session count but gain the plan type their
    // validity already implies, so nothing that was sold changes shape.
    await pool.query(`
        UPDATE pt_packages SET plan_type = CASE
            WHEN validity_days >= 330 THEN 'Yearly'
            WHEN validity_days >= 165 THEN 'Half-Yearly'
            WHEN validity_days >= 80  THEN 'Quarterly'
            ELSE 'Monthly'
        END
        WHERE plan_type = 'Monthly' AND validity_days >= 80
    `);
    console.log('✅ PT sold by duration (plan_type); session caps optional');


    // ── A payment has to say what it bought ──────────────────────────────
    // Every receipt printed the member's *current* membership plan and expiry,
    // whatever the money was actually for. A ₹9,000 personal-training receipt
    // claimed the plan was "Yearly, valid until 11 August 2027"; so did a
    // receipt for settling ₹200 of dues. That is a financial document stating
    // something untrue, and the member keeps it.
    //
    // A payment now records its purpose, what it paid for, and — the part that
    // cannot be reconstructed afterwards — the plan name and the period as
    // they stood on the day it was taken. A plan renamed or repriced next year
    // must not rewrite a receipt already in somebody's hands.
    await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS purpose VARCHAR(24)');
    await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS reference_id INTEGER');
    await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS plan_name VARCHAR(80)');
    await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS period_start DATE');
    await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS period_end DATE');
    await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS discount NUMERIC(10,2) NOT NULL DEFAULT 0');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_payments_purpose ON payments (purpose)');

    // Backfill, in the order that leaves the least guesswork. PT payments name
    // their package in the note, so they identify themselves exactly.
    await pool.query(`
        UPDATE payments SET purpose = 'pt',
                            plan_name = btrim(substring(note from '^PT (?:package|plan): (.*)$'))
        WHERE purpose IS NULL AND note ~ '^PT (package|plan): '
    `);
    await pool.query(`
        UPDATE payments p
        SET reference_id = x.id, period_start = x.start_date, period_end = x.expiry_date
        FROM (
            SELECT DISTINCT ON (s.member_id, k.name, s.price)
                   s.id, s.member_id, s.start_date, s.expiry_date, s.price, k.name AS pkg
            FROM pt_subscriptions s JOIN pt_packages k ON k.id = s.package_id
            ORDER BY s.member_id, k.name, s.price, s.id DESC
        ) x
        WHERE p.purpose = 'pt' AND p.reference_id IS NULL
          AND x.member_id = p.member_id AND x.pkg = p.plan_name AND x.price = p.amount
    `);
    await pool.query(`
        UPDATE payments SET purpose = 'dues'
        WHERE purpose IS NULL AND note ILIKE '%dues%'
    `);
    await pool.query("UPDATE payments SET purpose = 'membership' WHERE purpose IS NULL");

    // Only the newest membership payment of each member can be tied to the
    // term the member is on now. Older ones bought terms nobody recorded, so
    // they keep a NULL period and their receipt simply leaves the line off —
    // far better than printing today's dates over a payment from 2023.
    await pool.query(`
        UPDATE payments p
        SET plan_name = c.membership_type, period_start = c.membership_start,
            period_end = c.membership_expiry
        FROM clients c
        WHERE c.id = p.member_id AND p.purpose = 'membership' AND p.plan_name IS NULL
          AND c.membership_start IS NOT NULL
          AND p.payment_date >= c.membership_start - 7
          AND p.id = (SELECT MAX(q.id) FROM payments q
                      WHERE q.member_id = p.member_id AND q.purpose = 'membership')
    `);
    console.log('✅ payments carry their purpose, plan and period (receipts stop guessing)');


    // ── Member IDs are a sequence, and an ID belongs to one person ────────
    // The desk was inventing IDs by hand, so they arrived in no order and two
    // people could be given the same one on different shifts. They are now
    // handed out in order — 1, 2, 3 — and the form fills the next one in.
    //
    // An ID belongs to whoever was given it for as long as their record
    // exists, deactivated or not: a member who comes back after two years is
    // still 47, and nobody else was ever 47 in the meantime. Only deleting the
    // record gives the number up, and then it goes to the front of the queue
    // so the sequence does not grow holes forever.
    //
    // This table records that history. `clients` remains the authority on what
    // is taken right now; this says which numbers have been handed out before
    // and which of those have since been given back.
    await pool.query(`
        CREATE TABLE IF NOT EXISTS member_codes (
            code             INTEGER PRIMARY KEY,
            member_id        INTEGER,
            first_issued_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            released_at      TIMESTAMPTZ
        )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_member_codes_released ON member_codes (released_at)');

    // Everything already issued counts as held by whoever holds it.
    await pool.query(`
        INSERT INTO member_codes (code, member_id, released_at)
        SELECT member_code::int, id, NULL FROM clients WHERE member_code ~ '^[0-9]+$'
        ON CONFLICT (code) DO UPDATE SET member_id = EXCLUDED.member_id, released_at = NULL
    `);
    console.log('✅ member IDs issued in sequence, held for life, freed only by deletion');


    await pool.end();
})().catch((err) => {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
});
