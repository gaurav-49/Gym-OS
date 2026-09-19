# GYM OS 2.0

Gym management software, sold to gyms rather than run by one: nothing
gym-facing is hard-coded, and a new site is stood up by editing one properties
file.

Spring Boot 4 serves the REST API and the built React app from the same origin,
so there is one thing to deploy and no CORS to configure.

---

## Run it

```bash
# 1. Schema (idempotent — safe to re-run, upgrades a 1.0 database in place)
cd db && npm install && node migrate.js

# 2. A demo gym to look at: 120 members, 4 trainers, and every module populated
node seed-demo.js

# 3. Backend + bundled UI
cd ../backend-java && ./mvnw package && java -jar target/*.war
```

**http://localhost:8080** — staff sign in with `admin` / `admin123`.
The member portal is at **`#/member`**; the seed prints IDs worth trying, all
on the password `admin`.

Connection settings come from the environment (`DB_HOST`, `DB_PORT`, `DB_NAME`,
`DB_USER`, `DB_PASSWORD`) or a `.env` beside the migration.

> **Set `JWT_SECRET` before going live.** Without it every restart logs everyone
> out, and the `prod` profile refuses to start.

### Or with Docker

```bash
docker compose up -d --build
```

Postgres, the schema and the app, on **http://localhost:8080**.

## Deploy it

One command on a fresh Ubuntu server (written for Oracle Cloud Always Free):

```bash
curl -fsSL https://raw.githubusercontent.com/gaurav-49/Gym-OS/main/deploy/install.sh | sudo bash
```

It installs Docker, opens the firewall, generates secrets, applies the schema
and starts the stack behind automatic HTTPS. Both portals come up together —
staff at `https://<domain>/`, members at `https://<domain>/#/member` — because
they are one app on one origin. Re-run it to update; data and secrets survive.

Full notes, including the Oracle security-list rule that catches everyone out:
**[docs/deployment.md](docs/deployment.md)**.

---

## How it is put together

```
backend-java/   Spring Boot 4 · Java 25 · JdbcTemplate over PostgreSQL
frontend/       React 18 · Vite · MUI 7   → built into the war
db/             migrate.js (the schema) · seed-demo.js (a demo gym)
api/            one .http file per API, plus a scenario walkthrough
```

**Controller → Service (interface) → ServiceImpl → Dao → DaoImpl**, one package
per module: `member`, `attendance`, `payment`, `billing`, `invoices`, `pt`,
`lockers`, `classes`, `leads`, `referrals`, `retention`, `staff`, `inventory`,
`expenses`, `branding`, `portal` and the rest.

Two things worth knowing before changing the data layer:

- The datasource URL carries **`?stringtype=unspecified`**. Without it, date
  strings will not bind to `DATE` columns and every date-bearing insert fails
  with a 500 that looks like a bug in the code. Do not override
  `spring.datasource.url` on the command line.
- `db/migrate.js` **is** the schema. Every statement is `CREATE/ALTER … IF NOT
  EXISTS` or `ON CONFLICT DO NOTHING`, so it is safe to re-run, and the
  integration tests apply it to their throwaway database rather than keeping a
  second copy that would drift.

---

## The rules the product actually enforces

These are the ones that surprise people reading the code:

**The gate is the same on every door.** Unpaid dues, an expired membership, a
freeze or an inactive account refuse entry by fingerprint, card, QR *and* the
manual attendance form. There is no instalment option: unpaid is unpaid.

**A member cannot check themselves in.** The QR in the member portal is
display-only; it is marked when staff scan it in the main app.

**Personal training is sold by duration**, exactly like membership — Monthly,
Quarterly, Half-Yearly, Yearly at a fee for the term. Not by the session.
Sessions are logged as a record of what the trainer delivered; nothing counts
down.

**A payment records what it bought** — purpose, plan name, the period covered,
the subscription or locker it paid for, and any discount — so a receipt states
what was actually sold rather than reading the member's current membership.

**Member IDs run in sequence and belong to one person for life.** Deactivating
keeps the number. Only a permanent delete (`DELETE /api/clients/{id}/purge`,
admin, inactive members only) gives it back, and then it goes to the front of
the queue.

**Names and addresses are stored in Title Case**, however they were typed —
except anything with a digit in it (`12A`, `L-101`) and short all-capital words
(`MG Road`), which are identifiers and acronyms.

**Referrals pay once.** The reward is earned when the person introduced pays in
full, and comes off the referrer's next renewal — once, with the reason printed
on the receipt.

---

## White-labelling

`backend-java/src/main/resources/branding.properties` holds the gym's identity:
name, tagline, slogan, logo, colour, contact details, GSTIN and the small print
on printed documents. Layered, lowest precedence first:

1. that file, bundled in the war — the shipped install
2. `./branding.properties` beside the war — per site, no rebuild
3. `GYM_BRANDING_*` environment variables — containers and CI
4. the `settings` table — whatever an admin has since changed in the app

"GYM OS" survives only as the optional *Powered by* line, which a gym can turn
off.

---

## Tests

```bash
cd backend-java
./mvnw test                 # 164 unit + 54 integration
./scripts/e2e-all.sh        # 389 assertions against a real server
```

The integration tests need **Docker running** — they start a throwaway
PostgreSQL with Testcontainers and apply `db/migrate.js` to it. Without Docker,
run `./mvnw test -Dtest='!*IntegrationTest'` for the unit tests alone.

`scripts/e2e-all.sh` resets `gymdb_test`, boots the freshly built war on port
3001 and walks every module, both portals included. It never touches `gymdb`.

---

## Sample requests

[`api/`](api/) holds one `.http` file per API — `auth.http`, `clients.http`,
`payments.http`, `pt.http`, `lockers.http` and the rest — with
[README.md](api/README.md) as the index. Each file signs in at the top and is
self-contained; bodies work as-is against the demo data, and the requests that
are *meant* to be refused say so with the status to expect.

[`api/TEST_SCENARIOS.md`](api/TEST_SCENARIOS.md) is the guided version: what to
click through in the demo gym and what should happen.
