#!/usr/bin/env bash
# Full-module E2E for the GYM OS 2.0 backend.
#
#   ./scripts/e2e-all.sh
#
# 1. Resets the sandbox database (gymdb_test by default) with Gym 2.0's own
#    migration, then seeds an admin and a trainer. The real gymdb is never
#    touched.
# 2. Boots the freshly built war on a spare port (3001 by default).
# 3. Runs scripts/e2e_all.py against it — every module, 1.0 and 2.0, including
#    both portals.
# 4. Prints the X-Request-ID correlation count from the server log, then shuts
#    the server down.
#
# Exit code 0 when every assertion passes.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
TWO_OH="$(dirname "$ROOT")"
DB_NAME="${DB_NAME:-gymdb_test}"
# NB: use E2E_PORT, not PORT — the ambient environment may set PORT=0
PORT="${E2E_PORT:-3001}"
LOG="${E2E_LOG:-/tmp/gym-e2e-all.log}"
ADMIN_PASS="${ADMIN_PASS:-admin123}"
TRAINER_PASS="${TRAINER_PASS:-trainer123}"
# A real secret so the run does not exercise the random-per-process fallback.
export JWT_SECRET="${JWT_SECRET:-e2e-secret-long-enough-to-pass-the-length-check}"

# The build produces a war (the SPA is bundled into it); fall back to a jar.
JAR="${JAR:-}"
if [ -z "$JAR" ]; then
    JAR="$(ls "$ROOT"/target/gym-backend-java-*.war "$ROOT"/target/gym-backend-java-*.jar 2>/dev/null | head -1)"
fi
if [ ! -f "$JAR" ]; then
    echo "No built artifact found. Run: ./mvnw package"
    exit 1
fi

JAVA_BIN="java"
if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then
    JAVA_BIN="$JAVA_HOME/bin/java"
fi

echo "== 1/4 reset sandbox DB ($DB_NAME) =="
createdb "$DB_NAME" 2>/dev/null || true
psql -d "$DB_NAME" -q -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
# Gym 2.0 owns its schema — the migration is the single source of truth.
( cd "$TWO_OH/db" && DB_NAME="$DB_NAME" node migrate.js > /dev/null ) || {
    echo "migration failed"; exit 1; }
ADMIN_HASH="$(cd "$TWO_OH/db" && node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" "$ADMIN_PASS" 2>/dev/null)"
TRAINER_HASH="$(cd "$TWO_OH/db" && node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" "$TRAINER_PASS" 2>/dev/null)"
if [ -z "$ADMIN_HASH" ]; then
    echo "bcryptjs missing — run: cd \"$TWO_OH/db\" && npm install"
    exit 1
fi
psql -d "$DB_NAME" -q -c "INSERT INTO users (username, password_hash, name, role, email, phone) VALUES
    ('admin', '$ADMIN_HASH', 'Administrator', 'admin', 'admin@gym.local', '9990000001'),
    ('trainer', '$TRAINER_HASH', 'Trainer One', 'trainer', 'trainer@gym.local', '9990000002')
    ON CONFLICT (username) DO NOTHING;"
echo "   seeded admin/$ADMIN_PASS and trainer/$TRAINER_PASS"

echo "== 2/4 boot server on :$PORT =="
rm -f "$LOG"
# Schedulers off: the retention and billing sweeps would otherwise race the
# assertions by rewriting risk bands and memberships mid-run.
SERVER_PORT="$PORT" DB_NAME="$DB_NAME" \
    nohup "$JAVA_BIN" -jar "$JAR" --app.scheduling.enabled=false > "$LOG" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 60); do
    curl -s -m 2 -o /dev/null "http://localhost:$PORT/actuator/health" && break
    sleep 1
done
curl -s -m 3 "http://localhost:$PORT/actuator/health" | grep -q UP || {
    echo "server failed to start"; tail -30 "$LOG"; exit 1; }

echo "== 3/4 run full-module battery =="
python3 "$SCRIPT_DIR/e2e_all.py" "http://localhost:$PORT"
RC=$?

echo
echo "== 4/4 rid correlation in server log =="
RID="$(grep -oE 'e2e-full-[0-9]+' "$LOG" | head -1)"
echo "   request-id used: $RID"
echo "   server log lines carrying that rid: $(grep -c "$RID" "$LOG")"

exit $RC
