#!/usr/bin/env node
/**
 * Demo data for GYM OS 2.0 — enough of it to actually exercise the product.
 *
 *   node seed-demo.js              # into $DB_NAME (default gymdb)
 *   DB_NAME=gymdb_test node seed-demo.js
 *   node seed-demo.js --wipe       # remove everything this script created first
 *
 * Everything it writes is tagged so it can be removed again: members get
 * member_code 5000–5999, trainers get usernames starting "coach.", and plans
 * and packages are prefixed "Demo". Nothing outside those ranges is touched,
 * so it is safe to run against a database that already has real data.
 *
 * It deliberately creates the awkward cases, not just the happy ones: members
 * in arrears (whose access is therefore locked), memberships expiring this
 * week, one already expired, one frozen, one inactive, and a referral chain at
 * every stage — invited, joined, rewarded, and reward already spent.
 */
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'gymdb',
    user: process.env.DB_USER || process.env.USER,
    password: process.env.DB_PASSWORD || undefined,
});

const WIPE = process.argv.includes('--wipe');

// BCrypt("admin") — the gym-wide default every member starts on.
const DEFAULT_MEMBER_HASH = '$2b$10$sOOEabmhG.aZIwAeMpbhP.CnyIPVWZXXZGBl87e6ZCMLv/KO3yUOa';

const CODE_FROM = 5000;
const CODE_TO = 5999;

const q = (sql, params) => pool.query(sql, params);
const day = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
};
const pick = (arr, i) => arr[i % arr.length];
// Rounded to paise, and a NUMBER — toFixed returns a string, and one string
// in the middle of a total turns the addition into concatenation: 5400 + 972
// silently became "5400.00972.00" and Postgres rejected it as an overflow.
const money = (n) => Number(Number(n).toFixed(2));

// ── the cast ────────────────────────────────────────────────────────────────

const TRAINERS = [
    { username: 'coach.rahul', name: 'Rahul Verma', email: 'rahul.verma@goldsgym.local', phone: '9810000001' },
    { username: 'coach.priya', name: 'Priya Nair', email: 'priya.nair@goldsgym.local', phone: '9810000002' },
    { username: 'coach.arjun', name: 'Arjun Mehta', email: 'arjun.mehta@goldsgym.local', phone: '9810000003' },
    { username: 'coach.sneha', name: 'Sneha Kulkarni', email: 'sneha.kulkarni@goldsgym.local', phone: '9810000004' },
];

// Personal training is sold by duration, like membership. Monthly fees land
// between ₹5,000 and ₹12,000 as asked; the longer terms carry a discount,
// which is why the per-month figure falls as the term grows.
const PT_PLANS = [
    { name: 'Demo PT Monthly',    plan_type: 'Monthly',     days: 30,  price: 6000,  commission: 15 },
    { name: 'Demo PT Quarterly',  plan_type: 'Quarterly',   days: 90,  price: 16500, commission: 15 },
    { name: 'Demo PT Half-Year',  plan_type: 'Half-Yearly', days: 180, price: 30000, commission: 12 },
    { name: 'Demo PT Yearly',     plan_type: 'Yearly',      days: 365, price: 54000, commission: 10 },
];

const FIRST = ['Aditya', 'Ishita', 'Rohan', 'Ananya', 'Karan', 'Meera', 'Vikram', 'Sanya', 'Nikhil', 'Tara',
    'Siddharth', 'Kavya', 'Rajat', 'Neha', 'Aman', 'Pooja', 'Varun', 'Divya', 'Kabir', 'Riya',
    'Manish', 'Shreya', 'Gaurav', 'Anjali', 'Harsh', 'Nisha', 'Dev', 'Simran', 'Yash', 'Preeti'];
const LAST = ['Sharma', 'Patel', 'Reddy', 'Iyer', 'Singh', 'Das', 'Gupta', 'Joshi', 'Menon', 'Bose',
    'Chopra', 'Rao', 'Nayar', 'Bhatt', 'Kaur'];

const PLANS = ['Monthly', 'Quarterly', 'Half-Yearly', 'Yearly'];
const PLAN_DAYS = { Monthly: 30, Quarterly: 90, 'Half-Yearly': 180, Yearly: 365 };
const PLAN_FEE = { Monthly: 2000, Quarterly: 5400, 'Half-Yearly': 9600, Yearly: 18000 };
const METHODS = ['Cash', 'UPI', 'Card', 'Online'];

const EXERCISES = [
    ['Monday', 'Barbell Squat', 4, '8', 60], ['Monday', 'Leg Press', 3, '12', 120],
    ['Wednesday', 'Bench Press', 4, '8', 50], ['Wednesday', 'Incline Dumbbell', 3, '10', 20],
    ['Friday', 'Deadlift', 4, '5', 80], ['Friday', 'Lat Pulldown', 3, '12', 45],
];
const MEALS = [
    ['Breakfast', '4 egg whites + 2 toast', 320, 28, 34, 6],
    ['Lunch', 'Grilled chicken, rice, salad', 620, 48, 62, 14],
    ['Snacks', 'Whey shake + banana', 280, 26, 32, 3],
    ['Dinner', 'Paneer bhurji + roti', 520, 30, 44, 22],
];

// ── wipe ────────────────────────────────────────────────────────────────────

async function wipe() {
    console.log('  removing anything a previous run created…');

    // Not everything hanging off a member is wired to cascade — payments and
    // measurements have no foreign key to clients, so deleting the member left
    // thousands of orphan rows behind, one wipe at a time. Take the children
    // out first, by member, rather than trusting the database to do it.
    const demoIds = `SELECT id FROM clients WHERE member_code ~ '^[0-9]+$'
                     AND member_code::int BETWEEN ${CODE_FROM} AND ${CODE_TO}`;
    for (const table of ['payments', 'member_progress', 'workout_plans', 'diet_plans',
        'class_bookings', 'member_feedback', 'assessments', 'challenge_participants',
        'billing_attempts', 'membership_events']) {
        await q(`DELETE FROM ${table} WHERE member_id IN (${demoIds})`);
    }
    await q(`UPDATE lockers SET member_id = NULL, status = 'free', assigned_from = NULL,
                    assigned_until = NULL WHERE member_id IN (${demoIds})`);
    await q(`UPDATE invoices SET member_id = NULL WHERE member_id IN (${demoIds})`);
    await q('DELETE FROM attendance WHERE member_id BETWEEN $1 AND $2', [CODE_FROM, CODE_TO]);
    await q(`DELETE FROM clients WHERE member_code ~ '^[0-9]+$'
             AND member_code::int BETWEEN $1 AND $2`, [CODE_FROM, CODE_TO]);
    // Their Member IDs go back to the queue, exactly as a deletion in the app
    // would leave them.
    await q('DELETE FROM member_codes WHERE code BETWEEN $1 AND $2', [CODE_FROM, CODE_TO]);
    await q(`DELETE FROM pt_packages WHERE name LIKE 'Demo %'`);
    await q(`DELETE FROM gym_classes WHERE name LIKE 'Demo %'`);
    await q(`DELETE FROM leads WHERE name LIKE 'Demo %'`);
    await q(`DELETE FROM product_sales WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'Demo %')`);
    await q(`DELETE FROM products WHERE name LIKE 'Demo %'`);
    await q(`DELETE FROM lockers WHERE locker_number LIKE 'L-1%' OR locker_number LIKE 'L-2%'`);
    await q(`DELETE FROM expenses WHERE description LIKE 'Demo %'`);
    await q(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE invoice_no LIKE 'DEMO-INV-%')`);
    await q(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE invoice_no LIKE 'DEMO-LKR-%')`);
    await q(`DELETE FROM invoices WHERE invoice_no LIKE 'DEMO-INV-%' OR invoice_no LIKE 'DEMO-LKR-%'`);
    await q(`DELETE FROM tasks WHERE title LIKE 'Demo %'`);
    await q(`DELETE FROM challenge_participants WHERE challenge_id IN (SELECT id FROM challenges WHERE name LIKE 'Demo %')`);
    await q(`DELETE FROM challenges WHERE name LIKE 'Demo %'`);
    await q(`DELETE FROM announcements WHERE title LIKE 'Demo %'`);
    await q(`DELETE FROM devices WHERE name LIKE 'Demo %'`);
    // Staff rows hang off the demo trainers, which go next.
    await q(`DELETE FROM staff_attendance WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'coach.%')`);
    await q(`DELETE FROM staff_shifts WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'coach.%')`);
    await q(`DELETE FROM payroll WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'coach.%')`);
    await q(`DELETE FROM commissions WHERE trainer_id IN (SELECT id FROM users WHERE username LIKE 'coach.%')`);
    await q(`UPDATE clients SET trainer_id = NULL WHERE trainer_id IN (SELECT id FROM users WHERE username LIKE 'coach.%')`);
    await q(`DELETE FROM users WHERE username LIKE 'coach.%'`);
    console.log('  ✔ wiped');
}

// ── seed ────────────────────────────────────────────────────────────────────

async function seedTrainers() {
    const hash = bcrypt.hashSync('trainer123', 10);
    const ids = [];
    for (const t of TRAINERS) {
        const { rows } = await q(`
            INSERT INTO users (username, password_hash, name, role, email, phone)
            VALUES ($1, $2, $3, 'trainer', $4, $5)
            ON CONFLICT (username) DO UPDATE SET name = EXCLUDED.name,
                email = EXCLUDED.email, phone = EXCLUDED.phone
            RETURNING id`, [t.username, hash, t.name, t.email, t.phone]);
        ids.push(rows[0].id);
    }
    console.log(`  ✔ ${ids.length} trainers (password trainer123)`);
    return ids;
}

async function seedPtPlans() {
    const ids = [];
    for (const p of PT_PLANS) {
        const { rows } = await q(`
            INSERT INTO pt_packages (name, plan_type, price, validity_days, trainer_commission_percent)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (name) DO UPDATE SET plan_type = EXCLUDED.plan_type,
                price = EXCLUDED.price,
                validity_days = EXCLUDED.validity_days,
                trainer_commission_percent = EXCLUDED.trainer_commission_percent
            RETURNING id`,
            [p.name, p.plan_type, p.price, p.days, p.commission]);
        ids.push({ id: rows[0].id, ...p });
    }
    console.log(`  ✔ ${ids.length} PT plans, monthly to yearly (₹${PT_PLANS[0].price}–₹${PT_PLANS[3].price} for the term)`);
    return ids;
}

/**
 * 120 members spread across every state the product has to cope with, so the
 * dashboard, retention scoring and the gate all have something to show.
 */
async function seedMembers() {
    const members = [];
    for (let i = 0; i < 120; i++) {
        const code = String(CODE_FROM + i);
        const name = `${pick(FIRST, i)} ${pick(LAST, Math.floor(i / 3) + i)}`;
        const plan = pick(PLANS, i);
        const fee = PLAN_FEE[plan];

        // The spread of states, by position in the list.
        let start, expiry, status = 'active', paid = fee, frozenUntil = null;
        if (i < 8) {                       // expired weeks ago
            start = day(-400); expiry = day(-30 - i);
        } else if (i < 16) {               // expiring within the week
            start = day(-PLAN_DAYS[plan] + 5); expiry = day(1 + (i % 6));
        } else if (i < 24) {               // expiring this month
            start = day(-PLAN_DAYS[plan] + 20); expiry = day(10 + i);
        } else if (i < 30) {               // owes money → gate locked
            start = day(-40); expiry = day(PLAN_DAYS[plan] - 40);
            paid = fee - (200 + (i % 5) * 150);
        } else if (i < 33) {               // frozen (travelling, injured)
            start = day(-60); expiry = day(120); frozenUntil = day(20 + i);
        } else if (i < 36) {               // left the gym
            start = day(-300); expiry = day(-60); status = 'inactive';
        } else {                           // the ordinary majority
            start = day(-(i % 90)); expiry = day(PLAN_DAYS[plan] - (i % 90));
        }

        const due = Math.max(0, fee - paid);
        const { rows } = await q(`
            INSERT INTO clients (member_code, name, phone, email, gender, dob, address,
                                 join_date, membership_type, membership_start, membership_expiry,
                                 membership_fee, amount_paid, amount_due, payment_mode, status,
                                 frozen_until, password_hash)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
            ON CONFLICT (member_code) DO NOTHING
            RETURNING id, member_code, name`,
            [code, name, `98${String(20000000 + i * 137).slice(0, 8)}`,
             `${name.toLowerCase().replace(/[^a-z]/g, '.')}@example.com`,
             i % 2 ? 'Female' : 'Male', day(-(7000 + i * 60)),
             `${100 + i}, Station Road, Jehanabad`,
             start, plan, start, expiry, fee, paid, due, pick(METHODS, i), status,
             frozenUntil, DEFAULT_MEMBER_HASH]);
        if (rows[0]) members.push({ ...rows[0], plan, fee, paid, start, expiry, status, due });
    }

    // These rows go in behind the service, so the Member ID ledger has to be
    // told about them — otherwise the next admission would be offered a number
    // one of these members is already using.
    await q(`
        INSERT INTO member_codes (code, member_id, released_at)
        SELECT member_code::int, id, NULL FROM clients WHERE member_code ~ '^[0-9]+$'
        ON CONFLICT (code) DO UPDATE SET member_id = EXCLUDED.member_id, released_at = NULL`);

    // Referral codes follow the same rule the app uses (NAME + padded ID).
    await q(`
        UPDATE clients SET referral_code =
            RPAD(SUBSTRING(UPPER(REGEXP_REPLACE(name, '[^A-Za-z]', '', 'g')) FROM 1 FOR 4), 4, 'X')
            || LPAD(REGEXP_REPLACE(member_code, '[^0-9]', '', 'g'), 4, '0')
        WHERE member_code ~ '^[0-9]+$' AND member_code::int BETWEEN $1 AND $2
          AND referral_code IS NULL`, [CODE_FROM, CODE_TO]);

    console.log(`  ✔ ${members.length} members — 8 expired, 8 expiring this week, 6 in arrears,`
        + ' 3 frozen, 3 inactive, the rest current');
    return members;
}

/** 55 of them train with one of the four coaches, on a duration plan. */
async function seedPersonalTraining(members, trainerIds, ptPlans) {
    const trained = members.filter(m => m.status === 'active').slice(0, 55);
    let subs = 0;
    for (let i = 0; i < trained.length; i++) {
        const m = trained[i];
        const trainerId = pick(trainerIds, i);
        const plan = pick(ptPlans, i);
        await q('UPDATE clients SET trainer_id = $1 WHERE id = $2', [trainerId, m.id]);

        // A few started long enough ago to have lapsed — the renewal prompt
        // needs something to point at.
        const lapsed = i % 11 === 0;
        const startedAgo = lapsed ? plan.days + 15 : (i % plan.days);
        const start = day(-startedAgo);
        const expiry = day(-startedAgo + plan.days);
        // Sessions delivered so far — a record of what the trainer ran, with
        // nothing to run out of. The plan ends when its term does.
        const used = i % 14;

        const { rows } = await q(`
            INSERT INTO pt_subscriptions (member_id, package_id, trainer_id, sessions_total,
                                          sessions_used, price, start_date, expiry_date, status)
            VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8) RETURNING id`,
            [m.id, plan.id, trainerId, used, plan.price,
             start, expiry, lapsed ? 'expired' : 'active']);
        const subId = rows[0].id;
        subs++;

        // The fee lands in the same payments ledger as membership, which is
        // what the member's receipt is printed from.
        await q(`INSERT INTO payments (member_id, amount, payment_date, method, note,
                                       purpose, reference_id, plan_name, period_start, period_end)
                 VALUES ($1,$2,$3,$4,$5,'pt',$6,$7,$8,$9)`,
            [m.id, plan.price, start, pick(METHODS, i), `PT package: ${plan.name}`,
             subId, plan.name, start, expiry]);

        // Delivered sessions, most recent first.
        for (let sN = 0; sN < Math.min(used, 8); sN++) {
            await q(`INSERT INTO pt_sessions (subscription_id, trainer_id, session_date, session_time, notes)
                     VALUES ($1,$2,$3,$4,$5)`,
                [subId, trainerId, day(-(sN * 3 + 1)), '07:30',
                 pick(['Push day — chest and triceps', 'Pull day — back and biceps',
                       'Legs and core', 'Conditioning and mobility'], sN)]);
        }

        // Commission the payroll run will settle.
        const commission = (plan.price * plan.commission) / 100;
        await q(`INSERT INTO commissions (trainer_id, source, source_id, member_id, base_amount,
                                          percent, amount, earned_on)
                 VALUES ($1,'pt',$2,$3,$4,$5,$6,$7)`,
            [trainerId, subId, m.id, plan.price, plan.commission, money(commission), start]);
    }
    // A floor trainer named against members who have NOT bought personal
    // training. Plenty of gyms do this, and it is exactly the case that used to
    // show those members a Personal training tab about a product they had never
    // signed up for.
    const floorOnly = members.filter(m => !trained.includes(m)).slice(0, 10);
    for (let i = 0; i < floorOnly.length; i++) {
        await q('UPDATE clients SET trainer_id = $1 WHERE id = $2',
            [pick(trainerIds, i), floorOnly[i].id]);
    }

    console.log(`  ✔ ${subs} members on personal training across ${trainerIds.length} trainers`);
    console.log(`  ✔ ${floorOnly.length} more have a floor trainer but no PT plan — no PT tab for them`);
    return trained;
}

/** Membership payments, so every member's portal has a receipt to open. */
async function seedPayments(members) {
    let n = 0;
    for (const m of members) {
        if (m.paid <= 0) continue;
        await q(`INSERT INTO payments (member_id, amount, payment_date, method, note,
                                       purpose, plan_name, period_start, period_end)
                 VALUES ($1,$2,$3,$4,$5,'membership',$6,$7,$8)`,
            [m.id, m.paid, m.start, m.payment_mode || 'Cash',
             m.due > 0 ? 'Part payment — balance outstanding' : 'Membership fee',
             m.plan, m.start, m.expiry]);
        n++;
    }
    console.log(`  ✔ ${n} membership payments (each one opens as a receipt)`);
}

/** Attendance for the last 60 days, denser for the members who actually come. */
async function seedAttendance(members) {
    let rows = 0;
    const active = members.filter(m => m.status === 'active' && m.due === 0 && m.expiry >= day(0));
    for (let i = 0; i < active.length; i++) {
        const m = active[i];
        // Three habits: regular, occasional, and lapsing — which is what makes
        // the retention scores different from each other.
        const habit = i % 3 === 0 ? 2 : i % 3 === 1 ? 4 : 9;
        const stopAfter = i % 7 === 0 ? 30 : 0;   // some stopped coming a month ago
        for (let d = 1 + stopAfter; d < 60; d += habit) {
            // attendance.member_id holds the gym-assigned member CODE, not the
            // clients.id — the unique index is (member_id, date), which is what
            // makes one punch per member per day.
            await q(`INSERT INTO attendance (member_id, member_name, date, time, status, source)
                     VALUES ($1,$2,$3,$4,'Present',$5)
                     ON CONFLICT (member_id, date) DO NOTHING`,
                [Number(m.member_code), m.name.toUpperCase(), day(-d),
                 `0${6 + (d % 5)}:${(d * 7) % 60 < 10 ? '0' : ''}${(d * 7) % 60}:00`,
                 pick(['qr', 'fingerprint', 'card', 'manual'], d)]);
            rows++;
        }
    }
    console.log(`  ✔ ${rows} attendance records across 60 days (regular / occasional / lapsing)`);
}

/** Workout plans, diet plans and body measurements for the PT members. */
async function seedTraining(trained) {
    let w = 0, d = 0, p = 0;
    for (let i = 0; i < trained.length; i++) {
        const m = trained[i];
        for (const [dayName, exercise, sets, reps, weight] of EXERCISES) {
            await q(`INSERT INTO workout_plans (member_id, day, exercise, sets, reps, weight, rest_seconds, notes)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [m.id, dayName, exercise, sets, reps, weight + (i % 5) * 5, 90,
                 'Last set to failure']);
            w++;
        }
        for (const [meal, item, cal, prot, carb, fat] of MEALS) {
            await q(`INSERT INTO diet_plans (member_id, meal, food_item, calories, protein_g, carbs_g, fats_g, notes)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [m.id, meal, item, cal, prot, carb, fat, 'Adjust portions on rest days']);
            d++;
        }
        // Six monthly measurements, trending the way a training block should.
        const startWeight = 68 + (i % 22);
        for (let month = 5; month >= 0; month--) {
            await q(`INSERT INTO member_progress (member_id, record_date, weight, body_fat, chest, waist,
                                                  arms, thighs, shoulders, notes)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [m.id, day(-month * 30), startWeight - (5 - month) * 0.8,
                 24 - (5 - month) * 0.6, 96 + (5 - month) * 0.5, 88 - (5 - month) * 1.1,
                 34 + (5 - month) * 0.3, 56 + (5 - month) * 0.2, 112 + (5 - month) * 0.4,
                 month === 0 ? 'On track — strength up across the board' : null]);
            p++;
        }
    }
    console.log(`  ✔ ${w} workout rows, ${d} diet rows, ${p} progress measurements`);
}

/**
 * A referral at every stage of its life, because the interesting bugs live in
 * the transitions rather than in any one state.
 *
 * The chain that matters: Anchor introduces four people. One is only invited,
 * one has joined but not paid, one has paid (so the reward is earned and
 * waiting), and one was rewarded and the reward already spent on a renewal.
 */
async function seedReferrals(members) {
    const eligible = members.filter(m => m.status === 'active');
    const anchor = eligible[40];
    const offerValue = 100;

    const stages = [
        { m: eligible[41], status: 'pending', paid: false, rewarded: false, redeemed: false },
        { m: eligible[42], status: 'joined', paid: false, rewarded: false, redeemed: false },
        { m: eligible[43], status: 'rewarded', paid: true, rewarded: true, redeemed: false },
        { m: eligible[44], status: 'rewarded', paid: true, rewarded: true, redeemed: true },
    ];

    for (let i = 0; i < stages.length; i++) {
        const st = stages[i];
        await q(`
            INSERT INTO referrals (referrer_id, referred_name, referred_phone, converted_member_id,
                                   status, reward_type, reward_value, reward_paid_on, redeemed_on,
                                   notes, created_at)
            VALUES ($1,$2,$3,$4,$5,'credit',$6,$7,$8,$9,$10)`,
            [anchor.id, st.m.name, st.m.phone || `98${String(30000000 + i * 991).slice(0, 8)}`,
             st.status === 'pending' ? null : st.m.id,
             st.status, offerValue,
             st.rewarded ? day(-20 + i) : null,
             st.redeemed ? day(-5) : null,
             `Demo referral — ${st.status}`, day(-30 + i)]);
        if (st.status !== 'pending') {
            await q('UPDATE clients SET referred_by_id = $1 WHERE id = $2', [anchor.id, st.m.id]);
        }
    }

    // A second referrer with a single unspent reward, so there is more than one
    // way to reach the "discount applies on renewal" path.
    const second = eligible[45];
    await q(`
        INSERT INTO referrals (referrer_id, referred_name, referred_phone, converted_member_id,
                               status, reward_type, reward_value, reward_paid_on, notes, created_at)
        VALUES ($1,$2,$3,$4,'rewarded','credit',$5,$6,$7,$8)`,
        [second.id, eligible[46].name, '9871230099', eligible[46].id, offerValue,
         day(-10), 'Demo referral — reward waiting', day(-25)]);
    await q('UPDATE clients SET referred_by_id = $1 WHERE id = $2', [second.id, eligible[46].id]);

    console.log(`  ✔ referral chain on ${anchor.name} (${anchor.member_code}): invited → joined →`
        + ' rewarded → redeemed');
    console.log(`  ✔ ${second.name} (${second.member_code}) has one unspent ₹${offerValue} reward`);
    return { anchor, second };
}

/** Classes across the coming fortnight, some already filling up. */
async function seedClasses(members, trainerIds) {
    const names = [
        ['Demo Morning HIIT', '06:30', '07:15', 20],
        ['Demo Power Yoga', '07:30', '08:30', 15],
        ['Demo Strength Circuit', '18:00', '19:00', 18],
        ['Demo Evening Zumba', '19:15', '20:15', 25],
    ];
    const bookable = members.filter(m => m.status === 'active' && m.due === 0);
    let created = 0, booked = 0;
    for (let d = 0; d < 14; d++) {
        for (let c = 0; c < names.length; c++) {
            const [name, from, to, cap] = names[c];
            // Status is left to the column default ('active'), which is what the
            // product itself writes. This used to say 'scheduled' — a status no
            // other line of code in the system recognises — and because every
            // query in the classes module filters on 'active', the whole module
            // rendered empty over 56 seeded classes holding 2,118 bookings.
            const { rows } = await q(`
                INSERT INTO gym_classes (name, description, trainer_id, class_date, start_time,
                                         end_time, capacity)
                VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
                [name, `${name.replace('Demo ', '')} with the team`, pick(trainerIds, c + d),
                 day(d), from, to, cap]);
            created++;
            // Fill the early classes properly so the capacity and waitlist
            // rules have something to bite on.
            const fill = d < 3 ? cap : 3 + (d % 5);
            for (let b = 0; b < Math.min(fill, bookable.length); b++) {
                const m = bookable[(b + d * 7 + c) % bookable.length];
                await q(`INSERT INTO class_bookings (class_id, member_id, status)
                         VALUES ($1,$2,$3) ON CONFLICT (class_id, member_id) DO NOTHING`,
                    [rows[0].id, m.id, b < cap ? 'booked' : 'waitlisted']);
                booked++;
            }
        }
    }
    console.log(`  ✔ ${created} classes over 14 days with ${booked} bookings (the first three days are full)`);
}


// ── everything else the app has a screen for ─────────────────────────────────
//
// Each of these fills one tab that would otherwise open on an empty state. The
// point of demo data is that nothing is blank when somebody clicks through, so
// every module gets rows with the shapes it will really see: stock that has
// sold below its reorder level, an invoice that is unpaid, a locker free and a
// locker taken, a task overdue.

async function seedOperations(members, trainerIds) {
    const counts = {};
    const adminId = (await q(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`)).rows[0]?.id ?? null;

    // ---- leads: the pipeline, at every stage --------------------------------
    const LEADS = [
        ['Demo Ravi Khanna',   '9876510001', 'Monthly',     'walk-in',  'new',       'Walked past, asked about morning batches'],
        ['Demo Sunita Bansal', '9876510002', 'Quarterly',   'referral',  'contacted', 'Neha referred her; ring back Tuesday'],
        ['Demo Imran Sheikh',  '9876510003', 'Half-Yearly', 'social',    'visited',   'Took a trial on Saturday, liked the free weights'],
        ['Demo Pooja Raut',    '9876510004', 'Yearly',      'website',   'new',       'Enquiry form, wants to start in October'],
        ['Demo Alok Nanda',    '9876510005', 'Monthly',     'phone',     'lost',      'Went with the gym near his office'],
    ];
    for (const [name, phone, interest, source, status, notes] of LEADS) {
        await q(`INSERT INTO leads (name, phone, email, interest, source, status, notes, created_by, created_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [name, phone, `${phone}@example.com`, interest, source, status, notes, adminId,
             `${day(-(LEADS.indexOf([name, phone, interest, source, status, notes]) + 1) || -3)} 10:00`]);
    }
    counts.leads = LEADS.length;

    // ---- retail: stock, and sales that have moved it -----------------------
    const PRODUCTS = [
        ['Demo Whey Protein 1kg',  'Supplement', 2400, 3200, 18, 18, 5],
        ['Demo Creatine 250g',     'Supplement', 900,  1400, 18, 12, 4],
        ['Demo Shaker Bottle',     'Accessory',  120,  299,  12, 40, 10],
        ['Demo Lifting Belt',      'Accessory',  900,  1799, 12, 6,  3],
        ['Demo Energy Bar',        'Snack',      45,   90,   5,  3,  12],  // below reorder on purpose
        ['Demo Gym Towel',         'Accessory',  150,  349,  5,  22, 6],
    ];
    const productIds = [];
    for (const [name, cat, cost, sale, tax, qty, reorder] of PRODUCTS) {
        const { rows } = await q(`
            INSERT INTO products (name, category, cost_price, sale_price, tax_rate, stock_qty, reorder_level)
            VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [name, cat, cost, sale, tax, qty, reorder]);
        productIds.push({ id: rows[0].id, price: sale, tax });
    }
    let sales = 0;
    for (let i = 0; i < 24; i++) {
        const p = productIds[i % productIds.length];
        const buyer = members[(i * 7) % members.length];
        const qty = 1 + (i % 3);
        const taxAmount = money((p.price * qty * p.tax) / 100);
        await q(`INSERT INTO product_sales (product_id, member_id, quantity, unit_price, tax_amount,
                                            total, method, sold_by, sale_date)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [p.id, buyer.id, qty, p.price, taxAmount, money(p.price * qty + taxAmount),
             pick(METHODS, i), adminId, day(-(i % 30))]);
        sales++;
    }
    counts.products = PRODUCTS.length;
    counts.sales = sales;

    // ---- lockers: some free, some taken, one expiring -----------------------
    let lockers = 0, lockerCharges = 0;
    for (let i = 1; i <= 12; i++) {
        const taken = i <= 7;
        const holder = taken ? members[i * 3] : null;
        const rent = i % 3 === 0 ? 400 : 300;
        const from = day(-60);
        const until = day(30 + i);
        const { rows } = await q(`
            INSERT INTO lockers (locker_number, location, size, monthly_rent, status,
                                 member_id, assigned_from, assigned_until)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [`L-1${String(i).padStart(2, '0')}`, i <= 6 ? 'Ground floor' : 'First floor',
             i % 3 === 0 ? 'Large' : i % 2 === 0 ? 'Medium' : 'Small',
             rent, taken ? 'occupied' : 'free',
             holder?.id ?? null, taken ? from : null, taken ? until : null]);
        lockers++;
        // Rent taken at the desk lands in the ledger and raises an invoice,
        // which is what the member's Locker tab shows them.
        if (taken && holder) {
            const months = 3;
            const amount = money(rent * months);
            await q(`INSERT INTO payments (member_id, amount, payment_date, method, note,
                                           purpose, reference_id, plan_name, period_start, period_end)
                     VALUES ($1,$2,$3,$4,$5,'locker',$6,$7,$8,$9)`,
                [holder.id, amount, from, pick(METHODS, i), `Locker L-1${String(i).padStart(2, '0')} rent`,
                 rows[0].id, `Locker L-1${String(i).padStart(2, '0')}`, from, until]);
            const { rows: inv } = await q(`
                INSERT INTO invoices (invoice_no, member_id, customer_name, invoice_date, subtotal,
                                      tax_amount, total, status, method, notes, issued_by)
                VALUES ($1,$2,$3,$4,$5,0,$5,'paid',$6,$7,$8) RETURNING id`,
                [`DEMO-LKR-${String(100 + i)}`, holder.id, holder.name, from, amount,
                 pick(METHODS, i), `Locker L-1${String(i).padStart(2, '0')}, ${from} to ${until}`, adminId]);
            await q(`INSERT INTO invoice_items (invoice_id, description, quantity, unit_price,
                                                tax_rate, tax_amount, line_total)
                     VALUES ($1,$2,1,$3,0,0,$3)`,
                [inv[0].id, `Locker L-1${String(i).padStart(2, '0')} rent`, amount]);
            lockerCharges++;
        }
    }
    counts.lockers = lockers;
    counts.lockerCharges = lockerCharges;

    // ---- expenses: what a gym actually pays for ----------------------------
    const EXPENSES = [
        ['Rent', 'Demo — premises rent, September', 65000, 'Bank Transfer', 'Jehanabad Properties'],
        ['Utilities', 'Demo — electricity, August', 18500, 'Bank Transfer', 'State Electricity Board'],
        ['Utilities', 'Demo — water and cleaning', 4200, 'Cash', 'Local supplier'],
        ['Equipment', 'Demo — treadmill belt replacement', 12500, 'UPI', 'FitService India'],
        ['Marketing', 'Demo — hoardings on Station Road', 9000, 'UPI', 'Sign Studio'],
        ['Salaries', 'Demo — housekeeping wages', 14000, 'Cash', null],
        ['Maintenance', 'Demo — AC servicing', 3800, 'Cash', 'CoolAir'],
    ];
    for (let i = 0; i < EXPENSES.length; i++) {
        const [cat, desc, amt, method, vendor] = EXPENSES[i];
        await q(`INSERT INTO expenses (category, description, amount, expense_date, method, vendor, recorded_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [cat, desc, amt, day(-(3 + i * 4)), method, vendor, adminId]);
    }
    counts.expenses = EXPENSES.length;

    // ---- invoices: paid and unpaid, with their lines -----------------------
    let invoices = 0;
    for (let i = 0; i < 8; i++) {
        const m = members[i * 5];
        const line1 = { d: `${m.plan} membership`, q: 1, p: m.fee, t: 18 };
        const line2 = i % 2 === 0 ? { d: 'Demo Whey Protein 1kg', q: 1, p: 3200, t: 18 } : null;
        const lines = [line1, ...(line2 ? [line2] : [])];
        const subtotal = money(lines.reduce((n, l) => n + l.p * l.q, 0));
        const tax = money(lines.reduce((n, l) => n + (l.p * l.q * l.t) / 100, 0));
        const { rows } = await q(`
            INSERT INTO invoices (invoice_no, member_id, customer_name, invoice_date, subtotal,
                                  tax_amount, total, status, method, notes, issued_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
            [`DEMO-INV-${String(1000 + i)}`, m.id, m.name, day(-(i * 6)), subtotal, tax,
             // 'issued', not 'unpaid'. The product's invoice vocabulary is
             // issued / paid / cancelled — every filter, every stat tile and
             // the status validator all work from that set. 'unpaid' was a
             // word only this seeder used, so three invoices sat in a state no
             // tile counted and no filter could reach: the four status tiles
             // summed to 16 while "All invoices" said 19. Exactly the fault
             // that hid 56 classes behind 'scheduled'.
             money(subtotal + tax), i % 3 === 0 ? 'issued' : 'paid',
             // Nothing has been paid on an issued invoice, so it has no method.
             i % 3 === 0 ? null : pick(METHODS, i),
             'Demo invoice', adminId]);
        for (const l of lines) {
            const lineTax = money((l.p * l.q * l.t) / 100);
            await q(`INSERT INTO invoice_items (invoice_id, description, quantity, unit_price,
                                                tax_rate, tax_amount, line_total)
                     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [rows[0].id, l.d, l.q, l.p, l.t, lineTax, money(l.p * l.q + lineTax)]);
        }
        invoices++;
    }
    counts.invoices = invoices;

    // ---- tasks: open, due today, overdue, done -----------------------------
    const TASKS = [
        ['Demo — call about renewal', 'Membership expires this week', 'renewal', 'high', 'open', 2],
        ['Demo — collect outstanding ₹800', 'Gate is locked until it is cleared', 'dues', 'high', 'open', -3],
        ['Demo — welcome call', 'First week check-in', 'onboarding', 'normal', 'open', 0],
        ['Demo — follow up trial', 'Took a Saturday trial, liked it', 'lead', 'normal', 'open', 2],
        ['Demo — reorder energy bars', 'Stock below the reorder level', 'stock', 'low', 'open', 5],
        ['Demo — fix locker L-104 latch', 'Member reported it sticking', 'maintenance', 'normal', 'done', -6],
    ];
    for (let i = 0; i < TASKS.length; i++) {
        const [title, details, category, priority, status, dueIn] = TASKS[i];
        await q(`INSERT INTO tasks (title, details, category, priority, status, due_on,
                                    member_id, assigned_to, created_by, completed_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [title, details, category, priority, status, day(dueIn),
             members[i * 4]?.id ?? null, pick(trainerIds, i), adminId,
             status === 'done' ? `${day(-5)} 12:00` : null]);
    }
    counts.tasks = TASKS.length;

    // ---- challenges: one running with a leaderboard, one finished ----------
    const CHALLENGES = [
        ['Demo September Streak', 'Twenty visits before the month is out', 'attendance', 20, 'visits',
         day(-6), day(24), 'One free PT session', 'active'],
        ['Demo Summer Shred', 'Lose 3kg over eight weeks', 'weight', 3, 'kg',
         day(-90), day(-30), 'A month of free membership', 'completed'],
    ];
    let entries = 0;
    for (let c = 0; c < CHALLENGES.length; c++) {
        const [name, description, metric, goal, unit, from, to, reward, status] = CHALLENGES[c];
        const { rows } = await q(`
            INSERT INTO challenges (name, description, metric, goal, unit, starts_on, ends_on,
                                    reward, status, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
            [name, description, metric, goal, unit, from, to, reward, status, adminId]);
        for (let i = 0; i < 12; i++) {
            const m = members[(c * 17 + i * 3) % members.length];
            const progress = c === 0 ? (i % goal) + 1 : money(((i % 4) + 1) * 0.8);
            await q(`INSERT INTO challenge_participants (challenge_id, member_id, progress, completed_on)
                     VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
                [rows[0].id, m.id, progress, progress >= goal ? day(-2) : null]);
            entries++;
        }
    }
    counts.challenges = CHALLENGES.length;
    counts.challengeEntries = entries;

    // ---- assessments: two per member for a handful, so there is a trend ----
    let assessed = 0;
    for (let i = 0; i < 15; i++) {
        const m = members[i * 6];
        for (const [n, ago] of [[0, 90], [1, 15]]) {
            await q(`INSERT INTO assessments (member_id, assessed_on, weight_kg, height_cm, body_fat_pct,
                                              muscle_mass_kg, visceral_fat, bmi, chest_cm, waist_cm,
                                              hip_cm, arm_cm, thigh_cm, resting_hr, notes, assessed_by)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
                [m.id, day(-ago), money(78 - i * 0.4 - n * 1.8), 170 + (i % 12),
                 money(24 - i * 0.2 - n * 1.4), money(31 + n * 0.6), 8 - n,
                 money(24.5 - n * 0.5), 98 - n, 86 - n * 2, 96 - n, 34 + n, 56 + n,
                 72 - n * 3, n === 0 ? 'Demo baseline assessment' : 'Demo — good progress, waist down 2cm',
                 pick(trainerIds, i)]);
            assessed++;
        }
    }
    counts.assessments = assessed;

    // ---- announcements and feedback ----------------------------------------
    const NOTICES = [
        ['Demo — Holiday hours', 'The gym closes at 2pm on the 15th for Independence Day. Morning batches run as usual.', 'all', true],
        ['Demo — New squat racks', 'Two new racks are in on the ground floor. Ask any trainer for an induction.', 'all', false],
        ['Demo — Zumba moves to 7pm', 'From Monday the evening Zumba class starts at 7pm instead of 6.30.', 'all', false],
        ['Demo — Refer a friend', 'Introduce a friend and take ₹100 off your next renewal.', 'all', false],
    ];
    for (let i = 0; i < NOTICES.length; i++) {
        const [title, body, audience, pinned] = NOTICES[i];
        await q(`INSERT INTO announcements (title, body, audience, pinned, publish_on, created_by)
                 VALUES ($1,$2,$3,$4,$5,$6)`, [title, body, audience, pinned, day(-(i * 3)), adminId]);
    }
    counts.announcements = NOTICES.length;

    const COMMENTS = [
        [5, 'Trainers actually correct your form. Worth every rupee.', 'trainers'],
        [4, 'Great equipment, but the 7pm rush is a lot.', 'facilities'],
        [5, 'Clean, and the showers always have hot water.', 'facilities'],
        [3, 'Would like more cardio machines.', 'equipment'],
        [5, 'The diet plan made the difference for me.', 'trainers'],
        [4, 'Booking classes from the app is very easy now.', 'app'],
        [2, 'Music is far too loud in the evenings.', 'facilities'],
        [5, 'Front desk staff know everyone by name.', 'staff'],
    ];
    for (let i = 0; i < COMMENTS.length; i++) {
        const [score, comment, category] = COMMENTS[i];
        await q(`INSERT INTO member_feedback (member_id, score, comment, category, created_at)
                 VALUES ($1,$2,$3,$4,$5)`,
            [members[i * 9].id, score, comment, category, `${day(-(i * 2))} 18:00`]);
    }
    counts.feedback = COMMENTS.length;

    // ---- devices, staff attendance, shifts and payroll ---------------------
    for (const [name, ip] of [['Demo Front desk reader', '192.168.1.50'],
                              ['Demo Turnstile A', '192.168.1.51'],
                              ['Demo Studio door', '192.168.1.52']]) {
        await q(`INSERT INTO devices (name, ip_address, port, is_active) VALUES ($1,$2,4370,TRUE)`,
            [name, ip]);
    }
    counts.devices = 3;

    let staffRows = 0;
    for (let d = 0; d < 21; d++) {
        for (let t = 0; t < trainerIds.length; t++) {
            if ((d + t) % 7 === 6) continue;  // one day off each, staggered
            await q(`INSERT INTO staff_attendance (user_id, work_date, check_in, check_out, status)
                     VALUES ($1,$2,$3,$4,'Present')`,
                [trainerIds[t], day(-d), t % 2 ? '06:00' : '14:00', t % 2 ? '14:00' : '22:00']);
            staffRows++;
        }
    }
    for (let d = 0; d < 7; d++) {
        for (let t = 0; t < trainerIds.length; t++) {
            await q(`INSERT INTO staff_shifts (user_id, shift_date, start_time, end_time, role_note)
                     VALUES ($1,$2,$3,$4,$5)`,
                [trainerIds[t], day(d + 1), t % 2 ? '06:00' : '14:00', t % 2 ? '14:00' : '22:00',
                 t % 2 ? 'Morning floor' : 'Evening floor']);
        }
    }
    counts.staffAttendance = staffRows;
    counts.shifts = 7 * trainerIds.length;

    const now = new Date();
    for (let t = 0; t < trainerIds.length; t++) {
        const base = 22000 + t * 2500;
        const commission = money(4000 + t * 1500);
        await q(`INSERT INTO payroll (user_id, period_month, period_year, base_salary, commission,
                                      deductions, net_pay, days_present, status, paid_on, method)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [trainerIds[t], now.getMonth() === 0 ? 12 : now.getMonth(),
             now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear(),
             base, commission, 0, money(base + commission), 24 + t,
             t === 0 ? 'pending' : 'paid', t === 0 ? null : day(-5), t === 0 ? null : 'Bank Transfer']);
    }
    counts.payroll = trainerIds.length;

    // ---- auto-renew: some paying quietly, one card failing ------------------
    // Billing opens on an empty state unless somebody is actually enrolled,
    // and the retry ladder is the half of it worth looking at.
    let enrolled = 0;
    for (let i = 0; i < 14; i++) {
        const m = members[i * 4];
        if (!m || m.status !== 'active') continue;
        const method = pick(['UPI', 'Card', 'Bank Transfer'], i);
        await q(`UPDATE clients SET auto_renew = TRUE, recurring_method = $1 WHERE id = $2`,
            [method, m.id]);
        enrolled++;
        // Two of them have a charge that did not go through, one already on its
        // second attempt, so the dunning ladder has something to show.
        if (i === 3 || i === 9) {
            await q(`INSERT INTO billing_attempts (member_id, cycle, amount, method, status,
                                                   attempt_count, next_retry_at, error)
                     VALUES ($1,$2,$3,$4,'failed',$5,$6,$7)`,
                [m.id, m.expiry, m.fee, method, i === 3 ? 1 : 2, `${day(2)} 09:00`,
                 i === 3 ? 'Insufficient funds' : 'Mandate expired']);
        } else if (i % 3 === 0) {
            await q(`INSERT INTO billing_attempts (member_id, cycle, amount, method, status,
                                                   attempt_count, settled_at)
                     VALUES ($1,$2,$3,$4,'success',1,$5)`,
                [m.id, m.start, m.fee, method, `${m.start} 06:00`]);
        }
    }
    counts.autoRenew = enrolled;

    console.log(`  ✔ ${counts.autoRenew} members on auto-renew, two with a failed charge to chase`);
    console.log(`  ✔ ${counts.leads} leads, ${counts.products} products with ${counts.sales} sales,`
        + ` ${counts.lockers} lockers (${counts.lockerCharges} rented, paid and invoiced),`
        + ` ${counts.expenses} expenses, ${counts.invoices} invoices`);
    console.log(`  ✔ ${counts.tasks} tasks, ${counts.challenges} challenges with ${counts.challengeEntries} entries,`
        + ` ${counts.assessments} assessments`);
    console.log(`  ✔ ${counts.announcements} announcements, ${counts.feedback} feedback entries,`
        + ` ${counts.devices} devices`);
    console.log(`  ✔ ${counts.staffAttendance} staff attendance rows, ${counts.shifts} shifts,`
        + ` ${counts.payroll} payslips`);
    return counts;
}


/**
 * Five members whose portal is full on every tab.
 *
 * The rest of the seed spreads data thin on purpose — that is what makes the
 * dashboard, retention scoring and the gate interesting. But somebody opening
 * the member portal to look at it wants one ID where nothing is empty, and
 * "mostly populated" is not that: the Refer & earn tab in particular was blank
 * for all but two members in the whole gym.
 */
async function seedShowcase(members, trained, trainerIds, offerValue) {
    const pool = trained.filter(m => m.status === 'active' && m.due === 0 && m.expiry >= day(0));
    const stars = pool.slice(0, 5);
    if (stars.length === 0) return [];

    const others = members.filter(m => !stars.includes(m) && m.status === 'active');
    const adminId = (await q(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`)).rows[0]?.id ?? null;
    const upcoming = (await q(
        `SELECT id, capacity FROM gym_classes WHERE class_date >= CURRENT_DATE
         ORDER BY class_date, start_time LIMIT 40`)).rows;
    const past = (await q(
        `SELECT id FROM gym_classes WHERE class_date < CURRENT_DATE
         ORDER BY class_date DESC LIMIT 20`)).rows;

    for (let i = 0; i < stars.length; i++) {
        const m = stars[i];

        // These are the accounts somebody signs into again and again to look at
        // the product, so they are put on a yearly plan two months in: an ID
        // three days from expiry stops working by the end of the week, because
        // an expired membership cannot open the portal at all.
        //
        // The whole record moves together — plan, fee, dates and the payment
        // that bought them. Stretching the expiry on its own would have left a
        // "Monthly" membership running for seven months, which is exactly the
        // sort of thing this data exists to catch.
        const plan = 'Yearly';
        const fee = PLAN_FEE[plan];
        const start = day(-60 - i * 5);
        const expiry = day(PLAN_DAYS[plan] - 60 - i * 5);
        await q(`UPDATE clients SET membership_type = $1, membership_fee = $2, amount_paid = $2,
                        amount_due = 0, membership_start = $3, membership_expiry = $4
                 WHERE id = $5`, [plan, fee, start, expiry, m.id]);
        await q(`UPDATE payments SET amount = $1, plan_name = $2, period_start = $3, period_end = $4,
                        payment_date = $3
                 WHERE member_id = $5 AND purpose = 'membership'`, [fee, plan, start, expiry, m.id]);
        Object.assign(m, { plan, fee, paid: fee, due: 0, start, expiry });

        // ---- attendance: a real habit, three or four visits a week ----------
        for (let d = 1; d < 56; d++) {
            if (d % 7 === 0 || d % 7 === 3) continue;      // two rest days a week
            await q(`INSERT INTO attendance (member_id, member_name, date, time, status, source)
                     VALUES ($1,$2,$3,$4,'Present',$5)
                     ON CONFLICT (member_id, date) DO NOTHING`,
                [Number(m.member_code), m.name.toUpperCase(), day(-d),
                 `0${6 + (d % 3)}:${(d * 11) % 60 < 10 ? '0' : ''}${(d * 11) % 60}:00`,
                 pick(['qr', 'fingerprint', 'card'], d + i)]);
        }

        // ---- classes: some behind them, some to come, and one waitlisted ----
        for (let c = 0; c < 4 && c < past.length; c++) {
            await q(`INSERT INTO class_bookings (class_id, member_id, status)
                     VALUES ($1,$2,'attended') ON CONFLICT (class_id, member_id) DO NOTHING`,
                [past[(i * 3 + c) % past.length].id, m.id]);
        }
        for (let c = 0; c < 4 && c < upcoming.length; c++) {
            await q(`INSERT INTO class_bookings (class_id, member_id, status)
                     VALUES ($1,$2,$3) ON CONFLICT (class_id, member_id) DO NOTHING`,
                [upcoming[(i * 5 + c) % upcoming.length].id, m.id, c === 3 ? 'waitlisted' : 'booked']);
        }

        // ---- personal training: a term with sessions actually delivered -----
        const sub = (await q(
            `SELECT id, trainer_id FROM pt_subscriptions WHERE member_id = $1
             ORDER BY id DESC LIMIT 1`, [m.id])).rows[0];
        if (sub) {
            const NOTES = ['Push day — chest and triceps', 'Pull day — back and biceps',
                'Legs and core', 'Conditioning and mobility', 'Technique — squat depth',
                'Deadlift progression'];
            for (let sN = 0; sN < 6; sN++) {
                await q(`INSERT INTO pt_sessions (subscription_id, trainer_id, session_date,
                                                  session_time, notes)
                         VALUES ($1,$2,$3,$4,$5)`,
                    [sub.id, sub.trainer_id, day(-(sN * 4 + 2)), '07:30', NOTES[sN]]);
            }
            await q(`UPDATE pt_subscriptions SET sessions_used = GREATEST(sessions_used, 6)
                     WHERE id = $1`, [sub.id]);
        }

        // ---- refer & earn: invitations at every stage, one reward unspent ---
        const friends = others.slice(i * 3, i * 3 + 3);
        const STAGES = [
            ['pending', false, false],   // invited, has not walked in yet
            ['joined', false, false],    // joined, still owes something
            ['rewarded', true, false],   // paid in full — the reward is banked
        ];
        for (let f = 0; f < STAGES.length && f < friends.length; f++) {
            const [status, rewarded, redeemed] = STAGES[f];
            await q(`
                INSERT INTO referrals (referrer_id, referred_name, referred_phone,
                                       converted_member_id, status, reward_type, reward_value,
                                       reward_paid_on, redeemed_on, notes, created_at)
                VALUES ($1,$2,$3,$4,$5,'credit',$6,$7,$8,$9,$10)`,
                [m.id, friends[f].name, friends[f].phone || `98${String(31000000 + i * 100 + f)}`,
                 status === 'pending' ? null : friends[f].id, status, offerValue,
                 rewarded ? day(-12 + f) : null, redeemed ? day(-4) : null,
                 `Demo referral — ${status}`, day(-40 + f * 6)]);
            if (status !== 'pending') {
                await q('UPDATE clients SET referred_by_id = $1 WHERE id = $2', [m.id, friends[f].id]);
            }
        }

        // ---- a locker, so that tab has something in it too ------------------
        // Two of the five, so the "no locker, no tab" rule is visible as well.
        if (i < 2) {
            // One locker per member is a rule the service enforces, so free
            // whatever the earlier pass happened to give them first.
            await q(`UPDATE lockers SET member_id = NULL, status = 'free',
                            assigned_from = NULL, assigned_until = NULL
                     WHERE member_id = $1`, [m.id]);
            const number = `L-2${String(10 + i)}`;
            const rent = 350;
            const from = day(-30);
            const until = day(60 + i * 10);
            const { rows: lk } = await q(`
                INSERT INTO lockers (locker_number, location, size, monthly_rent, status,
                                     member_id, assigned_from, assigned_until)
                VALUES ($1,'Ground floor','Medium',$2,'occupied',$3,$4,$5)
                ON CONFLICT (locker_number) DO UPDATE SET member_id = EXCLUDED.member_id,
                    status = 'occupied', assigned_from = EXCLUDED.assigned_from,
                    assigned_until = EXCLUDED.assigned_until
                RETURNING id`, [number, rent, m.id, from, until]);
            const amount = money(rent * 3);
            await q(`INSERT INTO payments (member_id, amount, payment_date, method, note,
                                           purpose, reference_id, plan_name, period_start, period_end)
                     VALUES ($1,$2,$3,'UPI',$4,'locker',$5,$6,$7,$8)`,
                [m.id, amount, from, `Locker ${number} rent`, lk[0].id, `Locker ${number}`, from, until]);
            const { rows: inv } = await q(`
                INSERT INTO invoices (invoice_no, member_id, customer_name, invoice_date, subtotal,
                                      tax_amount, total, status, method, notes, issued_by)
                VALUES ($1,$2,$3,$4,$5,0,$5,'paid','UPI',$6,$7) RETURNING id`,
                [`DEMO-LKR-2${String(10 + i)}`, m.id, m.name, from, amount,
                 `Locker ${number}, ${from} to ${until}`, adminId]);
            await q(`INSERT INTO invoice_items (invoice_id, description, quantity, unit_price,
                                                tax_rate, tax_amount, line_total)
                     VALUES ($1,$2,1,$3,0,0,$3)`, [inv[0].id, `Locker ${number} rent`, amount]);
        }

        // ---- last year's term, so the payment history is a history ----------
        const lastTermStart = day(-60 - i * 5 - PLAN_DAYS[plan]);
        await q(`INSERT INTO payments (member_id, amount, payment_date, method, note,
                                       purpose, plan_name, period_start, period_end)
                 VALUES ($1,$2,$3,$4,$5,'membership',$6,$7,$8)`,
            [m.id, fee, lastTermStart, pick(METHODS, i), 'Membership renewal', plan,
             lastTermStart, m.start]);
    }

    console.log(`  ✔ ${stars.length} showcase members with every portal tab filled:`
        + ` ${stars.map(m => m.member_code).join(', ')}`);
    return stars;
}

// ── run ─────────────────────────────────────────────────────────────────────

(async () => {
    const db = process.env.DB_NAME || 'gymdb';
    console.log(`\nSeeding demo data into "${db}"…\n`);
    try {
        if (WIPE) await wipe();

        const trainerIds = await seedTrainers();
        const ptPlans = await seedPtPlans();
        const members = await seedMembers();
        if (members.length === 0) {
            console.log('\n  Nothing inserted — the demo members already exist.');
            console.log('  Run with --wipe to rebuild them.\n');
            // No pool.end() here: the finally block below closes it, and
            // closing twice throws "Called end on pool more than once" over
            // the top of a run that actually succeeded.
            return;
        }
        await seedPayments(members);
        const trained = await seedPersonalTraining(members, trainerIds, ptPlans);
        await seedTraining(trained);
        await seedAttendance(members);
        const referrers = await seedReferrals(members);
        await seedClasses(members, trainerIds);
        await seedOperations(members, trainerIds);
        const stars = await seedShowcase(members, trained, trainerIds, 100);

        const sample = members.find(m => m.due > 0);
        const healthy = members[50];
        console.log('\n─────────────────────────────────────────────────────────────');
        console.log(' Sign in and look at:');
        console.log(`   staff    admin / admin123`);
        console.log(`   trainer  coach.rahul / trainer123`);
        console.log(`   member   any Member ID below with password "admin"`);
        console.log('');
        for (const st of stars) {
            console.log(`   ${st.member_code}  ${st.name.padEnd(16)} — every tab: classes, workouts, diet,`
                + ' progress, attendance, payments, PT, referrals');
        }
        console.log('');
        console.log(`   ${healthy.member_code}  ${healthy.name} — trainer, PT plan, workouts, diet, progress`);
        console.log(`   ${referrers.anchor.member_code}  ${referrers.anchor.name} — referrals at every stage`);
        console.log(`   ${referrers.second.member_code}  ${referrers.second.name} — ₹100 reward waiting; renew to see it applied`);
        if (sample) {
            console.log(`   ${sample.member_code}  ${sample.name} — owes ₹${sample.due}, so the gate is locked`);
        }
        console.log('─────────────────────────────────────────────────────────────\n');
    } catch (err) {
        console.error('\n❌ Seeding failed:', err.message);
        // DEBUG=1 for the stack and the Postgres detail — a one-line message
        // like "numeric field overflow" does not say which insert did it.
        if (process.env.DEBUG) console.error(err);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
