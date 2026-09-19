#!/usr/bin/env node
/**
 * Attendance history for a gym that already has members but no check-ins.
 *
 *   node seed-attendance.js
 *
 * A fresh install shows an empty dashboard — no weekly chart, nothing in
 * Recent Activity, "Present Today" stuck at zero — because attendance is the
 * one table nothing else fills. This writes a plausible history so those
 * views have something to show.
 *
 *   MEMBERS   how many members to give attendance to  (default 450)
 *   DAYS      how far back to go, in days             (default 60)
 *   TODAY_PCT roughly what share attend on any day    (default 35)
 *
 * INSERT only. It issues no DELETE and no UPDATE, and every insert is
 * ON CONFLICT DO NOTHING against the (member_id, date) unique index, so a
 * real check-in already recorded for a member on a day is never overwritten
 * and re-running this is safe.
 *
 * Connection settings come from the environment, same names as migrate.js:
 *   DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD
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

const MEMBERS = Number(envOr('MEMBERS', '450'));
const DAYS = Number(envOr('DAYS', '60'));
const TODAY_PCT = Number(envOr('TODAY_PCT', '35'));

// Deterministic, so a re-run with the same settings produces the same history
// rather than a second, differently-shaped one layered on top.
let seed = 20260919;
const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const isoDate = (daysAgo) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().slice(0, 10);
};

// Gyms fill up before work and after it, so draw from those two windows
// rather than uniformly across the day — it makes the hourly views readable.
const checkInTime = () => {
    const morning = rand() < 0.55;
    const hour = morning
        ? 6 + Math.floor(rand() * 4)     // 06:00–09:59
        : 17 + Math.floor(rand() * 4);   // 17:00–20:59
    const min = Math.floor(rand() * 60);
    const sec = Math.floor(rand() * 60);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(hour)}:${pad(min)}:${pad(sec)}`;
};

(async () => {
    // Active members first: attendance for someone whose membership lapsed
    // months ago would show up as nonsense in the retention views.
    const { rows: members } = await pool.query(
        `SELECT id, name FROM clients
         WHERE membership_expiry IS NULL OR membership_expiry >= CURRENT_DATE - INTERVAL '30 days'
         ORDER BY id
         LIMIT $1`, [MEMBERS]);

    if (members.length === 0) {
        console.error('❌ no members found — seed members before attendance');
        process.exit(1);
    }
    console.log(`Seeding attendance for ${members.length} member(s) over ${DAYS} day(s)…`);

    let written = 0;
    let skipped = 0;

    for (let daysAgo = 0; daysAgo < DAYS; daysAgo++) {
        const date = isoDate(daysAgo);
        const dow = new Date(date).getDay();
        // Sunday is quiet in most gyms; Monday is the busiest day of the week.
        const factor = dow === 0 ? 0.45 : dow === 1 ? 1.15 : 1.0;

        const rows = [];
        for (const m of members) {
            if (rand() * 100 > TODAY_PCT * factor) continue;
            rows.push([m.id, m.name, date, checkInTime(),
                       rand() < 0.7 ? 'device' : 'manual']);
        }
        if (rows.length === 0) continue;

        // One statement per day rather than per row: 60 round trips instead of
        // ~9,000, which matters over an SSH-tunnelled connection.
        const values = rows.map((_, i) => {
            const b = i * 5;
            return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, 'Present', $${b + 5})`;
        }).join(', ');

        const res = await pool.query(
            `INSERT INTO attendance (member_id, member_name, date, time, status, source)
             VALUES ${values}
             ON CONFLICT (member_id, date) DO NOTHING`,
            rows.flat());

        written += res.rowCount;
        skipped += rows.length - res.rowCount;
    }

    const { rows: [total] } = await pool.query('SELECT count(*) AS n FROM attendance');
    const { rows: [today] } = await pool.query(
        "SELECT count(*) AS n FROM attendance WHERE date = CURRENT_DATE");

    console.log(`✅ ${written} check-in(s) written, ${skipped} already existed`);
    console.log(`   attendance now holds ${total.n} row(s); ${today.n} of them are today`);

    await pool.end();
})().catch((err) => {
    console.error('❌ seeding attendance failed:', err.message);
    process.exit(1);
});
