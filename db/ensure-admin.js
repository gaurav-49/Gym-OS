#!/usr/bin/env node
/**
 * Creates the first staff account, if the database has none.
 *
 *   node ensure-admin.js
 *
 * Why this exists. migrate.js lays down the schema and seed-demo.js fills it
 * with a demo gym, but neither one ever creates a staff account — seed-demo.js
 * only looks one up (`SELECT id FROM users WHERE role = 'admin'`) and carries
 * on with null if there isn't one. On a developer's machine that never shows,
 * because the account has been sitting in their local database since 1.0. On a
 * freshly provisioned server it means the app comes up perfectly and nobody
 * can sign in to it, which is how this was found.
 *
 * Idempotent: if any admin already exists, this changes nothing and leaves the
 * existing password alone. It is safe on a database holding real records.
 *
 *   ADMIN_USERNAME   default: admin
 *   ADMIN_PASSWORD   default: generated
 *   ADMIN_NAME       default: Administrator
 *   ADMIN_CREDENTIALS_FILE  where a generated password is written
 *                           (default: .admin-credentials beside this script)
 *
 * A generated password is written to that file, never to stdout: this runs
 * from a deploy log, and on a public repository those logs are public. A
 * password passed in through ADMIN_PASSWORD is never echoed at all.
 *
 * Connection settings come from the environment, same names as migrate.js:
 *   DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

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

// Readable rather than maximally random: this gets copied out of a deploy log
// by hand, and an ambiguous character costs more than the entropy saves.
// ~62 bits, which is plenty for an account whose password should be changed
// on first sign-in anyway.
const generatePassword = () => {
    const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from(crypto.randomFillSync(new Uint32Array(12)))
        .map((n) => alphabet[n % alphabet.length])
        .join('');
};

(async () => {
    const username = envOr('ADMIN_USERNAME', 'admin');
    const name = envOr('ADMIN_NAME', 'Administrator');

    const existing = await pool.query(
        `SELECT username FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`);
    if (existing.rows.length > 0) {
        console.log(`✅ staff account already exists (${existing.rows[0].username}) — unchanged`);
        await pool.end();
        return;
    }

    // A username can be taken by a non-admin (a trainer seeded earlier, say),
    // in which case promoting it is friendlier than failing on the unique index.
    const taken = await pool.query('SELECT id, role FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    const password = envOr('ADMIN_PASSWORD', '') || generatePassword();
    const generated = !envOr('ADMIN_PASSWORD', '');
    const hash = bcrypt.hashSync(password, 10);

    if (taken.rows.length > 0) {
        await pool.query(
            `UPDATE users SET role = 'admin', password_hash = $2 WHERE id = $1`,
            [taken.rows[0].id, hash]);
        console.log(`✅ promoted existing user "${username}" to admin and set its password`);
    } else {
        await pool.query(
            `INSERT INTO users (username, password_hash, name, role)
             VALUES (LOWER($1), $2, $3, 'admin')`,
            [username, hash, name]);
        console.log(`✅ created the first staff account`);
    }

    console.log(`   username: ${username.toLowerCase()}`);

    if (generated) {
        // Deliberately not stdout: this runs from a deploy log, and on a
        // public repository those logs are readable by anyone.
        const file = envOr('ADMIN_CREDENTIALS_FILE',
            path.resolve(__dirname, '.admin-credentials'));
        fs.writeFileSync(file,
            `username=${username.toLowerCase()}\npassword=${password}\n`,
            { mode: 0o600 });
        console.log(`   password: generated — written to ${file} (chmod 600)`);
        console.log('   Read it over SSH, or set ADMIN_PASSWORD to choose your own.');
    } else {
        console.log('   password: the one supplied via ADMIN_PASSWORD (not echoed)');
    }
    console.log('   Change it after the first sign-in: Users → this account.');

    await pool.end();
})().catch((err) => {
    console.error('❌ could not create the staff account:', err.message);
    process.exit(1);
});
