#!/usr/bin/env node
/**
 * One day's worth of gym activity: new members onboarded, and the floor
 * checking in. Installed by the deploy as a daily cron entry.
 *
 *   node seed-daily.js
 *
 *   NEW_MIN / NEW_MAX    members to onboard today        (default 20 / 30)
 *   ATTEND_MIN/ATTEND_MAX members to check in today      (default 450 / 600)
 *   PT_PCT               share of new members taking PT  (default 35)
 *   FORCE=1              onboard again even if today already has intake
 *
 * Safe to run more than once a day. Attendance is ON CONFLICT DO NOTHING
 * against the (member_id, date) unique index, and onboarding checks what has
 * already joined today and stops rather than doubling up — a cron that
 * retries, or a hand-run after one, does not inflate the numbers.
 *
 * Member IDs come from the same query the application uses
 * (ClientDaoImpl.nextMemberCode): a number freed by a deletion goes first,
 * otherwise the sequence continues from its high-water mark. Reimplementing
 * that as "max + 1" would eventually hand out a code the app considers taken.
 *
 * The generator is seeded from the date, so a given day always produces the
 * same intake however often this runs, while each new day differs.
 *
 * Connection settings come from the environment, same names as migrate.js.
 */

const path = require('path');
const { Pool } = require('pg');

for (const candidate of ['.env', '../.env', '../../.env', '../../backend/.env']) {
    require('dotenv').config({ path: path.resolve(__dirname, candidate) });
}

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

const NEW_MIN = Number(envOr('NEW_MIN', '20'));
const NEW_MAX = Number(envOr('NEW_MAX', '30'));
const ATTEND_MIN = Number(envOr('ATTEND_MIN', '450'));
const ATTEND_MAX = Number(envOr('ATTEND_MAX', '600'));
const PT_PCT = Number(envOr('PT_PCT', '35'));
const FORCE = envOr('FORCE', '') === '1';

const today = new Date().toISOString().slice(0, 10);

// Seeded from the date: the same day always produces the same intake however
// often this runs, and every new day differs.
let seed = Number(today.replace(/-/g, ''));
const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
};
const pick = (a) => a[Math.floor(rand() * a.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pad = (n) => String(n).padStart(2, '0');

const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Reyansh', 'Krishna',
    'Ishaan', 'Rohan', 'Kabir', 'Anaya', 'Diya', 'Aadhya', 'Saanvi', 'Ananya',
    'Pari', 'Myra', 'Sara', 'Ira', 'Riya', 'Rahul', 'Priya', 'Neha', 'Amit',
    'Sneha', 'Vikram', 'Pooja', 'Manish', 'Divya', 'Karan', 'Meera', 'Sanjay',
    'Kavita', 'Girish', 'Bharti', 'Mahesh', 'Sangeeta', 'Dhruv', 'Nisha', 'Arun'];

const LAST = ['Sharma', 'Verma', 'Nair', 'Iyer', 'Joshi', 'Mukherjee', 'Banerjee',
    'Das', 'Kapoor', 'Dubey', 'Reddy', 'Patel', 'Mehta', 'Kulkarni', 'Bose',
    'Nayar', 'Chatterjee', 'Gupta', 'Singh', 'Rao', 'Pillai', 'Desai', 'Shetty',
    'Malhotra', 'Chauhan', 'Bhat', 'Menon', 'Tiwari', 'Saxena', 'Ghosh'];

// Weighted towards the shorter plans, which is how gyms actually sell.
const PLAN_WEIGHTS = [
    ['Monthly', 45], ['Quarterly', 28], ['Half-Yearly', 17], ['Yearly', 10],
];
const weightedPlan = () => {
    let r = rand() * 100;
    for (const [name, w] of PLAN_WEIGHTS) {
        if ((r -= w) <= 0) return name;
    }
    return 'Monthly';
};

const METHODS = ['Cash', 'UPI', 'UPI', 'Card', 'Bank Transfer', 'Online'];

const checkInTime = () => {
    const morning = rand() < 0.55;
    const hour = morning ? 6 + Math.floor(rand() * 4) : 17 + Math.floor(rand() * 4);
    return `${pad(hour)}:${pad(Math.floor(rand() * 60))}:${pad(Math.floor(rand() * 60))}`;
};

// The application's own allocator, verbatim — see the note at the top.
const NEXT_CODE_SQL = `
    WITH taken AS (
        SELECT member_code::int AS code FROM clients WHERE member_code ~ '^[0-9]+$'
    ),
    freed AS (
        SELECT code FROM member_codes
        WHERE released_at IS NOT NULL AND code NOT IN (SELECT code FROM taken)
    ),
    issued AS (
        SELECT code FROM taken UNION SELECT code FROM member_codes
    )
    SELECT COALESCE(
        (SELECT MIN(code) FROM freed),
        (SELECT COALESCE(MAX(code), 0) + 1 FROM issued)) AS code`;

async function ensurePtPackages(db) {
    const { rows } = await db.query('SELECT id, name, sessions, price, validity_days FROM pt_packages WHERE is_active');
    if (rows.length > 0) return rows;

    // migrate.js creates the table but seeds no packages, so a PT sale has
    // nothing to reference on a fresh install.
    await db.query(`
        INSERT INTO pt_packages (name, sessions, price, validity_days, trainer_commission_percent)
        VALUES ('PT 12 sessions', 12,  9000, 90,  25),
               ('PT 24 sessions', 24, 16000, 180, 25),
               ('PT 36 sessions', 36, 22000, 270, 30)
        ON CONFLICT (name) DO NOTHING`);
    const { rows: seeded } = await db.query('SELECT id, name, sessions, price, validity_days FROM pt_packages WHERE is_active');
    console.log(`   seeded ${seeded.length} PT package(s) — none existed`);
    return seeded;
}

async function onboard(db) {
    const { rows: [{ n: joinedToday }] } = await db.query(
        'SELECT count(*)::int AS n FROM clients WHERE join_date = CURRENT_DATE');

    if (joinedToday >= NEW_MIN && !FORCE) {
        console.log(`   ${joinedToday} member(s) already joined today — skipping intake (FORCE=1 to override)`);
        return 0;
    }

    const target = between(NEW_MIN, NEW_MAX);
    const { rows: plans } = await db.query(
        'SELECT name, duration_days, price FROM plans WHERE is_active AND name <> $1', ['Custom']);
    const planByName = Object.fromEntries(plans.map((p) => [p.name, p]));

    const ptPackages = await ensurePtPackages(db);
    const { rows: trainers } = await db.query(
        "SELECT id FROM users WHERE role IN ('trainer','admin') ORDER BY id");

    let created = 0;
    let withPt = 0;

    for (let i = 0; i < target; i++) {
        const { rows: [{ code }] } = await db.query(NEXT_CODE_SQL);
        const name = `${pick(FIRST)} ${pick(LAST)}`;
        const plan = planByName[weightedPlan()] || plans[0];
        if (!plan) throw new Error('no membership plans defined');

        const phone = `9${between(100000000, 999999999)}`;
        const gender = rand() < 0.62 ? 'Male' : 'Female';
        const dobYear = between(1975, 2006);
        const fee = Number(plan.price);
        // Most pay in full at the desk; a few leave a balance.
        const paid = rand() < 0.82 ? fee : Math.round(fee * (0.3 + rand() * 0.4));
        const trainer = trainers.length ? pick(trainers).id : null;

        const { rows: [client] } = await db.query(`
            INSERT INTO clients (member_code, name, phone, email, gender, dob,
                                 join_date, membership_type, membership_start,
                                 membership_expiry, membership_fee, amount_paid,
                                 amount_due, payment_mode, trainer_id, status)
            VALUES ($1::text, $2, $3, $4, $5, $6,
                    CURRENT_DATE, $7, CURRENT_DATE,
                    CURRENT_DATE + ($8 || ' days')::interval, $9, $10,
                    $11, $12, $13, 'active')
            RETURNING id`,
            [code, name, phone,
             `${name.toLowerCase().replace(/\s+/g, '.')}.${code}@example.com`,
             gender, `${dobYear}-${pad(between(1, 12))}-${pad(between(1, 28))}`,
             plan.name, plan.duration_days, fee, paid, fee - paid,
             pick(METHODS), trainer]);

        await db.query(`
            INSERT INTO member_codes (code, member_id, released_at)
            VALUES ($1::int, $2, NULL)
            ON CONFLICT (code) DO UPDATE SET member_id = EXCLUDED.member_id, released_at = NULL`,
            [code, client.id]);

        if (paid > 0) {
            await db.query(`
                INSERT INTO payments (member_id, amount, payment_date, method, purpose,
                                      plan_name, period_start, period_end, note)
                VALUES ($1, $2, CURRENT_DATE, $3, 'membership', $4,
                        CURRENT_DATE, CURRENT_DATE + ($5 || ' days')::interval, $6)`,
                [client.id, paid, pick(METHODS), plan.name, plan.duration_days,
                 `${plan.name} membership`]);
        }

        if (ptPackages.length && rand() * 100 < PT_PCT) {
            const pkg = pick(ptPackages);
            await db.query(`
                INSERT INTO pt_subscriptions (member_id, package_id, trainer_id,
                                              sessions_total, sessions_used, price,
                                              start_date, expiry_date, status)
                VALUES ($1, $2, $3, $4, 0, $5,
                        CURRENT_DATE, CURRENT_DATE + ($6 || ' days')::interval, 'active')`,
                [client.id, pkg.id, trainer, pkg.sessions, pkg.price, pkg.validity_days]);

            await db.query(`
                INSERT INTO payments (member_id, amount, payment_date, method, purpose, note)
                VALUES ($1, $2, CURRENT_DATE, $3, 'pt', $4)`,
                [client.id, pkg.price, pick(METHODS), pkg.name]);
            withPt++;
        }
        created++;
    }

    console.log(`   onboarded ${created} member(s) — ${withPt} with personal training`);
    return created;
}

async function markAttendance(db) {
    const target = between(ATTEND_MIN, ATTEND_MAX);
    const { rows: members } = await db.query(`
        SELECT id, name FROM clients
        WHERE status = 'active'
          AND (membership_expiry IS NULL OR membership_expiry >= CURRENT_DATE)
        ORDER BY random()
        LIMIT $1`, [target]);

    if (members.length === 0) {
        console.log('   no active members to check in');
        return 0;
    }

    const rows = members.map((m) => [m.id, m.name, today, checkInTime(),
                                     rand() < 0.7 ? 'device' : 'manual']);
    const values = rows.map((_, i) => {
        const b = i * 5;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, 'Present', $${b + 5})`;
    }).join(', ');

    const res = await db.query(`
        INSERT INTO attendance (member_id, member_name, date, time, status, source)
        VALUES ${values}
        ON CONFLICT (member_id, date) DO NOTHING`, rows.flat());

    console.log(`   ${res.rowCount} check-in(s) marked, ${rows.length - res.rowCount} already present`);
    return res.rowCount;
}

(async () => {
    console.log(`${new Date().toISOString()} daily seed for ${today}`);
    const db = await pool.connect();
    try {
        // One transaction: a failure part-way through leaves no member without
        // their payment row, and no code claimed for a member that was never
        // inserted.
        await db.query('BEGIN');
        await onboard(db);
        await markAttendance(db);
        await db.query('COMMIT');
    } catch (err) {
        await db.query('ROLLBACK');
        throw err;
    } finally {
        db.release();
    }

    const { rows: [s] } = await pool.query(`
        SELECT (SELECT count(*) FROM clients) AS members,
               (SELECT count(*) FROM clients WHERE join_date = CURRENT_DATE) AS joined_today,
               (SELECT count(*) FROM attendance WHERE date = CURRENT_DATE) AS present_today,
               (SELECT COALESCE(sum(amount), 0) FROM payments WHERE payment_date = CURRENT_DATE) AS collected_today`);
    console.log(`✅ ${s.members} members total · ${s.joined_today} joined today · ` +
                `${s.present_today} present today · ₹${s.collected_today} collected today`);

    await pool.end();
})().catch((err) => {
    console.error('❌ daily seed failed:', err.message);
    process.exit(1);
});
