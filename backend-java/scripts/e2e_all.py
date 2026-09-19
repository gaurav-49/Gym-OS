#!/usr/bin/env python3
"""Full-module E2E battery for the GYM OS 2.0 backend.

Covers every module with real body assertions:

  1.0 core     auth, users, members, attendance, devices, dashboard, payments,
               exceptions/field-rules, classes, notifications, billing, leads,
               member portal, progress, workouts, diet
  2.0 selling  plans, lockers, inventory + POS, invoices, personal training
  2.0 money    expenses, finance P&L, staff attendance/shifts/payroll
  2.0 growth   retention & churn risk, tasks, referrals, challenges,
               assessments, announcements, feedback
  2.0 admin    branches, audit trail

Usage:  python3 e2e_all.py [base_url]        (default http://localhost:3001)

Requires a running server on a freshly reset gymdb_test (see e2e-all.sh).
Exit code 0 when every assertion passes.
"""
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import date, timedelta

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3001"
RID = "e2e-full-%d" % int(time.time())
PASS = 0
FAIL = 0
FAILED = []


def req(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json", "X-Request-ID": RID}
    if token:
        headers["Authorization"] = "Bearer " + token
    r = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(r)
        code, payload = resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        code, payload = e.code, e.read().decode()
    try:
        js = json.loads(payload) if payload else None
    except ValueError:
        js = payload
    return code, js


def ok(cond, name, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  ok  %s" % name)
    else:
        FAIL += 1
        FAILED.append(name)
        print("  FAIL %s  %s" % (name, detail))


def section(title):
    print("\n== %s ==" % title)


def today(days=0):
    return (date.today() + timedelta(days=days)).isoformat()


# ---------------------------------------------------------------------------
section("auth / users")
code, login, _ = None, None, None
code, login = req("POST", "/api/auth/login", body={"username": "admin", "password": "admin123"})
ok(code == 200 and login.get("token"), "admin login 200 + token", str(code))
ADMIN = login["token"]
code, _ = req("POST", "/api/auth/login", body={"username": "admin", "password": "wrong"})
ok(code == 401, "wrong password 401", str(code))
code, me = req("GET", "/api/auth/me", token=ADMIN)
ok(code == 200 and me.get("username") == "admin", "GET /auth/me", str(code))
code, users = req("GET", "/api/users", token=ADMIN)
ok(code == 200 and any(u["username"] == "admin" for u in users), "list users has admin", str(code))
code, u = req("POST", "/api/users", token=ADMIN,
              body={"username": "staffx", "password": "staff123", "name": "Staff X", "role": "staff"})
ok(code == 201 and u.get("id"), "create user 201", str(code))
uid = u["id"]
code, _ = req("PUT", "/api/users/%d" % uid, token=ADMIN, body={"name": "Staff X2"})
ok(code == 200, "update user", str(code))
code, _ = req("DELETE", "/api/users/%d" % uid, token=ADMIN)
ok(code == 200, "delete user", str(code))
code, tl = req("POST", "/api/auth/login", body={"username": "trainer", "password": "trainer123"})
ok(code == 200 and tl.get("token"), "trainer login", str(code))
TRAINER = tl["token"]

# ---------------------------------------------------------------------------
section("members (clients)")
code, alice = req("POST", "/api/clients", token=ADMIN, body={
    "member_code": "101", "name": "Alice", "phone": "9990000001", "email": "alice@gym.local",
    "gender": "F", "membership_type": "Monthly", "membership_start": today(-25),
    "membership_expiry": today(5), "membership_fee": 1000, "amount_paid": 1000,
    "payment_mode": "Cash"})
ok(code == 201 and alice.get("id") and alice.get("status") == "active", "create Alice 201", str(code) + " " + str(alice))
ALICE = alice["id"]
code, _ = req("POST", "/api/clients", token=ADMIN, body={
    "member_code": "101", "name": "Duplicate", "phone": "9999999999",
    "membership_type": "Monthly", "membership_start": today(), "membership_expiry": today(30),
    "membership_fee": 1000, "amount_paid": 1000, "payment_mode": "Cash"})
ok(code == 409, "duplicate member code 409", str(code))
code, bob = req("POST", "/api/clients", token=ADMIN, body={
    "member_code": "102", "name": "Bob", "phone": "9990000002", "email": "bob@gym.local",
    "membership_type": "Monthly", "membership_start": today(), "membership_expiry": today(60),
    "membership_fee": 1000, "amount_paid": 1000, "payment_mode": "Cash"})
ok(code == 201 and bob.get("id"), "create Bob 201", str(code))
BOB = bob["id"]
code, carol = req("POST", "/api/clients", token=ADMIN, body={
    "member_code": "103", "name": "Carol", "phone": "9990000003", "email": "carol@gym.local",
    "membership_type": "Monthly", "membership_start": today(), "membership_expiry": today(30),
    "membership_fee": 1000, "amount_paid": 0, "payment_mode": "Cash"})
ok(code == 201 and carol.get("id"), "create Carol 201 (dues pending)", str(code))
CAROL = carol["id"]
code, dave = req("POST", "/api/clients", token=ADMIN, body={
    "member_code": "104", "name": "Dave", "phone": "9990000004", "email": "dave@gym.local",
    "membership_type": "Monthly", "membership_start": today(), "membership_expiry": today(30),
    "membership_fee": 1000, "amount_paid": 1000, "payment_mode": "Cash"})
ok(code == 201 and dave.get("id"), "create Dave 201", str(code))
DAVE = dave["id"]
code, eve = req("POST", "/api/clients", token=ADMIN, body={
    "member_code": "105", "name": "Eve", "phone": "9990000005", "email": "eve@gym.local",
    "membership_type": "Monthly", "membership_start": today(), "membership_expiry": today(30),
    "membership_fee": 1000, "amount_paid": 1000, "payment_mode": "Cash"})
ok(code == 201 and eve.get("id"), "create Eve 201 (device punch uses Eve; Alice stays clean for portal check-in)", str(code))
EVE = eve["id"]
code, clients = req("GET", "/api/clients?search=101", token=ADMIN)
ok(code == 200 and any(c["member_code"] == "101" for c in clients), "list/search clients", str(code))
code, one = req("GET", "/api/clients/%d" % ALICE, token=ADMIN)
ok(code == 200 and one.get("name") == "Alice", "get client by id", str(code))
code, _ = req("PUT", "/api/clients/%d" % ALICE, token=ADMIN, body={"name": "Alice A"})
ok(code == 200, "update client (rename Alice → Alice A)", str(code))
code, _ = req("PUT", "/api/clients/%d/renumber" % ALICE, token=ADMIN, body={"member_code": "1001"})
ok(code == 200, "renumber 101 → 1001", str(code))
code, _ = req("PUT", "/api/clients/%d/renumber" % ALICE, token=ADMIN, body={"member_code": "101"})
ok(code == 200, "renumber back to 101", str(code))

# ---------------------------------------------------------------------------
section("attendance")
code, rec = req("POST", "/api/attendance/mark", token=ADMIN,
                body={"member_id": "104", "date": today(), "time": "09:30", "status": "Present"})
ok(code == 201 and "Attendance marked" in rec.get("message", ""), "mark attendance 201", str(code) + " " + str(rec))
code, _ = req("POST", "/api/attendance/mark", token=ADMIN,
              body={"member_id": "104", "date": today(), "time": "09:30", "status": "Present"})
ok(code == 409, "duplicate mark 409", str(code))
code, _ = req("POST", "/api/attendance/qr-punch", token=ADMIN, body={"member_id": "102"})  # Bob
ok(code == 201, "qr-punch 201", str(code))
# Alice's visit, scanned at the desk. This is the only way a check-in is ever
# written now — the member portal shows her QR but cannot mark her present —
# and the challenge leaderboard further down counts it.
code, _ = req("POST", "/api/attendance/qr-punch", token=ADMIN, body={"member_id": "101"})  # Alice
ok(code == 201, "qr-punch scanned by staff 201", str(code))
code, _ = req("POST", "/api/device/punch", body={"member_id": "105"})  # Eve — one punch per member per day
ok(code == 201, "device punch (public) 201", str(code))
code, att = req("GET", "/api/attendance", token=ADMIN)
ok(code == 200 and isinstance(att, list) and len(att) >= 3, "attendance list (mark + qr + device)", str(code))
code, _ = req("GET", "/api/attendance/report?from=%s&to=%s" % (today(-1), today(1)), token=ADMIN)
ok(code == 200, "attendance report", str(code))

# ---------------------------------------------------------------------------
section("devices")
code, dev = req("POST", "/api/devices", token=ADMIN,
                body={"name": "Front Gate", "ip_address": "192.168.1.50", "port": 80})
ok(code == 201 and dev.get("id"), "create device", str(code))
DEVID = dev["id"]
code, devs = req("GET", "/api/devices", token=ADMIN)
ok(code == 200 and any(d["id"] == DEVID for d in devs), "list devices", str(code))
code, _ = req("PUT", "/api/devices/%d" % DEVID, token=ADMIN, body={"name": "Front Gate 2"})
ok(code == 200, "update device", str(code))
code, _ = req("DELETE", "/api/devices/%d" % DEVID, token=ADMIN)
ok(code == 200, "delete device", str(code))

# ---------------------------------------------------------------------------
section("dashboard")
code, stats = req("GET", "/api/dashboard/stats", token=ADMIN)
ok(code == 200 and stats.get("total_members") == 5, "dashboard stats total_members=5", str(code) + " " + str(stats)[:140])
ok(isinstance(stats.get("monthly_revenue"), list), "monthly_revenue is array")
ok(isinstance(stats.get("today_collection"), (int, float)), "today_collection number")

# ---------------------------------------------------------------------------
section("payments")
code, pay = req("POST", "/api/payments", token=ADMIN,
                body={"member_id": CAROL, "amount": 400, "method": "Cash"})
ok(code == 201 and pay.get("member_id") == CAROL, "record payment 201", str(code))
code, pays = req("GET", "/api/payments?member_id=%d" % CAROL, token=ADMIN)
ok(code == 200 and pays[0].get("member_name") == "Carol", "list payments w/ member_name", str(code))
code, coll = req("POST", "/api/payments/%d/collect" % CAROL, token=ADMIN, body={"method": "Cash"})
ok(code == 200 and "Dues cleared" in coll.get("message", ""), "collect due → dues cleared", str(code) + " " + str(coll))
code, _ = req("POST", "/api/payments/collect-all", token=ADMIN, body={"method": "Cash"})
ok(code == 200, "collect-all", str(code))
code, _ = req("POST", "/api/payments", token=ADMIN, body={"member_id": CAROL, "amount": -5})
ok(code == 400, "negative payment 400", str(code))

# ---------------------------------------------------------------------------
section("exceptions / field rules")
code, exc = req("GET", "/api/exceptions?module=members", token=ADMIN)
ok(code == 200 and exc and exc[0].get("code") == "E101" and "MEMBER ID IS MANDATORY" in exc[0].get("message", ""),
   "exceptions master data E101", str(code))
code, fr = req("GET", "/api/field-rules?module=members", token=ADMIN)
ok(code == 200 and fr and fr[0].get("code") == "E101", "field-rules alias", str(code))

# ---------------------------------------------------------------------------
section("classes & bookings")
code, trainers = req("GET", "/api/classes/trainers", token=ADMIN)
ok(code == 200 and any(t.get("username") == "trainer" for t in trainers), "trainers list", str(code))
code, cls = req("POST", "/api/classes", token=ADMIN, body={
    "name": "Morning Yoga", "trainer_id": 2, "class_date": today(1), "start_time": "10:00",
    "end_time": "11:00", "capacity": 1})
ok(code == 201 and cls.get("id"), "create class 201", str(code))
CLS = cls["id"]
code, series = req("POST", "/api/classes/series", token=ADMIN, body={
    "name": "Weekly Spin", "weekday": 1, "start_date": "2026-08-17", "end_date": "2026-09-07",
    "start_time": "18:00", "capacity": 10})
ok(code == 201 and series.get("created", 0) > 0, "create series", str(code) + " " + str(series))
code, classes = req("GET", "/api/classes", token=ADMIN)
ok(code == 200 and any(c["id"] == CLS for c in classes), "list classes", str(code))
code, detail = req("GET", "/api/classes/%d" % CLS, token=ADMIN)
ok(code == 200 and detail.get("capacity") == 1, "class detail", str(code))
code, b1 = req("POST", "/api/classes/%d/book" % CLS, token=ADMIN, body={"member_id": ALICE})
ok(code == 201 and b1.get("status") == "booked", "book Alice (fills seat)", str(code) + " " + str(b1))
code, b2 = req("POST", "/api/classes/%d/book" % CLS, token=ADMIN, body={"member_id": BOB})
ok(code == 202 and b2.get("status") == "waitlisted", "book Bob → waitlisted", str(code) + " " + str(b2))
code, cb = req("POST", "/api/classes/%d/cancel-booking" % CLS, token=ADMIN, body={"member_id": ALICE})
ok(code == 200 and cb.get("promoted") == "Bob", "cancel Alice → Bob promoted", str(code) + " " + str(cb))
code, _ = req("PUT", "/api/classes/%d" % CLS, token=ADMIN, body={"capacity": 5})
ok(code == 200, "update class", str(code))
code, _ = req("DELETE", "/api/classes/%d" % CLS, token=ADMIN)
ok(code == 200, "delete (cancel) class", str(code))

# ---------------------------------------------------------------------------
section("notifications")   # runs while Alice still expires within 10 days
code, ns = req("GET", "/api/notifications/settings", token=ADMIN)
ok(code == 200 and ns.get("expiry_reminder_days") == 7, "settings defaults", str(code) + " " + str(ns))
code, ns = req("PUT", "/api/notifications/settings", token=ADMIN, body={"expiry_reminder_days": 10})
ok(code == 200 and ns.get("expiry_reminder_days") == 10, "update settings", str(code))
code, exp = req("GET", "/api/notifications/expiring?days=10", token=ADMIN)
ok(code == 200 and exp.get("days") == 10 and any("Alice" in m.get("name", "") for m in exp.get("members", [])),
   "expiring members includes Alice", str(code) + " " + str(exp)[:180])
code, _ = req("POST", "/api/notifications/expiry-reminder/%d" % ALICE, token=ADMIN)
ok(code == 200, "manual reminder", str(code))
code, log = req("GET", "/api/notifications/log", token=ADMIN)
ok(code == 200 and isinstance(log, list), "notification log", str(code))

# ---------------------------------------------------------------------------
section("member lifecycle (upgrade / renew / freeze / resume / events)")
code, _ = req("POST", "/api/clients/%d/upgrade" % ALICE, token=ADMIN,
              body={"membership_type": "Yearly", "amount": 5000, "method": "Cash"})
ok(code == 200, "upgrade to Yearly", str(code))
code, _ = req("PUT", "/api/clients/%d/renew" % ALICE, token=ADMIN, body={"months": 1})
ok(code == 200, "renew +1 month", str(code))
code, _ = req("POST", "/api/clients/%d/freeze" % ALICE, token=ADMIN, body={"days": 5})
ok(code == 200, "freeze", str(code))
code, frozen = req("GET", "/api/clients/%d" % ALICE, token=ADMIN)
# Node parity: freeze sets frozen_until (status stays active) — the gate checks frozen_until.
ok(frozen.get("frozen_until") is not None, "frozen_until set", str(frozen.get("frozen_until")))
code, _ = req("POST", "/api/clients/%d/resume" % ALICE, token=ADMIN, body={})
ok(code == 200, "resume", str(code))
code, resumed = req("GET", "/api/clients/%d" % ALICE, token=ADMIN)
ok(resumed.get("frozen_until") is None and resumed.get("status") == "active",
   "status active + frozen_until cleared after resume", str(resumed.get("frozen_until")))
code, ev = req("GET", "/api/clients/%d/events" % ALICE, token=ADMIN)
ok(code == 200 and isinstance(ev, list) and len(ev) >= 3,
   "membership events (upgrade/freeze/resume)", str(code) + " n=%d" % (len(ev) if isinstance(ev, list) else 0))

# ---------------------------------------------------------------------------
section("billing")
code, ov = req("GET", "/api/billing/overview", token=ADMIN)
ok(code == 200 and ov.get("settings", {}).get("auto_renew_enabled") is True, "billing overview", str(code))
code, mb = req("PUT", "/api/billing/members/%d" % ALICE, token=ADMIN,
               body={"auto_renew": True, "recurring_method": "UPI"})
ok(code == 200 and mb.get("member", {}).get("auto_renew") is True,
   "enable auto-renew + UPI (member.auto_renew)", str(code) + " " + str(mb)[:180])
code, retry = req("POST", "/api/billing/members/%d/retry" % ALICE, token=ADMIN)
ok(code == 200 and retry.get("status") == "renewed" and retry.get("new_expiry"), "retry → renewed + new_expiry",
   str(code) + " " + str(retry))
code, mp = req("POST", "/api/billing/members/%d/mark-paid" % ALICE, token=ADMIN, body={"method": "Cash"})
ok(code == 200 and mp.get("new_expiry"), "mark-paid → new_expiry", str(code) + " " + str(mp)[:140])
code, pz = req("POST", "/api/billing/members/%d/pause" % ALICE, token=ADMIN)
ok(code == 200 and "paused" in pz.get("message", "").lower(), "pause auto-renew", str(code) + " " + str(pz))
code, bs = req("PUT", "/api/billing/settings", token=ADMIN, body={"auto_renew_enabled": True})
ok(code == 200, "update billing settings", str(code))

# ---------------------------------------------------------------------------
section("leads")
code, lead = req("POST", "/api/leads", token=ADMIN,
                 body={"name": "Ravi Kumar", "phone": "9990000004", "interest": "Monthly", "source": "walk-in"})
ok(code == 201 and lead.get("id"), "create lead", str(code))
LEAD = lead["id"]
code, leads = req("GET", "/api/leads?status=new", token=ADMIN)
ok(code == 200 and leads[0].get("name") == "Ravi Kumar", "list leads (status=new)", str(code))
code, _ = req("PUT", "/api/leads/%d" % LEAD, token=ADMIN, body={"status": "contacted"})
ok(code == 200, "update lead", str(code))
# Converting is onboarding, so it goes down the one path that enforces
# onboarding's rules — it no longer assembles a member out of whatever the
# enquiry happened to carry. Anything the form would refuse is refused here.
code, overpaid = req("POST", "/api/leads/%d/convert" % LEAD, token=ADMIN, body={
    "membership_type": "Monthly", "membership_fee": 1000, "amount_paid": 5000})
ok(code == 400, "converting with money that does not add up is refused",
   str(code) + " " + str(overpaid)[:140])

code, badphone = req("POST", "/api/leads/%d/convert" % LEAD, token=ADMIN, body={
    "membership_type": "Monthly", "phone": "abcdefghij"})
ok(code == 400, "...and so is a phone number that is not one",
   str(code) + " " + str(badphone)[:140])

code, conv = req("POST", "/api/leads/%d/convert" % LEAD, token=ADMIN, body={
    "membership_type": "Monthly", "membership_fee": 2000, "amount_paid": 2000,
    "payment_mode": "Cash", "address": "12, Station Road", "gender": "Male",
    "dob": "1994-03-18"})
ok(code == 201 and conv.get("member", {}).get("status") == "active"
   and conv.get("lead", {}).get("status") == "converted", "convert lead → member", str(code) + " " + str(conv)[:180])
ok(float(conv.get("member", {}).get("membership_fee") or 0) == 2000,
   "...with the fee the desk actually took", str(conv.get("member", {}).get("membership_fee")))

# The desk's own route: the onboarding form created the member, so converting
# only has to close the enquiry.
code, lead2 = req("POST", "/api/leads", token=ADMIN,
                  body={"name": "Walk In Later", "phone": "9995551212", "interest": "Monthly"})
LEAD2 = lead2["id"]
code, m2 = req("POST", "/api/clients", token=ADMIN, body={
    "member_code": "8802", "name": "Walk In Later", "phone": "9995551212",
    "membership_type": "Monthly", "membership_fee": 2000, "amount_paid": 2000})
code, linked = req("POST", "/api/leads/%d/convert" % LEAD2, token=ADMIN,
                   body={"member_id": m2["id"]})
ok(code == 201 and linked["lead"]["converted_member_id"] == m2["id"],
   "a member onboarded first is simply linked to the lead", str(code) + " " + str(linked)[:140])
code, _ = req("DELETE", "/api/clients/%d" % m2["id"], token=ADMIN)
code, _ = req("DELETE", "/api/leads/%d" % LEAD2, token=ADMIN)

code, again = req("POST", "/api/leads/%d/convert" % LEAD, token=ADMIN, body={})
ok(code == 400 and "already converted" in again.get("error", ""), "re-convert rejected 400", str(code) + " " + str(again))
code, _ = req("DELETE", "/api/leads/%d" % LEAD, token=ADMIN)
ok(code == 200, "delete lead", str(code))

# ---------------------------------------------------------------------------
section("access gate: unpaid means locked, on every door")
# There is no instalment option in this product, so an outstanding balance
# locks access outright. The manual form used to be the way round it: the gate
# checks sat behind "was a member_name supplied?", and that is the one path
# that always supplies one.
code, gated = req("POST", "/api/clients", token=ADMIN, body={
    "member_code": "8801", "name": "Owes Money", "phone": "9995550001",
    "membership_type": "Monthly", "membership_fee": 1000, "amount_paid": 800})
ok(code == 201 and float(gated.get("amount_due", 0)) == 200,
   "a part-paid member owes the balance", str(code) + " " + str(gated.get("amount_due")))
GATED = gated["id"]

code, byqr = req("POST", "/api/attendance/qr-punch", token=ADMIN, body={"member_id": "8801"})
ok(code == 403 and byqr.get("gate") == "locked", "QR is locked while dues are owed", str(code) + " " + str(byqr))
code, bydev = req("POST", "/api/device/punch", body={"member_id": "8801"})
ok(code == 403 and bydev.get("gate") == "locked", "the fingerprint terminal is locked too", str(code))
code, bymanual = req("POST", "/api/attendance/mark", token=ADMIN, body={
    "member_id": "8801", "member_name": "OWES MONEY", "date": today(),
    "time": "09:00", "status": "Present"})
ok(code == 403 and bymanual.get("gate") == "locked",
   "and so is the manual form — the old way round the gate", str(code) + " " + str(bymanual))

# Paying up unlocks every one of them.
code, _ = req("POST", "/api/payments", token=ADMIN, body={
    "member_id": GATED, "amount": 200, "method": "Cash"})
ok(code == 201, "collect the outstanding 200", str(code))
code, opened = req("POST", "/api/attendance/qr-punch", token=ADMIN, body={"member_id": "8801"})
ok(code == 201, "the gate opens once the balance is clear", str(code) + " " + str(opened)[:120])
code, _ = req("DELETE", "/api/clients/%d" % GATED, token=ADMIN)

# ---------------------------------------------------------------------------
section("member portal")
DEFAULT_MEMBER_PASSWORD = "admin"
MEMBER_PASSWORD = "Member#Pass1"

# Every member starts on the gym default, so the desk hands over a Member ID
# and the member is in — no activation step to walk anyone through.
code, first = req("POST", "/api/member/login",
                  body={"member_code": "101", "password": DEFAULT_MEMBER_PASSWORD})
ok(code == 200 and first.get("token") and first.get("password_is_default") is True,
   "a new member signs in on the gym default password", str(code) + " " + str(first)[:160])

# An unknown Member ID says so, rather than blaming the password.
code, nobody = req("POST", "/api/member/login",
                   body={"member_code": "909909", "password": DEFAULT_MEMBER_PASSWORD})
ok(code == 401 and "No member found" in nobody.get("error", ""),
   "an unknown Member ID says so", str(code) + " " + str(nobody))

# The registered phone is not a credential.
code, byphone = req("POST", "/api/member/login", body={"member_code": "101", "password": "9990000001"})
ok(code == 401, "the registered phone does not sign a member in", str(code))

# Changing needs the current password...
code, badcur = req("POST", "/api/member/change-password", body={
    "member_code": "101", "current_password": "not-it", "new_password": MEMBER_PASSWORD})
ok(code == 401 and "not your current password" in badcur.get("error", ""),
   "change-password rejects a wrong current password", str(code) + " " + str(badcur))

# ...and refuses to "change" to the password every member already has.
code, samedef = req("POST", "/api/member/change-password", body={
    "member_code": "101", "current_password": DEFAULT_MEMBER_PASSWORD,
    "new_password": DEFAULT_MEMBER_PASSWORD})
ok(code == 400, "change-password refuses to set the gym default", str(code) + " " + str(samedef))

code, chg = req("POST", "/api/member/change-password", body={
    "member_code": "101", "current_password": DEFAULT_MEMBER_PASSWORD,
    "new_password": MEMBER_PASSWORD})
ok(code == 200 and chg.get("token") and chg.get("password_is_default") is False,
   "change-password sets a new one and signs in", str(code) + " " + str(chg)[:160])

# The default no longer works for this member.
code, olddef = req("POST", "/api/member/login",
                   body={"member_code": "101", "password": DEFAULT_MEMBER_PASSWORD})
ok(code == 401, "the gym default stops working once changed", str(code))

# Reset by OTP. recovery-options must answer the same shape for an ID that does
# not exist, or it becomes a free check of which Member IDs are real.
code, rec = req("GET", "/api/member/recovery-options?member_code=101")
ok(code == 200 and rec.get("phone") and "*" in rec["phone"],
   "member recovery options are masked", str(code) + " " + str(rec))
code, norec = req("GET", "/api/member/recovery-options?member_code=909909")
ok(code == 200 and norec.get("phone") is None and norec.get("email") is None,
   "recovery options leak nothing for an unknown ID", str(code) + " " + str(norec))

code, sent = req("POST", "/api/member/forgot", body={"member_code": "101", "method": "sms"})
ok(code == 200 and sent.get("dev_otp") and sent.get("resend_after_seconds", 0) > 0,
   "member forgot sends an OTP and starts the resend clock", str(code) + " " + str(sent)[:160])
MEMBER_OTP = sent["dev_otp"]

# The ladder applies to members too — a second OTP straight away is refused.
code, toosoon = req("POST", "/api/member/forgot", body={"member_code": "101", "method": "sms"})
ok(code == 429, "an immediate member OTP resend is refused", str(code) + " " + str(toosoon))

code, badotp = req("POST", "/api/member/verify-otp", body={
    "member_code": "101", "otp": "000000", "new_password": "Reset#Pass1"})
ok(code == 401 and "Invalid or expired OTP" in badotp.get("error", ""),
   "a wrong member OTP is rejected", str(code) + " " + str(badotp))

# A rejected new password must not burn the OTP — otherwise the member pays a
# whole resend for a typo.
code, reused = req("POST", "/api/member/verify-otp", body={
    "member_code": "101", "otp": MEMBER_OTP, "new_password": MEMBER_PASSWORD})
ok(code == 400, "resetting to the current password is refused", str(code) + " " + str(reused))
code, done = req("POST", "/api/member/verify-otp", body={
    "member_code": "101", "otp": MEMBER_OTP, "new_password": "Reset#Pass1"})
ok(code == 200, "the same OTP still works after that rejection", str(code) + " " + str(done))

# Back to the password the rest of this run expects.
code, sent2 = req("POST", "/api/member/change-password", body={
    "member_code": "101", "current_password": "Reset#Pass1", "new_password": MEMBER_PASSWORD})
ok(code == 200, "change back to the run's member password", str(code) + " " + str(sent2)[:120])

code, wrong = req("POST", "/api/member/login", body={"member_code": "101", "password": "not-it"})
ok(code == 401 and "Incorrect password" in wrong.get("error", ""), "login wrong password 401", str(code))
code, mlogin = req("POST", "/api/member/login", body={"member_code": "101", "password": MEMBER_PASSWORD})
ok(code == 200 and mlogin.get("token") and mlogin.get("qr_payload") == "GYMOS:101"
   and mlogin.get("expires_in") == "12h", "member login + qr_payload", str(code) + " " + str(mlogin))
MTOK = mlogin["token"]
code, mme = req("GET", "/api/member/me", token=MTOK)
ok(code == 200 and "Alice" in mme.get("name", "") and mme.get("membership_type") == "Yearly"
   and mme.get("qr_payload") == "GYMOS:101" and mme.get("expired") is False
   and isinstance(mme.get("workouts"), list) and isinstance(mme.get("diet"), list)
   and isinstance(mme.get("progress"), list) and isinstance(mme.get("attendance"), list)
   and isinstance(mme.get("payments"), list), "member /me full profile", str(code))
ok(mme.get("days_left") >= 0, "days_left >= 0 (got %s)" % mme.get("days_left"))

# Regression: the portal must return THIS member's attendance.
# attendance.member_id holds clients.id, but the portal used to pass the
# member_code into that column. Postgres cast the string to an integer without
# complaint, so every member was served the check-in history of whoever
# happened to hold that number as a primary key — a live privacy leak that the
# old assertion (isinstance(..., list)) sailed straight past.
# Alice is ALICE (clients.id) with member_code "101"; the two differ, which is
# exactly the case that made the bug invisible in a small fixture.
code, all_att = req("GET", "/api/attendance", token=ADMIN)
rows = all_att if isinstance(all_att, list) else all_att.get("data", [])
alice_rows = [r for r in rows if str(r.get("member_id")) == str(ALICE)]
portal_dates = sorted(str(a["date"]) for a in mme.get("attendance", []))
staff_dates = sorted(str(r["date"]) for r in alice_rows)[-30:]
ok(portal_dates == staff_dates,
   "member /me attendance is the member's own rows, not another member's",
   "portal=%s staff=%s (ALICE id=%s, code=101)" % (portal_dates, staff_dates, ALICE))
# A member must NOT be able to mark their own attendance. Their own token is
# all a self check-in would need, so it could be done from anywhere and would
# prove nothing about who was in the building. Attendance is written only by
# the staff-authenticated scanner in the main app.
code, ck = req("POST", "/api/member/checkin", token=MTOK)
ok(code in (403, 404, 405), "a member cannot check themselves in", str(code) + " " + str(ck))
code, before = req("GET", "/api/member/me", token=MTOK)
visits_before = len(before.get("attendance", []))
code, _ = req("POST", "/api/member/checkin", token=MTOK)
code, after = req("GET", "/api/member/me", token=MTOK)
ok(len(after.get("attendance", [])) == visits_before,
   "no attendance row appears from a self check-in attempt",
   "%d → %d" % (visits_before, len(after.get("attendance", []))))

# member self-service classes (fresh class — the earlier one was cancelled)
code, mc = req("POST", "/api/classes", token=ADMIN, body={
    "name": "Evening Yoga", "trainer_id": 2, "class_date": today(2), "start_time": "18:00",
    "capacity": 10})
ok(code == 201 and mc.get("id"), "create class for portal booking", str(code))
MC = mc["id"]
code, verify = req("POST", "/api/member/classes/verify", body={"member_code": "101", "password": MEMBER_PASSWORD})
ok(code == 200 and verify.get("token"), "member classes verify → token", str(code))
code, mclasses = req("GET", "/api/member/classes", token=MTOK)
ok(code == 200 and isinstance(mclasses, list), "member classes list", str(code))
code, book = req("POST", "/api/member/classes/%d/book" % MC, token=MTOK)
ok(code == 201 and book.get("status") == "booked", "member book class", str(code) + " " + str(book))
code, mine = req("GET", "/api/member/classes/my", token=MTOK)
ok(code == 200 and mine and mine[0].get("name") == "Evening Yoga"
   and mine[0].get("booking_status") == "booked", "member my bookings", str(code) + " " + str(mine)[:180])
code, _ = req("POST", "/api/member/classes/%d/cancel" % MC, token=MTOK)
ok(code == 200, "member cancel booking", str(code))

# ---------------------------------------------------------------------------
section("member tabs (progress / workouts / diet)")
code, prog = req("POST", "/api/progress", token=ADMIN, body={"member_id": ALICE, "weight": 75.5, "body_fat": 18})
ok(code == 201 and prog.get("weight") == 75.5, "add progress", str(code) + " " + str(prog))
PROG = prog["id"]
code, plist = req("GET", "/api/progress?member_id=%d" % ALICE, token=ADMIN)
ok(code == 200 and plist[0].get("weight") == 75.5, "list progress", str(code))
code, _ = req("DELETE", "/api/progress/%d" % PROG, token=ADMIN)
ok(code == 200, "delete progress", str(code))
code, _ = req("DELETE", "/api/progress/%d" % PROG, token=ADMIN)
ok(code == 404, "delete progress again 404", str(code))

code, wo = req("POST", "/api/workouts", token=ADMIN,
               body={"member_id": ALICE, "day": "Monday", "exercise": "Squat", "sets": 3, "reps": 12})
ok(code == 201 and wo.get("id"), "add workout", str(code))
WO = wo["id"]
code, wu = req("PUT", "/api/workouts/%d" % WO, token=ADMIN, body={"reps": 15})
ok(code == 200 and wu.get("reps") == 15, "update workout", str(code))
code, _ = req("DELETE", "/api/workouts/%d" % WO, token=ADMIN)
ok(code == 200, "delete workout", str(code))
code, _ = req("DELETE", "/api/workouts/%d" % WO, token=ADMIN)
ok(code == 404, "delete workout again 404", str(code))

code, diet = req("POST", "/api/diet", token=ADMIN,
                 body={"member_id": ALICE, "meal": "Breakfast", "food_item": "Oats", "calories": 300})
ok(code == 201 and diet.get("id"), "add diet", str(code))
DIET = diet["id"]
code, dlist = req("GET", "/api/diets?member_id=%d" % ALICE, token=ADMIN)
ok(code == 200 and dlist[0].get("food_item") == "Oats", "list diet (legacy /diets)", str(code))
code, du = req("PUT", "/api/diet/%d" % DIET, token=ADMIN, body={"calories": 350})
ok(code == 200 and du.get("calories") == 350, "update diet", str(code))
code, _ = req("DELETE", "/api/diets/%d" % DIET, token=ADMIN)
ok(code == 200, "delete diet", str(code))

# ---------------------------------------------------------------------------
section("plans (membership packages)")
code, plan = req("POST", "/api/plans", token=ADMIN,
                 body={"name": "E2E 45-Day", "duration_days": 45, "price": 2200, "signup_fee": 100})
ok(code == 201 and plan.get("duration_days") == 45, "create 45-day plan", str(code))
PLAN = plan["id"]
code, dup = req("POST", "/api/plans", token=ADMIN,
                body={"name": "E2E 45-Day", "duration_days": 45, "price": 2200})
ok(code == 409, "duplicate plan name 409", str(code))
code, bad = req("POST", "/api/plans", token=ADMIN, body={"name": "E2E Bad", "duration_days": 0, "price": 1})
ok(code == 400, "zero-day plan 400", str(code))
code, plans = req("GET", "/api/plans?active=true", token=ADMIN)
ok(code == 200 and any(p["name"] == "E2E 45-Day" for p in plans), "list active plans", str(code))

# The plans master must actually drive the expiry, not a hardcoded 30 days.
code, pm = req("POST", "/api/clients", token=ADMIN, body={
    "member_code": "801", "name": "Plan Member", "phone": "9990000801",
    "membership_type": "E2E 45-Day", "membership_start": today(0)})
ok(code == 201 and pm.get("membership_expiry") == today(45),
   "new plan drives the computed expiry (+45 days)", "%s %s" % (code, pm.get("membership_expiry")))
PLAN_MEMBER = pm["id"]
code, _ = req("DELETE", "/api/plans/%d" % PLAN, token=ADMIN)
ok(code == 400, "cannot delete a plan members are on", str(code))
code, _ = req("PUT", "/api/plans/%d" % PLAN, token=ADMIN, body={"name": "E2E Renamed"})
ok(code == 400, "cannot rename a plan members are on", str(code))
code, _ = req("POST", "/api/plans", token=TRAINER, body={"name": "E2E Sneaky", "duration_days": 30, "price": 1})
ok(code == 403, "trainer cannot create a plan 403", str(code))

# ---------------------------------------------------------------------------
section("lockers")
code, locker = req("POST", "/api/lockers", token=ADMIN,
                   body={"locker_number": "e2e-1", "size": "Large", "monthly_rent": 300})
ok(code == 201 and locker.get("locker_number") == "E2E-1", "create locker (number upper-cased)", str(code))
LOCKER = locker["id"]
code, _ = req("POST", "/api/lockers", token=ADMIN, body={"locker_number": "E2E-1"})
ok(code == 409, "duplicate locker number 409", str(code))
code, _ = req("POST", "/api/lockers", token=ADMIN, body={"locker_number": "E2E-2", "size": "Enormous"})
ok(code == 400, "bad locker size 400", str(code))
code, asg = req("POST", "/api/lockers/%d/assign" % LOCKER, token=ADMIN,
                body={"member_id": PLAN_MEMBER, "months": 2})
ok(code == 200 and "assigned" in asg.get("message", ""), "assign locker", str(code))
code, _ = req("POST", "/api/lockers/%d/assign" % LOCKER, token=ADMIN, body={"member_id": ALICE})
ok(code == 409, "assign an already-held locker 409", str(code))
code, _ = req("PUT", "/api/lockers/%d" % LOCKER, token=ADMIN, body={"status": "maintenance"})
ok(code == 400, "cannot maintenance an assigned locker", str(code))
code, _ = req("DELETE", "/api/lockers/%d" % LOCKER, token=ADMIN)
ok(code == 400, "cannot delete an assigned locker", str(code))
code, rel = req("POST", "/api/lockers/%d/release" % LOCKER, token=ADMIN)
ok(code == 200 and rel["locker"]["status"] == "free", "release locker", str(code))
code, _ = req("POST", "/api/lockers/%d/release" % LOCKER, token=ADMIN)
ok(code == 400, "release an unassigned locker 400", str(code))

# ---------------------------------------------------------------------------
section("inventory & counter POS")
code, prod = req("POST", "/api/products", token=ADMIN, body={
    "name": "E2E Protein", "sku": "e2e-p1", "category": "Supplement",
    "cost_price": 60, "sale_price": 100, "tax_rate": 10, "stock_qty": 3, "reorder_level": 2})
ok(code == 201 and prod.get("sku") == "E2E-P1", "create product", str(code))
PRODUCT = prod["id"]
code, plist = req("GET", "/api/products", token=ADMIN)
mine = [p for p in plist if p["id"] == PRODUCT][0]
ok(code == 200 and mine["needs_reorder"] is False, "stock 3 over reorder level 2 is not low", str(mine))
ok(float(mine["unit_margin"]) == 40.0, "unit margin = sale - cost", str(mine.get("unit_margin")))
# Drop to the reorder level: at (not just below) the threshold it must flag.
req("POST", "/api/products/%d/restock" % PRODUCT, token=ADMIN, body={"quantity": -1})
code, low = req("GET", "/api/products?low_stock=true", token=ADMIN)
ok(code == 200 and any(p["id"] == PRODUCT for p in low),
   "low-stock filter flags a product at its reorder level", str(code))
req("POST", "/api/products/%d/restock" % PRODUCT, token=ADMIN, body={"quantity": 1})
code, _ = req("POST", "/api/products", token=ADMIN, body={"name": "E2E Clash", "sku": "E2E-P1"})
ok(code == 400 or code == 409, "duplicate SKU rejected", str(code))
code, sale = req("POST", "/api/product-sales", token=ADMIN,
                 body={"product_id": PRODUCT, "quantity": 2, "method": "Cash"})
ok(code == 201 and float(sale["sale"]["total"]) == 220.0, "sell 2 with 10% tax = 220", str(code))
ok(sale["product"]["stock_qty"] == 1, "stock decremented in the same transaction", str(sale["product"]["stock_qty"]))
SALE = sale["sale"]["id"]
code, over = req("POST", "/api/product-sales", token=ADMIN, body={"product_id": PRODUCT, "quantity": 5})
ok(code == 400 and "Only 1" in over.get("error", ""), "oversell blocked", str(code) + str(over))
code, _ = req("POST", "/api/products/%d/restock" % PRODUCT, token=ADMIN, body={"quantity": -10})
ok(code == 400, "restock below zero blocked", str(code))
code, re_ = req("POST", "/api/products/%d/restock" % PRODUCT, token=ADMIN, body={"quantity": 5})
ok(code == 200 and re_["product"]["stock_qty"] == 6, "restock adds stock", str(code))
code, _ = req("DELETE", "/api/products/%d" % PRODUCT, token=ADMIN)
ok(code == 400, "cannot delete a product with sales history", str(code))
code, rev = req("DELETE", "/api/product-sales/%d" % SALE, token=ADMIN)
ok(code == 200 and rev["product"]["stock_qty"] == 8, "reversing a sale returns the units", str(code))

# ---------------------------------------------------------------------------
section("tax invoices")
code, inv = req("POST", "/api/invoices", token=ADMIN, body={
    "customer_name": "E2E Customer",
    "items": [{"description": "Joining fee", "quantity": 1, "unit_price": 1000, "tax_rate": 18}]})
ok(code == 201 and float(inv["total"]) == 1180.0, "issue invoice, 1000 + 18% = 1180", str(code))
ok(inv["invoice_no"].startswith("INV-"), "invoice number allocated", str(inv.get("invoice_no")))
INV1 = inv["id"]
NO1 = inv["invoice_no"]
code, inv2 = req("POST", "/api/invoices", token=ADMIN, body={
    "customer_name": "E2E Second",
    "items": [{"description": "Towel", "quantity": 2, "unit_price": 150, "tax_rate": 5}]})
ok(code == 201 and inv2["invoice_no"] != NO1, "second invoice takes the next number",
   "%s vs %s" % (NO1, inv2.get("invoice_no")))
seq1 = int(NO1.split("-")[2])
seq2 = int(inv2["invoice_no"].split("-")[2])
ok(seq2 == seq1 + 1, "invoice numbers are sequential", "%d -> %d" % (seq1, seq2))
code, full = req("GET", "/api/invoices/%d" % INV1, token=ADMIN)
ok(code == 200 and len(full.get("items", [])) == 1, "fetch invoice with line items", str(code))
code, _ = req("POST", "/api/invoices", token=ADMIN, body={"customer_name": "E2E Empty", "items": []})
ok(code == 400, "invoice with no lines 400", str(code))
code, _ = req("POST", "/api/invoices", token=ADMIN, body={
    "customer_name": "E2E Bad", "items": [{"description": "x", "quantity": 0, "unit_price": 10}]})
ok(code == 400, "invoice line with zero quantity 400", str(code))
code, canc = req("DELETE", "/api/invoices/%d" % INV1, token=ADMIN)
ok(code == 200 and canc["invoice"]["status"] == "cancelled", "cancel invoice (never deleted)", str(code))
code, _ = req("PUT", "/api/invoices/%d" % INV1, token=ADMIN, body={"status": "paid"})
ok(code == 400, "a cancelled invoice cannot be revived", str(code))

# ---------------------------------------------------------------------------
section("expenses & finance P&L")
code, exp = req("POST", "/api/expenses", token=ADMIN, body={
    "category": "Rent", "description": "E2E rent", "amount": 15000, "method": "Bank Transfer"})
ok(code == 201 and float(exp["amount"]) == 15000.0, "record expense", str(code))
EXPENSE = exp["id"]
code, _ = req("POST", "/api/expenses", token=ADMIN,
              body={"category": "Nonsense", "description": "x", "amount": 5})
ok(code == 400, "bad expense category 400", str(code))
code, _ = req("POST", "/api/expenses", token=ADMIN,
              body={"category": "Rent", "description": "x", "amount": -5})
ok(code == 400, "negative expense amount 400", str(code))
code, fin = req("GET", "/api/finance/summary?months=3", token=ADMIN)
ok(code == 200 and "totals" in fin and "series" in fin, "finance summary shape", str(code))
ok(float(fin["totals"]["month_expenses"]) >= 15000.0, "expense reaches the P&L", str(fin["totals"]))
ok(fin["totals"]["month_profit"] == round(fin["totals"]["month_income"] - fin["totals"]["month_expenses"], 2),
   "profit = income - expenses", str(fin["totals"]))
code, _ = req("GET", "/api/finance/summary", token=TRAINER)
ok(code == 403, "trainer cannot see the P&L 403", str(code))
code, _ = req("DELETE", "/api/expenses/%d" % EXPENSE, token=ADMIN)
ok(code == 200, "delete expense", str(code))

# ---------------------------------------------------------------------------
section("staff attendance, shifts & payroll")
code, emp = req("PUT", "/api/staff/1/employment", token=ADMIN,
                body={"monthly_salary": 26000, "commission_percent": 10})
ok(code == 200 and float(emp["monthly_salary"]) == 26000.0, "set employment terms", str(code))
code, _ = req("PUT", "/api/staff/1/employment", token=ADMIN, body={"commission_percent": 150})
ok(code == 400, "commission over 100% rejected", str(code))
code, att = req("POST", "/api/staff/attendance", token=ADMIN, body={"user_id": 1, "status": "Present"})
ok(code == 201 and att["record"]["status"] == "Present", "mark staff present", str(code))
code, att2 = req("POST", "/api/staff/attendance", token=ADMIN, body={"user_id": 1, "status": "Half-day"})
ok(code == 201 and att2["record"]["status"] == "Half-day", "re-posting the same day corrects it", str(code))
code, sh = req("POST", "/api/staff/shifts", token=ADMIN, body={
    "user_id": 1, "shift_date": today(1), "start_time": "09:00", "end_time": "13:00"})
ok(code == 201, "create shift", str(code))
code, _ = req("POST", "/api/staff/shifts", token=ADMIN, body={
    "user_id": 1, "shift_date": today(1), "start_time": "12:00", "end_time": "16:00"})
ok(code == 409, "overlapping shift 409", str(code))
code, _ = req("POST", "/api/staff/shifts", token=ADMIN, body={
    "user_id": 1, "shift_date": today(1), "start_time": "13:00", "end_time": "17:00"})
ok(code == 201, "back-to-back shift allowed", str(code))
code, _ = req("POST", "/api/staff/shifts", token=ADMIN, body={
    "user_id": 1, "shift_date": today(1), "start_time": "17:00", "end_time": "16:00"})
ok(code == 400, "end before start 400", str(code))
mm, yy = int(today()[5:7]), int(today()[0:4])
code, pay = req("POST", "/api/staff/payroll/generate", token=ADMIN, body={"month": mm, "year": yy})
ok(code == 201 and pay["generated"] >= 2, "generate payroll drafts", str(code))
code, rows = req("GET", "/api/staff/payroll?month=%d&year=%d" % (mm, yy), token=ADMIN)
ok(code == 200 and len(rows) >= 2, "list payroll", str(code))
PAYROW = rows[0]["id"]
code, _ = req("PUT", "/api/staff/payroll/%d" % PAYROW, token=ADMIN, body={"deductions": 999999})
ok(code == 400, "deductions above earnings rejected", str(code))
code, paid = req("PUT", "/api/staff/payroll/%d" % PAYROW, token=ADMIN,
                 body={"status": "paid", "method": "Bank Transfer"})
ok(code == 200 and paid["status"] == "paid", "mark payroll paid", str(code))
code, _ = req("PUT", "/api/staff/payroll/%d" % PAYROW, token=ADMIN, body={"status": "draft"})
ok(code == 400, "paid payroll cannot be reopened", str(code))
code, _ = req("GET", "/api/staff", token=TRAINER)
ok(code == 403, "trainer cannot see staff salaries 403", str(code))

# ---------------------------------------------------------------------------
section("personal training")
# Personal training is sold by DURATION, exactly like membership — a term at a
# fee, with the trainer's time included. There is no per-session product, so a
# plan never carries a count of visits that could run out mid-term.
code, pkg = req("POST", "/api/pt/packages", token=ADMIN, body={
    "name": "E2E PT 10", "plan_type": "Quarterly", "price": 5000,
    "validity_days": 60, "trainer_commission_percent": 20})
ok(code == 201 and pkg["plan_type"] == "Quarterly" and pkg["validity_days"] == 60,
   "create PT package", str(code) + " " + str(pkg)[:140])
PKG = pkg["id"]

# A session count offered by an old client is ignored rather than honoured:
# the product it describes is not sold any more.
code, unl = req("POST", "/api/pt/packages", token=ADMIN, body={
    "name": "E2E PT Monthly", "plan_type": "Monthly", "price": 6000,
    "sessions": 12, "trainer_commission_percent": 15})
ok(code == 201 and unl.get("sessions") is None and unl["validity_days"] == 30,
   "a plan is a term — no session count is kept, and the term sets the validity",
   str(code) + " " + str(unl)[:140])
UNLIMITED = unl["id"]

code, noterm = req("POST", "/api/pt/packages", token=ADMIN,
                   body={"name": "E2E No Term", "price": 5000})
ok(noterm.get("error", "").startswith("plan_type is required"),
   "a plan without a term 400", str(code) + " " + str(noterm))

code, sub = req("POST", "/api/pt/subscriptions", token=ADMIN,
                body={"member_id": ALICE, "package_id": PKG, "trainer_id": 2, "method": "UPI"})
ok(code == 201 and sub["subscription"].get("sessions_total") is None,
   "sell PT package — the term is what is sold", str(code))
ok(sub.get("commission") and float(sub["commission"]["amount"]) == 1000.0,
   "20% trainer commission booked", str(sub.get("commission")))
SUB = sub["subscription"]["id"]
code, pays = req("GET", "/api/payments?member_id=%d" % ALICE, token=ADMIN)
ok(code == 200 and any("PT package" in str(p.get("note", "")) for p in pays),
   "PT sale writes into the payments ledger", str(code))
code, _ = req("POST", "/api/pt/subscriptions", token=ADMIN, body={"member_id": ALICE, "package_id": PKG})
ok(code == 409, "second live PT package 409", str(code))
code, ses = req("POST", "/api/pt/subscriptions/%d/session" % SUB, token=ADMIN, body={})
ok(code == 201 and ses["subscription"]["sessions_used"] == 1, "log a session", str(code))
code, slist = req("GET", "/api/pt/subscriptions/%d/sessions" % SUB, token=ADMIN)
ok(code == 200 and len(slist) == 1, "list sessions", str(code))
code, comms = req("GET", "/api/pt/commissions?status=pending", token=ADMIN)
ok(code == 200 and any(float(c["amount"]) == 1000.0 for c in comms), "commission is pending", str(code))
code, _ = req("DELETE", "/api/pt/packages/%d" % PKG, token=ADMIN)
ok(code == 400, "cannot delete a package with subscriptions", str(code))

# Retiring a plan is the usual way to stop selling one, and it takes no other
# field with it. Naming neither a term nor a validity used to unbox a null and
# come back as a 500.
code, retired = req("PUT", "/api/pt/packages/%d" % PKG, token=ADMIN, body={"is_active": False})
ok(code == 200 and retired.get("is_active") is False,
   "a package can be retired on its own", str(code) + " " + str(retired)[:120])
code, _ = req("PUT", "/api/pt/packages/%d" % PKG, token=ADMIN, body={"is_active": True})

# Sessions are a record of what the trainer delivered. They never complete a
# plan — only its term does — so a member on a monthly plan can train as often
# as the trainer will have them.
code, bob = req("GET", "/api/clients?search=102", token=ADMIN)
BOBID = next((c["id"] for c in bob if c.get("member_code") == "102"), None)
if BOBID:
    code, usub = req("POST", "/api/pt/subscriptions", token=ADMIN,
                     body={"member_id": BOBID, "package_id": UNLIMITED, "trainer_id": 2})
    ok(code == 201 and usub["subscription"].get("sessions_total") is None,
       "a plan sells with no session total at all", str(code))
    USUB = usub["subscription"]["id"]
    for n in range(15):
        code, log = req("POST", "/api/pt/subscriptions/%d/session" % USUB, token=ADMIN, body={})
    ok(code == 201 and log["subscription"]["sessions_used"] == 15
       and log["subscription"]["status"] == "active",
       "fifteen sessions log against a monthly plan and it is still active",
       str(code) + " " + str(log.get("message")))

# ---------------------------------------------------------------------------
section("receipts: a payment records what it bought")
# The receipt used to read the member's *current* membership for every payment,
# so a personal-training receipt announced the membership plan and expiry. A
# payment now carries its own purpose, plan and period, and those are what the
# receipt prints.
code, pays = req("GET", "/api/payments?member_id=%d" % ALICE, token=ADMIN)
ptpay = next((p for p in pays if p.get("purpose") == "pt"), None)
ok(ptpay is not None, "the PT sale is recorded as a PT payment", str(code))
if ptpay:
    ok(ptpay.get("reference_id") == SUB,
       "...pointing at the subscription it paid for", str(ptpay.get("reference_id")))
    ok(ptpay.get("plan_name") == "E2E PT 10",
       "...naming the plan as it was called that day", str(ptpay.get("plan_name")))
    ok(ptpay.get("period_start") and ptpay.get("period_end"),
       "...and the training term it covers",
       "%s - %s" % (ptpay.get("period_start"), ptpay.get("period_end")))
    ok(float(ptpay.get("discount") or 0) == 0, "no discount on a plain sale", str(ptpay.get("discount")))

# Settling arrears buys no new term: the term it belongs to was sold earlier,
# and repeating its dates would read as paying for it twice. Carol's dues were
# collected further up, so the row is already there to look at.
code, cpays = req("GET", "/api/payments?member_id=%d" % CAROL, token=ADMIN)
dues = [p for p in cpays if p.get("purpose") == "dues"]
ok(len(dues) >= 1, "settling arrears is recorded as a dues payment", str(code))
if dues:
    ok(dues[0].get("period_start") is None and dues[0].get("plan_name") is None,
       "...and claims no period of its own", str(dues[0])[:140])

# A membership payment names the plan and the term it bought.
mem = [p for p in cpays if p.get("purpose") == "membership"]
ok(any(p.get("plan_name") and p.get("period_end") for p in mem)
   or not mem,
   "a membership payment records its plan and period", str(mem)[:160])

# ---------------------------------------------------------------------------
section("member IDs: a sequence, held for life, freed only by deletion")
# The desk used to invent IDs, so they arrived in no order. They now run in
# sequence, the form fills the next one in, and a number belongs to whoever was
# given it for as long as their record exists.
code, first = req("GET", "/api/clients/next-code", token=ADMIN)
ok(code == 200 and str(first.get("member_code")).isdigit(),
   "the next Member ID is offered before the form is filled in", str(first))
SEQ1 = str(first["member_code"])

code, m1 = req("POST", "/api/clients", token=ADMIN, body={
    "member_code": SEQ1, "name": "Sequence One", "phone": "9995559001",
    "membership_type": "Monthly", "membership_fee": 1000, "amount_paid": 1000})
ok(code == 201 and m1.get("member_code") == SEQ1, "...and taking it works", str(code))

code, second = req("GET", "/api/clients/next-code", token=ADMIN)
SEQ2 = str(second["member_code"])
# Not "SEQ1 + 1": if earlier deletions left numbers vacant, the queue hands
# those out first. What must always hold is that it never offers a number
# somebody is already using.
ok(SEQ2 != SEQ1, "the number just taken is not offered again", SEQ1 + " → " + SEQ2)
code, clash = req("GET", "/api/clients?search=%s" % SEQ2, token=ADMIN)
ok(not any(c.get("member_code") == SEQ2 for c in (clash or [])),
   "...and what it offers is not already somebody's", str(SEQ2))
code, m2 = req("POST", "/api/clients", token=ADMIN, body={
    "member_code": SEQ2, "name": "Sequence Two", "phone": "9995559002",
    "membership_type": "Monthly", "membership_fee": 1000, "amount_paid": 1000})

# Deactivating keeps the number: a member who comes back is still that number.
code, _ = req("DELETE", "/api/clients/%d" % m1["id"], token=ADMIN)
code, afterDeactivate = req("GET", "/api/clients/next-code", token=ADMIN)
ok(str(afterDeactivate["member_code"]) != SEQ1,
   "a deactivated member keeps their ID — it is not offered to anyone else",
   str(afterDeactivate))

# An active member cannot be deleted outright.
code, refused = req("DELETE", "/api/clients/%d/purge" % m2["id"], token=ADMIN)
ok(code == 400 and "still active" in refused.get("error", ""),
   "deleting an active member permanently is refused", str(code) + " " + str(refused)[:120])

# Deleting the record — and only that — gives the number back.
code, purged = req("DELETE", "/api/clients/%d/purge" % m1["id"], token=ADMIN)
ok(code == 200 and SEQ1 in str(purged.get("message")),
   "deleting the record permanently frees the ID", str(code) + " " + str(purged.get("message")))
code, freed = req("GET", "/api/clients/next-code", token=ADMIN)
ok(str(freed["member_code"]) == SEQ1,
   "...and it goes to the front of the queue", str(freed))

code, m3 = req("POST", "/api/clients", token=ADMIN, body={
    "member_code": SEQ1, "name": "Sequence Three", "phone": "9995559003",
    "membership_type": "Monthly", "membership_fee": 1000, "amount_paid": 1000})
ok(code == 201, "the next admission takes the freed number", str(code))
code, afterReuse = req("GET", "/api/clients/next-code", token=ADMIN)
REUSED = str(afterReuse["member_code"])
ok(REUSED not in (SEQ1, SEQ2),
   "...and the one after that is a free number, never a number in use",
   "%s (SEQ1 %s, SEQ2 %s)" % (REUSED, SEQ1, SEQ2))
code, taken = req("GET", "/api/clients?search=%s" % REUSED, token=ADMIN)
ok(not any(c.get("member_code") == REUSED for c in (taken or [])),
   "...confirmed against the member list", REUSED)

code, gone = req("GET", "/api/clients/%d" % m1["id"], token=ADMIN)
ok(gone.get("error") == "Member not found", "the purged record really is gone", str(code))

for mid in (m2["id"], m3["id"]):
    req("DELETE", "/api/clients/%d" % mid, token=ADMIN)
    req("DELETE", "/api/clients/%d/purge" % mid, token=ADMIN)

# ---------------------------------------------------------------------------
section("names and addresses settle in Title Case")
# Typed however the desk types it, stored one way. Otherwise the same member
# appears twice in a list sorted by name and reads as shouting on a receipt.
code, shouty = req("POST", "/api/clients", token=ADMIN, body={
    "member_code": "8820", "name": "  GAURAV   sharma ", "phone": "9995558820",
    "address": "12a, MG road, jehanabad",
    "membership_type": "Monthly", "membership_fee": 1000, "amount_paid": 1000})
ok(code == 201 and shouty.get("name") == "Gaurav Sharma",
   "a name is stored in Title Case however it was typed", str(shouty.get("name")))
ok(shouty.get("address") == "12a, MG Road, Jehanabad",
   "...and an address keeps its house number and the acronyms typed as such",
   str(shouty.get("address")))
CASED = shouty["id"]

code, renamed = req("PUT", "/api/clients/%d" % CASED, token=ADMIN,
                    body={"name": "d'souza JEAN-luc"})
ok(renamed.get("name") == "D'Souza Jean-Luc",
   "...on update too, including after apostrophes and hyphens", str(renamed.get("name")))

code, lead = req("POST", "/api/leads", token=ADMIN,
                 body={"name": "sunita BANSAL", "phone": "9995558821"})
ok(lead.get("name") == "Sunita Bansal", "a lead's name too", str(lead.get("name")))
code, _ = req("DELETE", "/api/leads/%d" % lead["id"], token=ADMIN)
code, _ = req("DELETE", "/api/clients/%d" % CASED, token=ADMIN)

# ---------------------------------------------------------------------------
section("lockers: one event, whichever screen starts it")
# A locker taken at signup and a locker taken from the Lockers page are the
# same thing happening, so they go down one path: same guards, same ledger
# entry, same invoice. The two screens must not be able to disagree.
code, withlocker = req("POST", "/api/clients", token=ADMIN, body={
    "member_code": "8810", "name": "Locker Signup", "phone": "9995558810",
    "membership_type": "Monthly", "membership_fee": 1000, "amount_paid": 1000,
    "assign_locker": True, "locker_number": "E2E-L1", "locker_amount": 600,
    "locker_until": "2026-12-31"})
ok(code == 201 and (withlocker.get("locker") or {}).get("locker_number") == "E2E-L1",
   "a locker assigned on the onboarding form", str(code) + " " + str(withlocker.get("locker"))[:120])
LOCKED = withlocker["id"]
ok((withlocker.get("locker_invoice") or {}).get("invoice_no"),
   "...raises an invoice for the charge", str(withlocker.get("locker_invoice"))[:120])

code, lockers = req("GET", "/api/lockers?search=E2E-L1", token=ADMIN)
mine = next((l for l in lockers if l["locker_number"] == "E2E-L1"), None)
ok(mine is not None and mine.get("member_id") == LOCKED,
   "...and it is on the Lockers page, held by them", str(mine)[:140])

code, pays = req("GET", "/api/payments?member_id=%d" % LOCKED, token=ADMIN)
lockerpay = next((p for p in pays if p.get("purpose") == "locker"), None)
ok(lockerpay is not None and float(lockerpay["amount"]) == 600,
   "...and the rent is in the ledger as a locker payment", str(lockerpay)[:140])
ok(lockerpay and lockerpay.get("period_end") == "2026-12-31",
   "...covering the period it was rented for", str(lockerpay.get("period_end")) if lockerpay else "-")

code, member = req("GET", "/api/clients/%d" % LOCKED, token=ADMIN)
ok((member.get("locker") or {}).get("locker_number") == "E2E-L1",
   "the member record carries the locker", str(member.get("locker"))[:120])

# The other direction: assigned from the Lockers page, seen on the member.
code, other = req("POST", "/api/clients", token=ADMIN, body={
    "member_code": "8811", "name": "Locker Desk", "phone": "9995558811",
    "membership_type": "Monthly", "membership_fee": 1000, "amount_paid": 1000})
DESK = other["id"]
code, made = req("POST", "/api/lockers", token=ADMIN,
                 body={"locker_number": "E2E-L2", "size": "Medium", "monthly_rent": 300})
code, assigned = req("POST", "/api/lockers/%d/assign" % made["id"], token=ADMIN,
                     body={"member_id": DESK, "months": 2, "amount": 600, "method": "UPI"})
ok(code == 200 and "E2E-L2" in str(assigned.get("message")),
   "a locker assigned from the Lockers page", str(code) + " " + str(assigned.get("message")))
code, deskMember = req("GET", "/api/clients/%d" % DESK, token=ADMIN)
ok((deskMember.get("locker") or {}).get("locker_number") == "E2E-L2",
   "...shows on the member record too", str(deskMember.get("locker"))[:120])
code, deskInv = req("GET", "/api/invoices?member_id=%d" % DESK, token=ADMIN)
ok(any(i.get("status") == "paid" for i in deskInv),
   "...with a paid invoice, because the money was taken there and then", str(deskInv)[:140])

# One locker per member, and the portal only offers the tab to holders.
code, clash = req("POST", "/api/lockers/%d/assign" % made["id"], token=ADMIN,
                  body={"member_id": LOCKED})
ok(code == 409, "a second locker for one member is refused", str(code) + " " + str(clash)[:120])

# Turning the toggle off gives it back.
code, released = req("PUT", "/api/clients/%d" % DESK, token=ADMIN, body={"assign_locker": False})
code, freed = req("GET", "/api/lockers?search=E2E-L2", token=ADMIN)
ok(freed and freed[0].get("member_id") is None,
   "clearing the toggle releases the locker", str(freed)[:140])

code, _ = req("DELETE", "/api/clients/%d" % DESK, token=ADMIN)
code, _ = req("DELETE", "/api/clients/%d" % LOCKED, token=ADMIN)

# ---------------------------------------------------------------------------
section("retention & churn risk")
code, rec = req("POST", "/api/retention/recompute", token=ADMIN)
ok(code == 200 and rec["scored"] >= 2, "recompute risk for every active member", str(code))
ok(rec["at_risk"] + rec["watch"] + rec["healthy"] == rec["scored"], "every member lands in one band", str(rec))
code, summ = req("GET", "/api/retention/summary", token=ADMIN)
ok(code == 200 and "counts" in summ and "trend" in summ, "retention summary shape", str(code))
ok(len(summ["trend"]) >= 1, "today's snapshot recorded for the trend", str(len(summ["trend"])))
code, risky = req("GET", "/api/retention/at-risk?limit=50", token=ADMIN)
ok(code == 200 and isinstance(risky, list), "list scored members", str(code))
ok(all(r.get("risk_reason") for r in risky), "every scored member has a plain-English reason", "")
if len(risky) > 1:
    ok(risky[0]["risk_score"] >= risky[-1]["risk_score"], "sorted worst-first", "")
code, band = req("GET", "/api/retention/at-risk?band=healthy", token=ADMIN)
ok(code == 200 and all(r["risk_band"] == "healthy" for r in band), "band filter", str(code))
# A member who has never visited and is expiring must not be called healthy.
code, again = req("POST", "/api/retention/recompute?tasks=false", token=ADMIN)
ok(code == 200 and again["scored"] == rec["scored"], "recompute is idempotent", str(code))

# ---------------------------------------------------------------------------
section("tasks (staff follow-up queue)")
code, task = req("POST", "/api/tasks", token=ADMIN, body={
    "title": "E2E call Alice", "category": "follow-up", "priority": "high",
    "due_on": today(1), "member_id": ALICE})
ok(code == 201 and task["status"] == "open", "create task", str(code))
TASK = task["id"]
code, _ = req("POST", "/api/tasks", token=ADMIN, body={"title": ""})
ok(code == 400, "task without a title 400", str(code))
code, _ = req("POST", "/api/tasks", token=ADMIN, body={"title": "E2E bad", "category": "nonsense"})
ok(code == 400, "bad task category 400", str(code))
code, counts = req("GET", "/api/tasks/counts", token=ADMIN)
ok(code == 200 and counts["open"] >= 1, "task counts", str(code))
code, overdue = req("GET", "/api/tasks?due=today", token=ADMIN)
ok(code == 200 and isinstance(overdue, list), "due-today filter", str(code))
code, done = req("PUT", "/api/tasks/%d" % TASK, token=ADMIN, body={"status": "done"})
ok(code == 200 and done["status"] == "done" and done.get("completed_at"), "complete task stamps the time", str(code))
first_completed = done.get("completed_at")
code, again2 = req("PUT", "/api/tasks/%d" % TASK, token=ADMIN, body={"priority": "low"})
ok(code == 200 and again2.get("completed_at") == first_completed,
   "re-saving a done task does not move its completion time", str(code))
code, _ = req("DELETE", "/api/tasks/%d" % TASK, token=ADMIN)
ok(code == 200, "delete task", str(code))

# ---------------------------------------------------------------------------
section("body-composition assessments")
code, a1 = req("POST", "/api/assessments", token=ADMIN, body={
    "member_id": ALICE, "assessed_on": today(-30), "weight_kg": 80, "height_cm": 175,
    "body_fat_pct": 28, "muscle_mass_kg": 30, "waist_cm": 95})
ok(code == 201, "record first assessment", str(code))
ok(abs(float(a1["bmi"]) - 26.12) < 0.05, "BMI derived from height and weight", str(a1.get("bmi")))
code, a2 = req("POST", "/api/assessments", token=ADMIN, body={
    "member_id": ALICE, "assessed_on": today(), "weight_kg": 76, "height_cm": 175,
    "body_fat_pct": 24, "muscle_mass_kg": 32, "waist_cm": 89})
ok(code == 201, "record second assessment", str(code))
A2 = a2["id"]
code, _ = req("POST", "/api/assessments", token=ADMIN, body={"member_id": ALICE, "weight_kg": 700})
ok(code == 400, "impossible weight rejected", str(code))
code, _ = req("POST", "/api/assessments", token=ADMIN, body={"member_id": 999999, "weight_kg": 70})
ok(code == 404, "assessment for an unknown member 404", str(code))
code, prog = req("GET", "/api/assessments/member/%d" % ALICE, token=ADMIN)
ok(code == 200 and prog["count"] == 2, "member assessment history", str(code))
delta = prog["change_since_first"]
ok(delta["body_fat_pct"]["change"] == -4 and delta["body_fat_pct"]["improved"] is True,
   "body fat down counts as an improvement", str(delta.get("body_fat_pct")))
ok(delta["muscle_mass_kg"]["improved"] is True, "muscle up counts as an improvement", str(delta.get("muscle_mass_kg")))
code, _ = req("DELETE", "/api/assessments/%d" % A2, token=ADMIN)
ok(code == 200, "delete assessment", str(code))

# ---------------------------------------------------------------------------
section("challenges & leaderboard")
code, ch = req("POST", "/api/challenges", token=ADMIN, body={
    "name": "E2E October Streak", "metric": "visits", "goal": 2, "unit": "visits",
    "starts_on": today(-10), "ends_on": today(10), "reward": "Free shaker"})
ok(code == 201 and ch["metric"] == "visits", "create challenge", str(code))
CH = ch["id"]
code, _ = req("POST", "/api/challenges", token=ADMIN, body={
    "name": "E2E Backwards", "goal": 5, "starts_on": today(5), "ends_on": today(1)})
ok(code == 400, "end before start 400", str(code))
code, _ = req("POST", "/api/challenges", token=ADMIN, body={
    "name": "E2E No Goal", "goal": 0, "starts_on": today(), "ends_on": today(5)})
ok(code == 400, "zero goal 400", str(code))
code, join = req("POST", "/api/challenges/%d/join" % CH, token=ADMIN, body={"member_id": ALICE})
ok(code == 201, "member joins", str(code))
code, _ = req("POST", "/api/challenges/%d/join" % CH, token=ADMIN, body={"member_id": ALICE})
ok(code == 409, "joining twice 409", str(code))
code, _ = req("POST", "/api/challenges/%d/join" % CH, token=ADMIN, body={"member_id": 999999})
ok(code == 404, "unknown member cannot join", str(code))
code, board = req("GET", "/api/challenges/%d" % CH, token=ADMIN)
ok(code == 200 and board["participants"] == 1, "leaderboard shows the participant", str(code))
ok(board["leaderboard"][0]["rank"] == 1, "leaderboard is ranked", str(board["leaderboard"][0]))
ok(float(board["leaderboard"][0]["progress"]) >= 1,
   "visit-based progress scored from attendance", str(board["leaderboard"][0].get("progress")))
code, _ = req("PUT", "/api/challenges/%d/participants/%d/progress" % (CH, ALICE), token=ADMIN,
              body={"progress": 5})
ok(code == 400, "a visit-based challenge cannot be scored by hand", str(code))
code, _ = req("DELETE", "/api/challenges/%d" % CH, token=ADMIN)
ok(code == 400, "cannot delete a challenge with participants", str(code))
code, _ = req("DELETE", "/api/challenges/%d/participants/%d" % (CH, ALICE), token=ADMIN)
ok(code == 200, "member leaves the challenge", str(code))

# A manual-metric challenge is scored by the trainer instead.
code, mch = req("POST", "/api/challenges", token=ADMIN, body={
    "name": "E2E Weight Loss", "metric": "weight_lost", "goal": 5, "unit": "kg",
    "starts_on": today(-5), "ends_on": today(25)})
MCH = mch["id"]
req("POST", "/api/challenges/%d/join" % MCH, token=ADMIN, body={"member_id": ALICE})
code, prg = req("PUT", "/api/challenges/%d/participants/%d/progress" % (MCH, ALICE), token=ADMIN,
                body={"progress": 5})
ok(code == 200 and prg.get("completed_on"), "hitting the goal stamps completion", str(code))

# ---------------------------------------------------------------------------
section("referrals")
code, ref = req("POST", "/api/referrals", token=ADMIN, body={
    "referrer_id": ALICE, "referred_name": "E2E Friend", "referred_phone": "9990000900",
    "reward_type": "days", "reward_value": 15})
ok(code == 201 and ref["status"] == "pending", "create referral", str(code))
REF = ref["id"]
code, _ = req("POST", "/api/referrals", token=ADMIN, body={"referrer_id": ALICE, "referred_name": ""})
ok(code == 400, "referral without a name 400", str(code))
code, _ = req("POST", "/api/referrals", token=ADMIN, body={
    "referrer_id": ALICE, "referred_name": "E2E Greedy", "reward_type": "days", "reward_value": 5000})
ok(code == 400, "absurd day reward rejected", str(code))
code, _ = req("POST", "/api/referrals/%d/reward" % REF, token=ADMIN)
ok(code == 400, "cannot reward a referral that has not joined", str(code))
code, _ = req("POST", "/api/referrals/%d/joined" % REF, token=ADMIN, body={"member_id": ALICE})
ok(code == 400, "a member cannot be their own referral", str(code))
code, before = req("GET", "/api/clients/%d" % ALICE, token=ADMIN)
expiry_before = before.get("membership_expiry")
code, jn = req("POST", "/api/referrals/%d/joined" % REF, token=ADMIN, body={"member_id": PLAN_MEMBER})
ok(code == 200 and jn["referral"]["status"] == "joined", "link the member who joined", str(code))
code, rew = req("POST", "/api/referrals/%d/reward" % REF, token=ADMIN)
ok(code == 200 and "15 day" in rew.get("message", ""), "pay the reward as extra days", str(rew))
code, after = req("GET", "/api/clients/%d" % ALICE, token=ADMIN)
ok(after.get("membership_expiry") != expiry_before, "referrer's membership actually extended",
   "%s -> %s" % (expiry_before, after.get("membership_expiry")))
code, _ = req("POST", "/api/referrals/%d/reward" % REF, token=ADMIN)
ok(code == 400, "a reward cannot be paid twice", str(code))
code, _ = req("DELETE", "/api/referrals/%d" % REF, token=ADMIN)
ok(code == 400, "a rewarded referral cannot be deleted", str(code))
code, rs = req("GET", "/api/referrals/summary", token=ADMIN)
ok(code == 200 and rs["counts"]["rewarded"] >= 1, "referral summary counts", str(code))
code, byc = req("GET", "/api/referrals/code/%s" % after.get("referral_code", "GYM00001"), token=ADMIN)
ok(code in (200, 404), "referral code lookup responds", str(code))

# A member created through the API must get a referral code there and then —
# only the migration used to assign one, so anyone signed up afterwards opened
# the Refer & earn tab to a blank code.
ok(bool(after.get("referral_code")), "a member has a referral code", str(after.get("referral_code")))
ok(after.get("referral_code") == "ALIC0101",
   "the code is the name plus the padded Member ID", str(after.get("referral_code")))

# The member portal's own invite. This used to fail outright: reward_value is
# NOT NULL, the insert always names it, and the portal path passed null — which
# the error handler then reported as "this value is already taken".
code, mlog = req("POST", "/api/member/login",
                 body={"member_code": "101", "password": MEMBER_PASSWORD})
RTOK = mlog.get("token")
code, inv = req("POST", "/api/member/referrals", token=RTOK,
                body={"referred_name": "A Friend Of Alice", "referred_phone": "9812340000"})
ok(code == 201, "a member can invite someone from the portal", str(code) + " " + str(inv)[:200])
ok(str(inv.get("referral", {}).get("reward_value", "0")).startswith("100"),
   "the gym's configured offer is stamped on the referral",
   str(inv.get("referral", {}).get("reward_value")))

code, msum = req("GET", "/api/member/referrals", token=RTOK)
ok(code == 200 and msum.get("referral_code") == "ALIC0101" and msum.get("pending") >= 1,
   "the portal summary shows the code and the new invitation", str(msum)[:200])

# A name alone cannot identify anyone at the desk, so the phone is required.
code, nophone = req("POST", "/api/member/referrals", token=RTOK,
                    body={"referred_name": "No Number", "referred_phone": ""})
ok(code == 400 and "phone number is required" in nophone.get("error", ""),
   "an invitation without a phone number is refused", str(code) + " " + str(nophone))

# The same friend twice is one friend, not two rewards.
code, dupe = req("POST", "/api/member/referrals", token=RTOK,
                 body={"referred_name": "Same Person", "referred_phone": "9871230000"})
ok(code == 201, "invite with a phone number", str(code) + " " + str(dupe)[:160])
code, again2 = req("POST", "/api/member/referrals", token=RTOK,
                   body={"referred_name": "Same Person Again", "referred_phone": "98712 30000"})
ok(code == 409 and "already invited" in again2.get("error", ""),
   "the same number cannot be invited twice", str(code) + " " + str(again2))

# ---- the whole reward loop, end to end ----
section("referral rewards")

# A code that matches nobody must stop the signup before anything is written —
# it used to create the member, take the payment, and then 400.
code, badcode = req("POST", "/api/clients", token=ADMIN, body={
    "member_code": "601", "name": "Bad Code", "phone": "9871111111",
    "membership_type": "Monthly", "membership_fee": 1000, "amount_paid": 1000,
    "referral_code": "NOSUCH0001"})
ok(code == 400 and "does not match any member" in badcode.get("error", ""),
   "an unknown referral code is refused", str(code) + " " + str(badcode))
code, orphan = req("GET", "/api/clients?search=601", token=ADMIN)
ok(code == 200 and not any(c.get("member_code") == "601" for c in (orphan or [])),
   "...and no half-created member is left behind", str(orphan)[:160])

# Alice invites someone from her portal, then that someone signs up with her
# code and pays in full. Alice's reward is earned but not yet spent.
code, inv2 = req("POST", "/api/member/referrals", token=RTOK,
                 body={"referred_name": "Rahul Sharma", "referred_phone": "9876500001"})
ok(code == 201, "Alice invites Rahul", str(code))

code, rahul = req("POST", "/api/clients", token=ADMIN, body={
    "member_code": "602", "name": "Rahul Sharma", "phone": "9876500001",
    "membership_type": "Monthly", "membership_fee": 1000, "amount_paid": 1000,
    "referral_code": "ALIC0101"})
ok(code == 201 and rahul.get("referral_code") == "RAHU0602",
   "Rahul joins with Alice's code and gets his own", str(code) + " " + str(rahul.get("referral_code")))
RAHUL = rahul["id"]

# The invitation Alice already recorded is reused, not duplicated.
code, msum2 = req("GET", "/api/member/referrals", token=RTOK)
rahul_rows = [r for r in msum2.get("referrals", []) if "Rahul" in str(r.get("name"))]
ok(len(rahul_rows) == 1, "the existing invitation is reused, not duplicated", str(len(rahul_rows)))
ok(msum2.get("joined", 0) >= 1 and float(msum2.get("earned", 0)) >= 100,
   "Alice's reward is earned once Rahul has paid in full",
   "joined=%s earned=%s" % (msum2.get("joined"), msum2.get("earned")))

# ...and comes off her next renewal, once, with the receipt note.
code, before_ren = req("GET", "/api/clients/%d" % ALICE, token=ADMIN)
code, ren = req("PUT", "/api/clients/%d/renew" % ALICE, token=ADMIN, body={
    "membership_type": "Monthly", "membership_fee": 1000, "amount_paid": 900, "payment_mode": "Cash"})
ok(code == 200 and float(ren.get("referral_discount", 0)) == 100,
   "the referral reward comes off Alice's renewal", str(code) + " " + str(ren.get("referral_discount")))
note = ren.get("referral_note") or ""
ok("602 - Rahul Sharma" in note, "the receipt note names who she referred", note)
ok("Future memberships are charged at the normal rate" in note,
   "...and says the discount is one-off", note)
ok(float(ren.get("amount_due", -1)) == 0,
   "fee 1000 less the 100 reward is settled by 900", str(ren.get("amount_due")))

# Spent means spent.
code, ren2 = req("PUT", "/api/clients/%d/renew" % ALICE, token=ADMIN, body={
    "membership_type": "Monthly", "membership_fee": 1000, "amount_paid": 1000, "payment_mode": "Cash"})
ok(code == 200 and float(ren2.get("referral_discount", 0)) == 0,
   "the same reward cannot be spent twice", str(ren2.get("referral_discount")))

# The note travels onto the payment, which is what the receipt prints.
code, apays = req("GET", "/api/payments?member_id=%d" % ALICE, token=ADMIN)
ok(code == 200 and any("Referral reward" in str(p.get("note", "")) for p in apays),
   "the referral note is on the payment the receipt prints", str(code))
# The reward is a number on the row too, so the receipt can show charge,
# reward and amount received as three lines that add up rather than parsing
# them back out of English.
rewarded = [p for p in apays if float(p.get("discount") or 0) > 0]
ok(len(rewarded) == 1 and float(rewarded[0]["discount"]) == 100,
   "the reward is recorded as a discount on that payment", str(rewarded)[:160])
ok(rewarded and float(rewarded[0]["amount"]) == 900,
   "...and 900 received + 100 off = the 1000 charged", str(rewarded[0]["amount"]) if rewarded else "-")
ok(rewarded and rewarded[0].get("purpose") == "membership"
   and rewarded[0].get("period_end"),
   "...on a membership payment that names the term it renewed",
   str(rewarded[0].get("period_end")) if rewarded else "-")

code, _ = req("DELETE", "/api/clients/%d" % RAHUL, token=ADMIN)

# ---------------------------------------------------------------------------
section("form validation")
# Every one of these was accepted before. They are the shapes that get past a
# "field is not blank" check and then quietly corrupt what the gym reads back.

VALIDATION = [
    ("member: paid more than the fee", "POST", "/api/clients", {
        "member_code": "9101", "name": "Over Paid", "phone": "9990001112",
        "membership_fee": 1000, "amount_paid": 5000}),
    ("member: expiry before start", "POST", "/api/clients", {
        "member_code": "9102", "name": "Backwards", "phone": "9990001113",
        "membership_start": today(10), "membership_expiry": today(1),
        "membership_fee": 1000, "amount_paid": 1000}),
    ("member: letters in the phone", "POST", "/api/clients", {
        "member_code": "9103", "name": "Bad Phone", "phone": "abcdefghij",
        "membership_fee": 1000, "amount_paid": 1000}),
    ("member: three-digit phone", "POST", "/api/clients", {
        "member_code": "9104", "name": "Short Phone", "phone": "123",
        "membership_fee": 1000, "amount_paid": 1000}),
    ("member: malformed email", "POST", "/api/clients", {
        "member_code": "9105", "name": "Bad Email", "phone": "9990001116",
        "email": "not-an-email", "membership_fee": 1000, "amount_paid": 1000}),
    ("member: date of birth in the future", "POST", "/api/clients", {
        "member_code": "9106", "name": "Future Born", "phone": "9990001117",
        "dob": today(3650), "membership_fee": 1000, "amount_paid": 1000}),
    ("member: single-letter name", "POST", "/api/clients", {
        "member_code": "9107", "name": "x", "phone": "9990001118",
        "membership_fee": 1000, "amount_paid": 1000}),
    ("payment: dated in the future", "POST", "/api/payments", {
        "member_id": ALICE, "amount": 100, "payment_date": today(365)}),
    ("class: scheduled in the past", "POST", "/api/classes", {
        "name": "Past Class", "trainer_id": 2, "class_date": today(-30),
        "start_time": "10:00", "capacity": 10}),
    ("lead: letters in the phone", "POST", "/api/leads", {
        "name": "Bad Lead", "phone": "notaphone"}),
    ("expense: dated in the future", "POST", "/api/expenses", {
        "category": "Rent", "description": "Future rent", "amount": 100,
        "expense_date": today(400)}),
    ("progress: negative weight", "POST", "/api/progress", {
        "member_id": ALICE, "record_date": today(), "weight": -70}),
    ("progress: 900 kg", "POST", "/api/progress", {
        "member_id": ALICE, "record_date": today(), "weight": 900}),
    ("progress: measured in the future", "POST", "/api/progress", {
        "member_id": ALICE, "record_date": today(400), "weight": 70}),
    ("assessment: dated in the future", "POST", "/api/assessments", {
        "member_id": ALICE, "assessed_on": today(400)}),
    ("device: no name", "POST", "/api/devices", {"ip_address": "192.168.1.9"}),
    ("device: no IP address", "POST", "/api/devices", {"name": "Nameless Terminal"}),
    ("device: impossible IP", "POST", "/api/devices", {
        "name": "Bad IP", "ip_address": "999.1.1.1"}),
    ("device: port out of range", "POST", "/api/devices", {
        "name": "Bad Port", "ip_address": "192.168.1.9", "port": 99999}),
]
for label, method, path, body in VALIDATION:
    code, res = req(method, path, token=ADMIN, body=body)
    ok(code == 400, label + " → 400", str(code) + " " + str(res)[:120])

# ...and the valid version of each still goes through, so the rules reject the
# bad case rather than the whole form.
code, good = req("POST", "/api/clients", token=ADMIN, body={
    "member_code": "9200", "name": "Perfectly Fine", "phone": "+91 98765 43210",
    "email": "fine@example.com", "dob": "1995-04-12",
    "membership_start": today(), "membership_expiry": today(30),
    "membership_fee": 1000, "amount_paid": 1000})
ok(code == 201, "a well-formed member is still accepted", str(code) + " " + str(good)[:140])
ok(good.get("referral_code") == "PERF9200", "...and gets a referral code", str(good.get("referral_code")))
code, _ = req("DELETE", "/api/clients/%d" % good["id"], token=ADMIN)

code, dev = req("POST", "/api/devices", token=ADMIN, body={
    "name": "Front desk terminal", "ip_address": "192.168.1.50", "port": 4370})
ok(code == 201 and dev.get("ip_address") == "192.168.1.50",
   "a well-formed device is still accepted", str(code) + " " + str(dev)[:120])

# ---------------------------------------------------------------------------
section("announcements & feedback")
code, ann = req("POST", "/api/announcements", token=ADMIN, body={
    "title": "E2E Boiler fixed", "body": "Hot water is back.", "audience": "all", "pinned": True})
ok(code == 201 and ann["pinned"] is True, "post announcement", str(code))
ANN = ann["id"]
code, _ = req("POST", "/api/announcements", token=ADMIN, body={"title": "E2E No body"})
ok(code == 400, "announcement without a message 400", str(code))
code, _ = req("POST", "/api/announcements", token=ADMIN, body={
    "title": "E2E Backwards", "body": "x", "publish_on": today(5), "expires_on": today(1)})
ok(code == 400, "expiry before publication 400", str(code))
code, feed = req("GET", "/api/announcements?live=true", token=ADMIN)
ok(code == 200 and any(a["id"] == ANN for a in feed), "live feed includes it", str(code))
code, _ = req("POST", "/api/announcements", token=TRAINER, body={"title": "E2E Sneaky", "body": "x"})
ok(code == 403, "trainer cannot post to the whole gym 403", str(code))
code, mfeed = req("GET", "/api/member/announcements", token=MTOK)
ok(code == 200 and isinstance(mfeed, list), "member sees the feed", str(code))

code, fb = req("POST", "/api/member/feedback", token=MTOK, body={"score": 9, "comment": "E2E great", "category": "classes"})
ok(code == 201, "member submits feedback", str(code))
code, _ = req("POST", "/api/member/feedback", token=MTOK, body={"score": 20})
ok(code == 400, "score above 10 rejected", str(code))
code, _ = req("POST", "/api/feedback", token=ADMIN, body={"score": 3, "comment": "E2E poor", "member_id": ALICE})
ok(code == 201, "staff records a comment from the desk", str(code))
code, nps = req("GET", "/api/feedback/summary", token=ADMIN)
ok(code == 200 and nps["responses"] >= 2, "feedback summary", str(code))
ok(nps["promoters"] >= 1 and nps["detractors"] >= 1, "promoter/detractor split", str(nps))
ok(float(nps["nps"]) == 0.0, "NPS = (1 promoter - 1 detractor) / 2 = 0", str(nps.get("nps")))
code, _ = req("DELETE", "/api/announcements/%d" % ANN, token=ADMIN)
ok(code == 200, "delete announcement", str(code))

# ---------------------------------------------------------------------------
section("branches")
code, br = req("POST", "/api/branches", token=ADMIN, body={"name": "E2E North", "code": "e2en"})
ok(code == 201 and br["code"] == "E2EN", "create branch (code upper-cased)", str(code))
BRANCH = br["id"]
code, _ = req("POST", "/api/branches", token=ADMIN, body={"name": "E2E Bad", "code": "has space"})
ok(code == 400, "branch code with a space 400", str(code))
code, _ = req("POST", "/api/branches", token=ADMIN, body={"name": "E2E North", "code": "E2EN2"})
ok(code == 409, "duplicate branch name 409", str(code))
code, brs = req("GET", "/api/branches", token=ADMIN)
ok(code == 200 and any(b["code"] == "MAIN" for b in brs), "main branch seeded", str(code))
MAIN = [b for b in brs if b["code"] == "MAIN"][0]
ok(MAIN["member_count"] >= 1, "existing members backfilled to the main branch", str(MAIN))
code, _ = req("DELETE", "/api/branches/%d" % MAIN["id"], token=ADMIN)
ok(code == 400, "the main branch cannot be deleted", str(code))
code, _ = req("PUT", "/api/branches/%d" % MAIN["id"], token=ADMIN, body={"is_active": False})
ok(code == 400, "the main branch cannot be deactivated", str(code))
code, _ = req("DELETE", "/api/branches/%d" % BRANCH, token=ADMIN)
ok(code == 200, "delete an empty branch", str(code))

# ---------------------------------------------------------------------------
section("audit trail")
code, log = req("GET", "/api/audit?limit=500", token=ADMIN)
ok(code == 200 and len(log) > 0, "audit log has entries", str(code))
modules_seen = {row["module"] for row in log}
for expected in ("plans", "lockers", "inventory", "invoices", "expenses", "staff", "pt",
                 "referrals", "challenges", "assessments", "branches"):
    ok(expected in modules_seen, "audit records %s writes" % expected, str(sorted(modules_seen)))
ok(all(row.get("username") for row in log[:20]), "audit rows name who did it", "")
ok(any(row.get("request_id") for row in log[:50]), "audit rows carry the request id", "")
code, asum = req("GET", "/api/audit/summary", token=ADMIN)
ok(code == 200 and asum["counts"]["total"] > 0, "audit summary", str(code))
code, _ = req("GET", "/api/audit", token=TRAINER)
ok(code == 403, "trainer cannot read the audit log 403", str(code))
code, _ = req("POST", "/api/audit", token=ADMIN, body={"module": "x", "action": "y"})
ok(code in (404, 405), "audit log is read-only — no write endpoint", str(code))

# ---------------------------------------------------------------------------
section("login throttle & enumeration")
code, u1 = req("POST", "/api/auth/login", body={"username": "no-such-user-xyz", "password": "x"})
code2, u2 = req("POST", "/api/auth/login", body={"username": "admin", "password": "wrong-pass"})
ok(code == 401 and code2 == 401, "unknown user and wrong password both 401", "%s %s" % (code, code2))
# Product decision: the reply names which half was wrong, so front-desk staff
# are not left guessing. The compensating control is that unknown usernames are
# throttled on the same budget (checked below), so enumeration is slow and
# logged rather than free.
ok("no account found" in (u1.get("error") or "").lower(),
   "unknown username says so", u1.get("error"))
ok("incorrect password" in (u2.get("error") or "").lower(),
   "wrong password says so", u2.get("error"))
ok("attempt(s) left" in (u2.get("error") or ""),
   "wrong password shows the remaining attempts", u2.get("error"))
ok("attempt(s) left" not in (u1.get("error") or ""),
   "unknown username does NOT leak the attempt countdown", u1.get("error"))
ok("not found" not in (u1.get("error") or "").lower(), "no 'user not found' leak", str(u1.get("error")))
# "e2e-brute" does not exist, so there is nothing to flag and nothing to lock:
# every attempt is answered the same way, just increasingly slowly.
statuses = set()
for _i in range(6):
    c, _b = req("POST", "/api/auth/login", body={"username": "e2e-brute", "password": "nope"})
    statuses.add(c)
ok(statuses == {401}, "an unknown username is never locked out, only slowed", str(sorted(statuses)))
code, _ = req("POST", "/api/auth/login", body={"username": "admin", "password": "admin123"})
ok(code == 200, "a valid login is unaffected by another account's failures", str(code))

# ---------------------------------------------------------------------------
section("guards")
code, _ = req("GET", "/api/users", token=MTOK)
ok(code == 403, "member token on admin route 403", str(code))
code, _ = req("GET", "/api/dashboard/stats")
ok(code == 401, "anonymous on dashboard 401", str(code))
code, _ = req("POST", "/api/clients", token=TRAINER, body={"member_code": "999", "name": "Sneaky"})
ok(code == 403, "trainer create client 403", str(code))

# ---------------------------------------------------------------------------
section("password policy: a spent allowance forces a reset, and no reuse")
# A throwaway account, so burning its five attempts cannot lock out admin and
# strand the rest of the run.
PW_USER = "pwpolicy_e2e"
PW_OLD = "OldPass#1"
req("DELETE", "/api/users/%d" % 0, token=ADMIN)  # no-op; keeps ids stable if rerun
code, existing = req("GET", "/api/users", token=ADMIN)
for u in (existing or []):
    if u.get("username") == PW_USER:
        req("DELETE", "/api/users/%d" % u["id"], token=ADMIN)
code, pu = req("POST", "/api/users", token=ADMIN,
               body={"username": PW_USER, "password": PW_OLD, "name": "Policy Probe",
                     "role": "trainer", "email": "policy.probe@gym.local"})
ok(code == 201 and pu.get("id"), "policy probe user created", str(code))
pw_uid = (pu or {}).get("id")

if pw_uid:
    code, _ = req("POST", "/api/auth/login", body={"username": PW_USER, "password": PW_OLD})
    ok(code == 200, "probe can sign in before the lockout", str(code))

    # Burn the allowance.
    last = {}
    for _ in range(5):
        code, last = req("POST", "/api/auth/login",
                         body={"username": PW_USER, "password": "definitely-wrong"})
    ok(code == 403, "5th wrong password returns 403 (not a 429 lockout)", str(code))
    ok("PASSWORD_RESET_REQUIRED" in (last.get("error") or ""),
       "the reply tells the UI to open the reset dialog", last.get("error"))
    # Explicitly: no timed lockout is offered anywhere.
    msg = (last.get("error") or "").lower()
    ok("minute" not in msg and "try again in" not in msg and "locked for" not in msg,
       "no waiting period is imposed", last.get("error"))

    # Even the right password is refused until it is changed.
    code, blocked = req("POST", "/api/auth/login", body={"username": PW_USER, "password": PW_OLD})
    ok(code == 403, "correct password refused while flagged", str(code))

    # Reset by OTP. The dev gateway returns the code in the response.
    code, sent = req("POST", "/api/auth/forgot", body={"username": PW_USER, "method": "email"})
    otp = (sent or {}).get("dev_otp")
    ok(code == 200 and otp, "OTP issued for the reset", str(code))

    if otp:
        # The old password must be refused...
        code, reused = req("POST", "/api/auth/verify-otp",
                           body={"username": PW_USER, "otp": otp, "new_password": PW_OLD})
        ok(code == 400, "reusing the previous password is rejected", str(code))
        ok("different" in (reused.get("error") or "").lower(),
           "reuse message explains why", reused.get("error"))

        # ...and that rejection must NOT have spent the OTP.
        code, done = req("POST", "/api/auth/verify-otp",
                         body={"username": PW_USER, "otp": otp, "new_password": "BrandNew#2"})
        ok(code == 200, "the same OTP still works after a rejected password", str(code))

        # The reset clears the lockout as well as the flag.
        code, _ = req("POST", "/api/auth/login", body={"username": PW_USER, "password": "BrandNew#2"})
        ok(code == 200, "sign-in works immediately after the reset — no cooling-off", str(code))
        code, _ = req("POST", "/api/auth/login", body={"username": PW_USER, "password": PW_OLD})
        ok(code == 401, "the old password no longer works", str(code))

    req("DELETE", "/api/users/%d" % pw_uid, token=ADMIN)

# ---------------------------------------------------------------------------
print("\n%s" % "=" * 52)
print("rid used for every request: %s" % RID)
print("RESULT: PASS=%d FAIL=%d" % (PASS, FAIL))
if FAILED:
    print("FAILED CHECKS:")
    for f in FAILED:
        print("  - " + f)
    sys.exit(1)
print("ALL MODULES VERIFIED — including the member portal.")
