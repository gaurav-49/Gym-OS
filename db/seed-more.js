#!/usr/bin/env node
/**
 * Additive demo data for GYM OS 2.0.
 *
 *   node seed-more.js             # into $DB_NAME (default gymdb)
 *
 * This script only ever INSERTs. It has no --wipe, it issues no DELETE and no
 * UPDATE that discards anything, and it is safe to run against a database that
 * already holds real records. seed-demo.js is the one that rebuilds the world;
 * this one fills the gaps in whatever is already there.
 *
 * Why it exists. The portal has ten tabs, and a member only ever sees the tabs
 * their own data reaches. Measured before this ran: of 620 active members,
 * 55 had a workout plan, 55 had a diet plan, 55 had progress records, 98 had
 * any attendance and 101 had ever booked a class. So the overwhelming majority
 * of members signed in and found five empty tabs — the product looked broken
 * to everyone except the handful of showcase accounts.
 *
 * It therefore does two things:
 *   1. adds a fresh intake of members, each fully populated; and
 *   2. backfills every active member who is missing data in a tab, and only
 *      that tab — a member who already has workouts keeps exactly the ones
 *      they have.
 *
 * PT and Locker are deliberately NOT given to everyone: those tabs are gated on
 * having actually bought the thing, and handing every member a locker would
 * make the gating meaningless. They go to a slice, as they would in a real gym.
 */
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'gymdb',
    user: process.env.DB_USER || process.env.USER,
    password: process.env.DB_PASSWORD || undefined,
});

// BCrypt("admin") — the gym-wide default every member starts on.
const DEFAULT_MEMBER_HASH = '$2b$10$sOOEabmhG.aZIwAeMpbhP.CnyIPVWZXXZGBl87e6ZCMLv/KO3yUOa';

const q = (sql, params) => pool.query(sql, params);
const day = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
};
const pick = (arr, i) => arr[i % arr.length];
const money = (n) => Number(Number(n).toFixed(2));

const FIRST = ['Arnav', 'Diya', 'Kabir', 'Myra', 'Reyansh', 'Anika', 'Vivaan', 'Saanvi',
    'Ayaan', 'Kiara', 'Shaurya', 'Prisha', 'Atharv', 'Navya', 'Dhruv', 'Aadhya',
    'Krish', 'Ira', 'Yuvan', 'Mira'];
const LAST = ['Chaudhary', 'Nair', 'Malhotra', 'Sethi', 'Banerjee', 'Rao', 'Kulkarni',
    'Pillai', 'Trivedi', 'Sinha'];

const PLANS = ['Monthly', 'Quarterly', 'Half-Yearly', 'Yearly'];
const PLAN_DAYS = { Monthly: 30, Quarterly: 90, 'Half-Yearly': 180, Yearly: 365 };
const PLAN_FEE = { Monthly: 2000, Quarterly: 5400, 'Half-Yearly': 9600, Yearly: 18000 };
const METHODS = ['Cash', 'UPI', 'Card', 'Online'];

// A six-day push/pull/legs split, so a member who opens Workouts sees a real
// week rather than three token rows.
const SPLIT = [
    ['Monday', 'Barbell Bench Press', 4, 8, 45, 90, 'Control the negative'],
    ['Monday', 'Incline Dumbbell Press', 3, 10, 20, 75, ''],
    ['Monday', 'Cable Fly', 3, 12, 15, 60, 'Squeeze at the top'],
    ['Tuesday', 'Deadlift', 4, 5, 90, 150, 'Brace before every rep'],
    ['Tuesday', 'Bent-over Row', 4, 8, 50, 90, ''],
    ['Tuesday', 'Face Pull', 3, 15, 20, 45, 'Rear delts, not traps'],
    ['Wednesday', 'Back Squat', 4, 6, 80, 150, 'Depth over weight'],
    ['Wednesday', 'Romanian Deadlift', 3, 10, 60, 90, ''],
    ['Wednesday', 'Walking Lunge', 3, 12, 16, 60, ''],
    ['Thursday', 'Overhead Press', 4, 8, 35, 90, ''],
    ['Thursday', 'Lateral Raise', 4, 15, 8, 45, 'Lead with the elbow'],
    ['Friday', 'Pull-up', 4, 8, 0, 90, 'Add weight when 10 is easy'],
    ['Friday', 'Barbell Curl', 3, 10, 25, 60, ''],
    ['Saturday', 'Hip Thrust', 4, 10, 70, 75, ''],
    ['Saturday', 'Plank', 3, 1, 0, 45, '60 seconds per set'],
];

const DIET = [
    ['Breakfast', 'Oats, whey and blueberries', 420, 32, 54, 8, ''],
    ['Breakfast', '4 egg whites + 2 brown toast', 320, 28, 34, 6, ''],
    ['Lunch', 'Grilled chicken, brown rice, salad', 620, 48, 62, 14, ''],
    ['Lunch', 'Rajma, rice and curd', 560, 24, 78, 12, 'Vegetarian day'],
    ['Snacks', 'Whey shake and a banana', 280, 26, 32, 3, 'Within 30 min of training'],
    ['Snacks', 'Roasted chana and green tea', 190, 12, 26, 4, ''],
    ['Dinner', 'Paneer bhurji with 2 roti', 520, 30, 44, 22, ''],
    ['Dinner', 'Grilled fish and sauteed greens', 440, 42, 12, 20, ''],
    ['Supplements', 'Creatine 5g + vitamin D3', 20, 0, 0, 0, 'Daily, timing does not matter'],
];

const CLASS_NOTES = ['booked', 'booked', 'attended', 'waitlist'];

let added = {};
const bump = (k, n = 1) => { added[k] = (added[k] || 0) + n; };

// ── 1. a fresh intake ───────────────────────────────────────────────────────
// Member codes follow the product's own rule: the lowest freed code, else the
// highest ever issued + 1. Reproducing it here rather than inventing numbers
// keeps the ledger in member_codes honest.
async function nextCode() {
    const { rows } = await q(`
        WITH taken AS (SELECT member_code::int AS code FROM clients WHERE member_code ~ '^[0-9]+$'),
        freed AS (SELECT code FROM member_codes WHERE released_at IS NOT NULL
                  AND code NOT IN (SELECT code FROM taken)),
        issued AS (SELECT code FROM taken UNION SELECT code FROM member_codes)
        SELECT COALESCE((SELECT MIN(code) FROM freed),
                        (SELECT COALESCE(MAX(code),0)+1 FROM issued)) AS code`);
    return Number(rows[0].code);
}

async function addMembers(count) {
    const out = [];
    for (let i = 0; i < count; i++) {
        const code = await nextCode();
        const name = `${pick(FIRST, i)} ${pick(LAST, i)}`;
        const plan = pick(PLANS, i);
        const days = PLAN_DAYS[plan];
        const fee = PLAN_FEE[plan];
        // Joined somewhere in the last few weeks, so the term still has a long
        // runway and the portal shows a healthy ring rather than a red one.
        const start = day(-(i * 3) - 2);
        const expiry = day(days - (i * 3) - 2);
        const { rows } = await q(`
            INSERT INTO clients (member_code, name, phone, email, gender, address,
                                 join_date, membership_type, membership_start, membership_expiry,
                                 membership_fee, amount_paid, amount_due, status, password_hash,
                                 must_reset_password)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,'active',$13,false)
            RETURNING id, member_code, name`,
            [String(code), name,
             `98${String(40000000 + i * 1237).slice(0, 8)}`,
             `${name.split(' ')[0].toLowerCase()}.${code}@example.com`,
             i % 2 ? 'Female' : 'Male',
             `${10 + i} Station Road, Jehanabad`,
             start, plan, start, expiry, money(fee), money(fee), DEFAULT_MEMBER_HASH]);
        const refCode = (name.replace(/[^A-Za-z]/g, '').toUpperCase() + 'XXXX')
            .slice(0, 4) + String(code).padStart(4, '0');
        await q(`UPDATE clients SET referral_code = $1 WHERE id = $2
                 AND NOT EXISTS (SELECT 1 FROM clients WHERE referral_code = $1)`,
            [refCode, rows[0].id]);
        await q(`INSERT INTO member_codes (code, member_id) VALUES ($1,$2)
                 ON CONFLICT (code) DO UPDATE SET member_id = EXCLUDED.member_id,
                                                 released_at = NULL`,
            [code, rows[0].id]);
        // The payment says what it bought, so the receipt does not have to guess.
        await q(`INSERT INTO payments (member_id, amount, payment_date, method, note,
                                       purpose, plan_name, period_start, period_end, discount)
                 VALUES ($1,$2,$3,$4,$5,'membership',$6,$7,$8,0)`,
            [rows[0].id, money(fee), start, pick(METHODS, i),
             `${plan} membership`, plan, start, expiry]);
        out.push(rows[0]);
        bump('members');
        bump('payments');
    }
    return out;
}

// ── 2. backfill, tab by tab ─────────────────────────────────────────────────
// Each of these asks "who is missing this?" and writes only for them, so the
// script can be run twice without doubling anybody's plan.

async function targets(table, column = 'member_id') {
    const { rows } = await q(`
        SELECT c.id, c.name FROM clients c
        WHERE c.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM ${table} t WHERE t.${column} = c.id)
        ORDER BY c.id`);
    return rows;
}

async function fillWorkouts() {
    const rows = await targets('workout_plans');
    for (const [i, m] of rows.entries()) {
        // Six of the fifteen, rotated, so two members rarely share a page.
        // The stride MUST be coprime with SPLIT.length or it revisits rows: at
        // stride 3 over 15, gcd is 3, so it only ever reaches 5 distinct entries
        // and k=0 and k=5 landed on the same exercise — every member seeded here
        // got their first movement listed twice. 4 and 15 are coprime.
        for (let k = 0; k < 6; k++) {
            const [d, ex, sets, reps, weight, rest, notes] = SPLIT[(i * 5 + k * 4) % SPLIT.length];
            await q(`INSERT INTO workout_plans (member_id, day, exercise, sets, reps, weight, rest_seconds, notes)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [m.id, d, ex, sets, String(reps), weight, rest, notes || null]);
            bump('workout rows');
        }
    }
    return rows.length;
}

async function fillDiet() {
    const rows = await targets('diet_plans');
    for (const [i, m] of rows.entries()) {
        for (let k = 0; k < 5; k++) {
            const [meal, food, cal, p, c, f, notes] = DIET[(i * 4 + k * 2) % DIET.length];
            await q(`INSERT INTO diet_plans (member_id, meal, food_item, calories, protein_g, carbs_g, fats_g, notes)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [m.id, meal, food, cal, p, c, f, notes || null]);
            bump('diet rows');
        }
    }
    return rows.length;
}

async function fillProgress() {
    const rows = await targets('member_progress');
    for (const [i, m] of rows.entries()) {
        // Five readings over five months, trending the way someone training
        // consistently would: weight down a little, arms and chest up.
        const base = 68 + (i % 22);
        for (let k = 4; k >= 0; k--) {
            await q(`INSERT INTO member_progress (member_id, record_date, weight, body_fat,
                                                  chest, waist, arms, thighs, shoulders, notes)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [m.id, day(-k * 30 - 3),
                 money(base + k * 0.9), money(24 - (4 - k) * 0.6),
                 money(96 + (4 - k) * 0.5), money(86 - (4 - k) * 0.8),
                 money(33 + (4 - k) * 0.4), money(55 + (4 - k) * 0.3),
                 money(112 + (4 - k) * 0.4),
                 k === 0 ? 'On track — strength up across the board' : null]);
            bump('progress rows');
        }
    }
    return rows.length;
}

async function fillAttendance() {
    const rows = await targets('attendance');
    for (const [i, m] of rows.entries()) {
        // Twelve visits over the last six weeks, on a pattern rather than at
        // random, so the portal's 30-day strip shows a habit with gaps in it.
        for (let k = 0; k < 12; k++) {
            const offset = -(k * 3 + (i % 3));
            const hour = 6 + ((i + k) % 4);
            await q(`INSERT INTO attendance (member_id, member_name, date, time, status, source)
                     VALUES ($1,$2,$3,$4,'Present',$5)`,
                [m.id, m.name, day(offset),
                 `${String(hour).padStart(2, '0')}:${String((i * 7 + k * 11) % 60).padStart(2, '0')}:00`,
                 pick(['qr', 'device', 'manual'], i + k)]);
            bump('attendance rows');
        }
    }
    return rows.length;
}

async function fillBookings() {
    const { rows: classes } = await q(
        `SELECT id, capacity FROM gym_classes WHERE status <> 'cancelled' ORDER BY class_date DESC LIMIT 40`);
    if (!classes.length) return 0;
    const rows = await targets('class_bookings');
    for (const [i, m] of rows.entries()) {
        for (let k = 0; k < 3; k++) {
            const cls = classes[(i * 3 + k) % classes.length];
            await q(`INSERT INTO class_bookings (class_id, member_id, status)
                     VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
                [cls.id, m.id, pick(CLASS_NOTES, i + k)]);
            bump('class bookings');
        }
    }
    return rows.length;
}

// ── 3. the gated tabs, for a slice only ─────────────────────────────────────

async function fillPersonalTraining(limit, order = 'ASC') {
    const { rows: pkgs } = await q(
        `SELECT id, name, plan_type, price, validity_days FROM pt_packages WHERE is_active = true ORDER BY id`);
    const { rows: trainers } = await q(
        `SELECT id, name FROM users WHERE role = 'trainer' ORDER BY id`);
    if (!pkgs.length || !trainers.length) return 0;

    const { rows } = await q(`
        SELECT c.id, c.name FROM clients c
        WHERE c.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM pt_subscriptions s WHERE s.member_id = c.id)
        ORDER BY c.id ${order === 'DESC' ? 'DESC' : 'ASC'} LIMIT $1`, [limit]);

    for (const [i, m] of rows.entries()) {
        const pkg = pick(pkgs, i);
        const trainer = pick(trainers, i);
        const days = Number(pkg.validity_days) || 90;
        const start = day(-(i % 40) - 5);
        const expiry = day(days - (i % 40) - 5);
        const { rows: sub } = await q(`
            INSERT INTO pt_subscriptions (member_id, package_id, trainer_id, sessions_total,
                                          sessions_used, price, start_date, expiry_date, status)
            VALUES ($1,$2,$3,NULL,0,$4,$5,$6,'active') RETURNING id`,
            [m.id, pkg.id, trainer.id, money(pkg.price), start, expiry]);
        // PT money is its own payment, never folded into the membership — the
        // Membership tab filters on purpose to keep the two apart.
        await q(`INSERT INTO payments (member_id, amount, payment_date, method, note,
                                       purpose, reference_id, plan_name, period_start, period_end, discount)
                 VALUES ($1,$2,$3,$4,$5,'pt',$6,$7,$8,$9,0)`,
            [m.id, money(pkg.price), start, pick(METHODS, i),
             `Personal training — ${pkg.plan_type || pkg.name}`, sub[0].id,
             pkg.plan_type || pkg.name, start, expiry]);
        // A handful of logged sessions so Session history is not an empty tab
        // behind a paid plan.
        for (let k = 0; k < 5; k++) {
            await q(`INSERT INTO pt_sessions (subscription_id, trainer_id, session_date, session_time, notes)
                     VALUES ($1,$2,$3,$4,$5)`,
                [sub[0].id, trainer.id, day(-(k * 6) - 2),
                 `${String(7 + (k % 3)).padStart(2, '0')}:30:00`,
                 pick(['Upper body — technique work', 'Conditioning and core',
                       'Lower body, worked on squat depth', 'Deload week',
                       'Assessment and plan review'], i + k)]);
            bump('pt sessions');
        }
        bump('pt subscriptions');
        bump('payments');
    }
    return rows.length;
}

async function fillLockers(limit) {
    const { rows: free } = await q(
        `SELECT id, locker_number, monthly_rent FROM lockers
         WHERE member_id IS NULL AND status <> 'maintenance' ORDER BY id LIMIT $1`, [limit]);
    if (!free.length) return 0;
    const { rows } = await q(`
        SELECT c.id, c.name FROM clients c
        WHERE c.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM lockers l WHERE l.member_id = c.id)
        ORDER BY c.id DESC LIMIT $1`, [free.length]);

    for (const [i, m] of rows.entries()) {
        const locker = free[i];
        const from = day(-(i % 20) - 3);
        const until = day(180 - (i % 20) - 3);
        const rent = money(Number(locker.monthly_rent) || 300);
        const charged = money(rent * 6);
        await q(`UPDATE lockers SET member_id = $1, status = 'occupied',
                                    assigned_from = $2, assigned_until = $3
                 WHERE id = $4`, [m.id, from, until, locker.id]);
        await q(`INSERT INTO payments (member_id, amount, payment_date, method, note,
                                       purpose, reference_id, plan_name, period_start, period_end, discount)
                 VALUES ($1,$2,$3,$4,$5,'locker',$6,$7,$8,$9,0)`,
            [m.id, charged, from, pick(METHODS, i),
             `Locker ${locker.locker_number} — 6 months`, locker.id,
             `Locker ${locker.locker_number}`, from, until]);
        bump('lockers assigned');
        bump('payments');
    }
    return rows.length;
}

async function fillReferrals(limit) {
    const { rows } = await q(`
        SELECT c.id, c.name FROM clients c
        WHERE c.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM referrals r WHERE r.referrer_id = c.id)
        ORDER BY c.id LIMIT $1`, [limit]);
    // Every stage of the funnel, so the Refer & earn tab shows the whole story
    // rather than a single row saying "pending".
    const STAGES = [
        ['pending', 0, null], ['joined', 0, null],
        ['rewarded', 500, day(-12)], ['lost', 0, null],
    ];
    for (const [i, m] of rows.entries()) {
        for (let k = 0; k < 2; k++) {
            const [status, reward, paidOn] = STAGES[(i + k) % STAGES.length];
            await q(`INSERT INTO referrals (referrer_id, referred_name, referred_phone,
                                            status, reward_type, reward_value, reward_paid_on, created_at)
                     VALUES ($1,$2,$3,$4,'discount',$5,$6, NOW() - ($7 || ' days')::interval)`,
                [m.id, `${pick(FIRST, i + k + 3)} ${pick(LAST, i + k)}`,
                 `97${String(30000000 + i * 911 + k).slice(0, 8)}`,
                 status, money(reward), paidOn, String(10 + (i % 40))]);
            bump('referrals');
        }
    }
    return rows.length;
}

// ── run ─────────────────────────────────────────────────────────────────────

(async () => {
    try {
        console.log('Additive seed — inserts only, nothing existing is removed.\n');

        const fresh = await addMembers(15);
        console.log(`  new members          ${fresh.length}  (${fresh[0]?.member_code}–${fresh[fresh.length - 1]?.member_code})`);

        console.log(`  workouts backfilled  ${await fillWorkouts()} members`);
        console.log(`  diet backfilled      ${await fillDiet()} members`);
        console.log(`  progress backfilled  ${await fillProgress()} members`);
        console.log(`  attendance           ${await fillAttendance()} members`);
        console.log(`  class bookings       ${await fillBookings()} members`);
        console.log(`  personal training    ${await fillPersonalTraining(60)} members (longest-standing)`);
        console.log(`  personal training    ${await fillPersonalTraining(25, 'DESC')} members (newest)`);
        console.log(`  lockers              ${await fillLockers(25)} members`);
        console.log(`  referrals            ${await fillReferrals(2000)} members`);

        console.log('\nRows written:');
        for (const [k, v] of Object.entries(added).sort()) {
            console.log(`  ${k.padEnd(20)} ${v}`);
        }

        const { rows: cover } = await q(`
            SELECT
              (SELECT count(*) FROM clients WHERE status='active') AS active,
              (SELECT count(DISTINCT member_id) FROM workout_plans) AS workouts,
              (SELECT count(DISTINCT member_id) FROM diet_plans) AS diet,
              (SELECT count(DISTINCT member_id) FROM member_progress) AS progress,
              (SELECT count(DISTINCT member_id) FROM attendance) AS attendance,
              (SELECT count(DISTINCT member_id) FROM class_bookings) AS bookings,
              (SELECT count(DISTINCT member_id) FROM pt_subscriptions) AS pt,
              (SELECT count(*) FROM lockers WHERE member_id IS NOT NULL) AS lockers,
              (SELECT count(DISTINCT referrer_id) FROM referrals) AS referrals`);
        const c = cover[0];
        console.log('\nMembers with data in each portal tab:');
        console.log(`  active members       ${c.active}`);
        for (const k of ['workouts', 'diet', 'progress', 'attendance', 'bookings', 'pt', 'lockers', 'referrals']) {
            console.log(`  ${k.padEnd(20)} ${c[k]}`);
        }
        console.log('\nSign in at #/member with any Member ID, password "admin".');
    } catch (err) {
        console.error('Seed failed:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
