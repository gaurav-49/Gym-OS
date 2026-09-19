# GYM OS — backend-java (Spring Boot 4, enterprise)

Enterprise Java port of the Express backend. Same **`/api` REST contract**, same
**`gymdb` PostgreSQL schema**, same error shapes and status codes — so the
existing React frontend (`frontend/`) works against it **without changes**.

## Stack (latest, verified 2026)

| Layer | Version |
|---|---|
| Java | 26 (latest via Homebrew `brew install openjdk`; Boot 4.1 supports 17–26) |
| Spring Boot | **4.1.0** (Spring Framework 7, Jakarta EE 11, Servlet 6.1) |
| Spring Security | 7 (stateless JWT, method security) |
| JSON | Jackson 3 (`tools.jackson.*`, annotations in `com.fasterxml.jackson.annotation`) |
| DB access | Spring JDBC (`JdbcTemplate`) against the existing `gymdb` schema |
| JWT | jjwt 0.13.0 (HS256) |
| Logging | Logback (from Boot 4) + SLF4J MDC request-id correlation; optional built-in ECS structured logging |
| Ops | Actuator: `/actuator/health` (liveness/readiness probes), `/actuator/info`, metrics |

## Layered architecture (every module)

```
Controller → Service (interface) → ServiceImpl → DAO (interface) → DAOImpl (SQL)
```

- **Controller** — thin HTTP layer: paths, verbs, DTO binding, status codes.
- **Service / ServiceImpl** — business rules, validation, Node message/status
  parity; never touches SQL.
- **DAO / DAOImpl** — the module's SQL queries + row mapping live here
  (the "respective module sql").
- **common/** — shared code so nothing is duplicated:
  - `common.api` — `BusinessException`, `ApiError` (the `{ error }` contract)
  - `common.config` — `SecurityConfig` (JWT, roles, JSON 401/403), `CorsConfig`
  - `common.security` — `JwtService`, `JwtAuthFilter`, `AuthUser` principal
  - `common.web` — `RequestIdFilter` (X-Request-ID + MDC), `HttpLogFilter`,
    `GlobalExceptionHandler`
  - `common.util` — `MaskingUtils` (email/phone masking)

```
backend-java/src/main/java/com/gymos/
├── GymApplication.java
├── common/            ← shared code (config, security, web, api, util)
├── auth/              ← module: controller → service/impl → dao/impl → dto, entity
├── otp/               ← module: service/impl → dao/impl
└── notify/            ← module: service/impl (SMTP / Twilio / console)
```

## Prerequisites

- A JDK. The pom targets **Java 25** by default (the newest LTS the official
  Tomcat 11 Docker images run). To build on an older JDK, pass the target
  explicitly — on JDK 17, `./mvnw -Djava.version=17 package`.
- PostgreSQL with the `gymdb` schema. 2.0 has no `schema.sql` — the migration
  *is* the schema, and it is idempotent:
  `createdb gymdb && (cd ../db && npm install && node migrate.js)`
- No Maven install needed — the checked-in **Maven Wrapper** downloads Maven
  on first run (requires network access to repo.maven.apache.org).

## Run

### Dev (backend only, frontend via Vite)

```bash
cd backend-java
./mvnw spring-boot:run          # default port 8080 (see below)
```

The default port is **8080** — the port the READMEs, the `api/*.http` samples
and the Vite dev proxy all assume, so `npm run dev` in `frontend/` reaches this
server with no configuration. Override with `SERVER_PORT`, and set the proxy to
match with `VITE_API_PORT`.

### Enterprise: one artifact with the UI bundled (WAR)

`mvn package` **builds the React UI automatically** and bundles it into the WAR
(`WEB-INF/classes/static`) — the frontend's `api.js` already calls a relative
`/api`, so the UI and API live on the **same origin**, no proxy needed.

```bash
cd backend-java
./mvnw clean package -DskipTests        # lean WAR for an external Tomcat 11
# or, to keep the single-command workflow:
./mvnw clean package -DskipTests -Pstandalone   # executable WAR (embedded Tomcat)
```

**Deploy to Tomcat (enterprise):** copy the WAR to `webapps/ROOT.war` and the
whole app — UI **and** API — is served at `http://localhost:8080/`:

```bash
cp target/gym-backend-java-0.2.0.war /opt/tomcat/webapps/ROOT.war
# UI at /  ·  API at /api/*  ·  health at /actuator/health
```

**Or run standalone** (embedded Tomcat, same artifact with `-Pstandalone`):

```bash
java -jar target/gym-backend-java-0.2.0.war   # serves UI + API on :8080
```

Verified end-to-end on a real **Tomcat 11** (Docker, JDK 25):
`GET /` serves the React app, `/api/*` answers, and the member portal
login/check-in works — all with rid-correlated logs. Set `VITE_BASE=/<ctx>/`
before `mvn package` to host under a named context instead of ROOT.

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `SERVER_PORT` | `8080` | API port (Vite proxy target; see `VITE_API_PORT`) |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | localhost / 5432 / gymdb / gauravsharma / "" | PostgreSQL |
| `JWT_SECRET` | `gym-dev-secret-change-me` | JWT signing secret |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | empty | OTP email delivery (empty → console) |
| `SMS_TWILIO_SID` / `SMS_TWILIO_TOKEN` / `SMS_TWILIO_FROM` | empty | OTP SMS delivery (empty → console) |

## Tests

**169 tests, all layers, all green** (`./mvnw test`):

- **Unit tests** (Mockito, no DB) — `common/security/JwtServiceTest` (round
  trip, expiry, tamper, wrong secret), `common/util/MaskingUtilsTest` (masking
  parity with Node), `auth/service/impl/*Test` (every service branch: login,
  recovery, forgot, OTP reset, rate limit, lockout, CRUD, COALESCE update),
  `otp/service/impl/OtpServiceImplTest` (6-digit OTP hashed at rest, TTL,
  hourly limit, lockout), `notify/service/impl/NotifyServiceImplTest` (console
  fallback, SMTP failure), and the DAO tests which verify the module SQL is
  executed with the right arguments and that row mapping is correct
  (`auth/dao/impl/UserDaoImplTest`, `otp/dao/impl/OtpDaoImplTest`).
- **Integration tests** (full Spring context + MockMvc + real PostgreSQL) —
  `integration/AuthApiIntegrationTest` (login/me/recovery/forgot/OTP flows,
  rate limiting, lockout, `X-Request-ID` echo + generation + sanitization,
  CORS exposure), `integration/UsersApiIntegrationTest` (401/403 guards,
  admin CRUD, 409 duplicate, 400 self-delete, 404s),
  `integration/ErrorHandlingIntegrationTest` (malformed JSON → 400,
  unknown route → 404 JSON, actuator health).

### Running the tests

```bash
cd backend-java
./mvnw test
```

The integration tests need **Docker** (Docker Desktop running) — they spin upa throwaway `postgres:17-alpine` container via Testcontainers, so no local
PostgreSQL database is required and the real `gymdb` is never touched. The
test base class builds the schema by running 2.0's own `db/migrate.js`
against the container (`node` must be on PATH), then truncates every table it
finds in `pg_tables` and reseeds before each test, so tests are isolated and
repeatable and the schema under test is the one that ships. OTP delivery
falls back to the console in tests, so `dev_otp` is returned and the full
reset flow is verified end to end.

## What is ported (all modules)

The full `/api` contract is ported, each module in the same layered shape
(controller → service/impl → dao/impl → SQL in the module's DAO):

| Module | Endpoints |
|---|---|
| Auth | `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/forgot`, `POST /api/auth/verify-otp`, `GET /api/auth/recovery-options/:username` |
| Users | `GET/POST /api/users`, `PUT/DELETE /api/users/:id` |
| Members | `/api/clients` CRUD + renew / renumber / freeze / resume / upgrade / cancel, expiry + dues-gate rules |
| Attendance | `/api/attendance`, `/mark`, `/report`, public `POST /api/device/punch`, `/qr-punch` |
| Devices | `/api/devices` CRUD |
| Dashboard | `GET /api/dashboard/stats` |
| Payments | `/api/payments` CRUD + `/collect`, ledger |
| Exceptions / field rules | `GET /api/exceptions?module=…`, `GET /api/field-rules?module=…` (DB-driven validation messages) |
| Classes & bookings | `/api/classes` CRUD + series, trainers, book/waitlist/cancel with waitlist promotion; member self-service `/api/member/classes*` |
| Notifications | `/api/notifications/settings`, `/expiring`, `/log`, manual + hourly reminders (`@Scheduled`, opt-out via `app.scheduling.enabled=false`) |
| Billing | `/api/billing/overview`, member settings/retry/mark-paid/pause, `@Scheduled` auto-renew + dunning |
| Leads | `/api/leads` CRUD + `/convert` (reuses the members `ClientDao`) |
| Member portal | `POST /api/member/login`, `GET /api/member/me`, `POST /api/member/checkin` — separate 12h member JWT (`GYMOS:<code>` QR payload) |
| Member tabs | `/api/progress`, `/api/workouts`, `/api/diet` (+ legacy `/diets`) CRUD |

Shared helpers live in `common/` (dates, membership rules, payment modes,
request-id correlation, structured logging, global error handler, CORS,
actuator health). `MemberPortalServiceImpl`, `ClassServiceImpl` and
`LeadServiceImpl` reuse `ClientDao` for member lookups — the common code the
Node backend duplicates.

For a full-stack check against a running server, use `scripts/e2e-all.sh` —
it resets a sandbox database, boots the war on a spare port and exercises every
module and both portals.

## Notes

- **Sessions invalidate on switch**: tokens are signed with
  SHA-256(JWT_SECRET). Users must log in again after the backend swaps —
  the frontend already handles 401 by returning to login.
- Add `backend-java/target/` to `.gitignore` (build output).
