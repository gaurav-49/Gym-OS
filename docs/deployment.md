# Deploying GYM OS 2.0

## One command

On a fresh Ubuntu server — an Oracle Cloud Always Free instance is the case this
was written for:

```bash
curl -fsSL https://raw.githubusercontent.com/gaurav-49/Gym-OS/main/deploy/install.sh | sudo bash
```

Ten minutes later both portals are live over HTTPS:

| | |
|---|---|
| Staff portal | `https://<your-domain>/` |
| Member portal | `https://<your-domain>/#/member` |

Re-running the installer updates to the latest code and keeps the database and
the secrets in `.env`.

Useful variations:

```bash
# your own domain instead of the generated sslip.io name
curl -fsSL <url> | sudo DOMAIN=gym.example.com bash

# also load the demo gym (120 members, 4 trainers, every module populated)
curl -fsSL <url> | sudo SEED_DEMO=1 bash

# local time for reports, schedules and expiry dates
curl -fsSL <url> | sudo TZ=Asia/Kolkata bash
```

---

## Both portals are one deployment

This is the thing worth being clear about, because "deploy both portals" sounds
like two of everything.

The staff portal and the member portal are **the same React bundle on the same
origin**, routed on the URL fragment:

```
https://gym.example.com/            → staff portal  (App.jsx default view)
https://gym.example.com/#/member    → member portal (App.jsx hash route)
```

The fragment after `#` never leaves the browser, so the server sees one request
path and serves one SPA. Spring Boot serves that bundle out of the same WAR that
serves `/api`, which is why there is a single container, a single certificate and
no CORS configuration anywhere.

What this means in practice:

- **One deploy covers both.** There is no second service to start, no second
  image to build, no second DNS record to create.
- **Give members the `#/member` link.** That is the whole difference. It is worth
  putting on the membership card or a QR code at the desk.
- **The two portals are separated by authentication, not by deployment.** Staff
  sign in at `/api/auth/login` with a username; members sign in at
  `/api/member/login` with a Member ID. They get different tokens and different
  permissions from the same server.

If you ever do want members on their own hostname — `members.example.com` rather
than a fragment — that is a Caddy change, not an application change: add a second
site block that proxies to the same `app:8080`. Nothing in the app needs to know.

---

## What the installer sets up

1. **Docker**, if it is not already there, plus 4 GB of swap on machines with
   less than 4 GB of RAM. The Maven and Vite builds need the headroom; the
   Oracle micro shape does not have it.
2. **Ports 80 and 443** through `ufw` and through the iptables rules that Oracle
   Cloud's Ubuntu images ship with (they reject everything except SSH).
3. **The code** in `/opt/gym-os`.
4. **`.env`** with a generated `JWT_SECRET` and `DB_PASSWORD`, at `chmod 600`.
   Later runs leave it alone.
5. **The schema**, by running the project's own `db/migrate.js`. It is
   idempotent and upgrades a 1.0 database in place.
6. **The stack**: Postgres 17, the app, and Caddy for automatic HTTPS.

### The pieces

```
Dockerfile                one image: Vite build → Maven build → JRE runtime
docker-compose.yml        app + postgres + a one-shot migrate, for local use
docker-compose.prod.yml   public server: HTTPS, restarts, memory ceilings
deploy/Caddyfile          TLS termination and the reverse proxy
deploy/install.sh         everything above, in one command
deploy/.env.production.example
```

The `migrate` service runs `db/migrate.js` from a Node container rather than a
schema copied into the image, because that script *is* the schema. A second copy
would drift from it within a release.

---

## First thing after the install

**Change the admin password.** `admin` / `admin123` is the documented default in
a public repository — treat it as though it is already known.

> Staff portal → Users → admin → set a new password

Members sign in with their Member ID and `MEMBER_DEFAULT_PASSWORD` (`admin` by
default). That default is deliberate — the portal is read-only apart from class
bookings, and the desk can hand over a Member ID and have the member in straight
away. Changing it in `.env` also means changing the hash seeded by
`db/migrate.js`; the note in `application.yml` explains why.

---

## Oracle Cloud specifics

**Shape.** The Always Free Ampere A1 (4 OCPU / 24 GB) is comfortable. The
`VM.Standard.E2.1.Micro` (1 OCPU / 1 GB) works, but the first build is slow and
depends on the swap the installer adds.

**The security list is the usual reason the site will not open.** Opening the
ports on the host is not enough — the VCN filters traffic before it reaches the
machine:

> Networking → Virtual Cloud Networks → *your VCN* → Subnets → *your subnet* →
> Security Lists → Default Security List → **Add Ingress Rules**
>
> | Source | Protocol | Destination port |
> |---|---|---|
> | `0.0.0.0/0` | TCP | 80 |
> | `0.0.0.0/0` | TCP | 443 |

**DNS is optional.** With no domain, the installer uses
`<public-ip>.sslip.io`, which resolves to that IP without any DNS setup and
still gets a real Let's Encrypt certificate.

**Certificates are issued on the first visit** and can take up to a minute. A
browser error immediately after the install is usually just that.

---

## Day-to-day

```bash
cd /opt/gym-os

# logs
docker compose -p gym-os logs -f app

# restart
docker compose -p gym-os -f docker-compose.yml -f docker-compose.prod.yml restart app

# stop (data survives)
docker compose -p gym-os -f docker-compose.yml -f docker-compose.prod.yml down

# update to the latest code
curl -fsSL https://raw.githubusercontent.com/gaurav-49/Gym-OS/main/deploy/install.sh | sudo bash
```

### Backups

Everything that matters is in one Postgres volume.

```bash
# back up
docker compose -p gym-os exec -T postgres \
  pg_dump -U gymos gymdb | gzip > gym-os-$(date +%F).sql.gz

# restore into an empty database
gunzip -c gym-os-2026-01-31.sql.gz | \
  docker compose -p gym-os exec -T postgres psql -U gymos gymdb
```

Worth a cron job and somewhere off the machine — Oracle Object Storage is free
at this size.

---

## Hosting alongside another app on the same server

`deploy/install.sh` assumes GYM OS owns ports 80 and 443. If the same box
already runs something else with its own Caddy — InsightRAG, say — the two
Caddys fight over those ports and only one wins.

The fix is one shared Caddy in front of both, each app reached by hostname:

```
                         ┌─────────────┐
  https://insightrag.…   │             │   insightrag-api:8080
  ───────────────────────▶  shared     │───────────────────────▶ InsightRAG
                         │  Caddy      │
  https://gym.…          │  (80/443)  │   gymos-app:8080
  ───────────────────────▶             │───────────────────────▶ GYM OS
                         └─────────────┘
```

That's `deploy/edge/` — a small, separate Caddy stack that holds 80/443 and
proxies to both apps over a shared Docker network (`shared_edge`). Each app
stops running its own Caddy and instead deploys with
`docker-compose.shared-edge.yml` in place of `docker-compose.prod.yml`, which
drops its Caddy service and joins `shared_edge` under a fixed container name
(`gymos-app`, `insightrag-api`) so the shared Caddy can find it.

**If GYM OS is going on a server that already runs InsightRAG** (or vice
versa), don't run `deploy/install.sh` for the second app — it'll fail to bind
80/443, already held by the first app's Caddy. Instead, run the one migration
script once, from GYM OS's repo (it drives both apps):

```bash
curl -fsSL https://raw.githubusercontent.com/gaurav-49/Gym-OS/main/deploy/edge/migrate-to-shared.sh \
  -o /tmp/migrate-to-shared.sh

sudo INSIGHTRAG_DOMAIN=insightrag.YOUR-IP.sslip.io \
     GYMOS_DOMAIN=gym.YOUR-IP.sslip.io \
     bash /tmp/migrate-to-shared.sh
```

It expects InsightRAG already deployed once standalone (so its `.env` and
`JWT_SECRET` exist) — there's no way around that, since it only adds
InsightRAG to the shared network rather than bootstrapping it from scratch.
GYM OS is the opposite: **don't** run `deploy/install.sh` for it first — on a
server that already runs another app's Caddy, GYM OS's own Caddy would fail
to bind 80/443, so this script clones GYM OS and generates its `.env` itself
if it isn't already on the server. The script then:

1. creates the `shared_edge` Docker network,
2. redeploys InsightRAG with `docker-compose.shared-edge.yml` — `--remove-orphans`
   retires its old Caddy container, since the new file set doesn't define one,
3. clones GYM OS (if it isn't there yet) and generates its `.env`,
4. applies the GYM OS schema, then deploys the app,
5. brings up the one shared Caddy in `deploy/edge/`, fronting both.

Two distinct hostnames on one IP need no DNS of your own — sslip.io resolves
any subdomain to the IP embedded in it, so `insightrag.203-0-113-10.sslip.io`
and `gym.203-0-113-10.sslip.io` both just work, pointed at the same server.

Re-running the migration script after either app updates is safe — it
redeploys both from their current `main`.

---

## Notes and gotchas

**`DB_PASSWORD` is only read on the first start.** Postgres stores the password
inside its data volume when the volume is created. Changing it in `.env`
afterwards breaks the app's connection rather than rotating the password. To
rotate it properly:

```bash
docker compose -p gym-os exec postgres \
  psql -U gymos -c "ALTER USER gymos PASSWORD 'new-password';"
# then update DB_PASSWORD in .env and restart the app
```

**`JWT_SECRET` must be set in production.** The `prod` profile refuses to start
without it, on purpose: a published fallback secret would let anyone who reads
the source mint an admin token. Changing it signs everyone out.

**Memory ceilings** in `docker-compose.prod.yml` (1.5 GB for the app, 1 GB for
Postgres) suit a 4 GB machine. On the 24 GB Ampere shape you can raise them; on
the 1 GB micro shape the app's `MaxRAMPercentage=75` already scales the heap down
to fit.

**Actuator is not public.** Two layers: the app already answers 401 on every
actuator endpoint except health, and Caddy returns 404 for them as well so they
are not even discoverable from outside. Reach them from the host:

```bash
docker compose -p gym-os exec app curl -s localhost:8080/actuator/metrics
```
