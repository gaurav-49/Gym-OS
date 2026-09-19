# Test scenarios — GYM OS 2.0

Everything below is set up by `db/seed-demo.js`. Run it first:

```bash
cd "Gym 2.0/db" && node migrate.js && node seed-demo.js --wipe
```

`--wipe` removes only what a previous run created (member codes 5000–5999,
usernames starting `coach.`, and anything named `Demo …`). Your own data is
never touched.

**Sign in**

| | |
|---|---|
| Staff | `admin` / `admin123` |
| Trainer | `coach.rahul` / `trainer123` (also priya, arjun, sneha) |
| Member | any Member ID with password `admin` |

Sample requests for every endpoint, one file per API: [README.md](README.md).

---

## 1. The referral reward, end to end

The loop is: share a code → the friend gives it at the desk → the friend pays
in full → the referrer's **next renewal** is discounted, **once**.

**Member 5048 (Kabir Singh) has a ₹100 reward banked and unspent.**

1. Renew him for a ₹2,000 Monthly plan, paying **₹1,900**.
2. The reply says *"Referral reward of ₹100 applied"* and `amount_due` is **0** —
   the fee was reduced, not the payment.
3. The receipt note reads:
   > Referred member 5049 - Riya Das.
   > ₹100 off applied to this membership.
   > Future memberships are charged at the normal rate. Keep referring to keep the benefit.
4. **Renew him again.** `referral_discount` is now **0** — a reward is spent once.

**Member 5043 (Neha Nayar) has a referral at every stage**, which is where the
interesting bugs live:

| Stage | What it means |
|---|---|
| `pending` | invited, has not walked in |
| `joined` | signed up, has **not** paid in full → no reward yet |
| `rewarded` | paid in full → reward earned, waiting |
| `rewarded` + `redeemed_on` | already spent on a renewal |

Sign in as **5043 / admin** → *Refer & earn* to see the tally from the member's
side.

**Worth trying:** invite someone with no phone number (rejected — a name cannot
be matched at the desk), then the same number twice (rejected — one friend is
one reward). Onboard a new member with referral code `NEHA5043` and pay in
full: Neha's reward count goes up immediately. Onboard another with a code
nobody owns: rejected **before** the member is created, so there is no
half-made record to clean up.

---

## 2. The access gate — unpaid means locked, on every door

There is no instalment option, so an outstanding balance locks access outright.

**Member 5024 (Harsh Reddy) owes ₹800.** All four doors must refuse:

- QR scan (`POST /api/attendance/qr-punch`) → **403 gate locked**
- Fingerprint / card (`POST /api/device/punch`) → **403**
- Manual form (`POST /api/attendance/mark`) → **403** ← *this was the way round it*
- Their own portal shows the balance and says access is locked

Then collect the ₹800 (`POST /api/payments/collect-due`) and punch again — it
opens. Six members are in arrears; five more states are seeded too: **8 expired**,
**3 frozen**, **3 inactive**, **8 expiring this week**. Each gives its own refusal
message.

---

## 3. The member portal

Sign in as **5050 (Manish Gupta) / admin** — he has a trainer, a PT plan,
workouts, diet, six months of measurements, attendance and payments.

| Tab | What to check |
|---|---|
| Overview | plan, dues, QR code. **No check-in button** — the QR is display-only |
| Classes | book, waitlist, cancel; the first three days are deliberately full |
| Workouts / Diet | read-only plans |
| Progress | six monthly measurements, weight trending down |
| Attendance | their own history, read-only |
| Membership & payments | member-since, plan, billing, and a **Receipt** on every payment |
| Personal training | *only appears because he has a trainer* |
| Refer & earn | code, offer, invitations |

Now sign in as a member **without** a trainer (say **5005**) — the Personal
training tab is absent, not empty.

**Receipts:** open any payment's *Receipt*. Each one prints what that payment
actually bought, read off the payment row itself — a personal-training receipt
shows the training plan, its term and the trainer, not the membership the
member happens to hold. **5050** has one of each of the first two:

| Payment | The receipt should say |
|---|---|
| Personal training | *Personal training — Demo PT Half-Year*, the training term, the trainer, and the monthly rate |
| Membership | *Membership — Half-Yearly* and the term it covers |
| Dues settled | *Outstanding balance settled* and **no period at all** — it buys no new term. Collect from **5025** on the staff Payments page to make one |

Every receipt carries the gym's name and slogan from `branding.properties`, the
amount in words (Indian numbering), a PAID stamp, how the account stands today,
and the gym's own small print (`gym.branding.receipt-note`). A member in
arrears gets a red balance banner saying entry stays locked — try **5025**.

On a renewal that spent a referral reward the receipt shows three lines that
add up: the fee charged, the reward taken off, and the amount received — plus
the note naming who was referred. Renew **5048** and open the receipt.

The same *Receipt* button is on the staff **Payments** page, so the desk can
reprint one without signing in as the member.

**The default password:** every member is on `admin` until they change it, and
the portal says so in a banner. Change it from the banner (you stay signed in),
or from the login screen. `admin` is refused as a *new* password.

---

## 4. Personal training is sold by duration

PT works like membership — Monthly / 3 months / 6 months / Yearly at a fee for
the term, **not** a block of sessions. Five demo plans are seeded from ₹6,000
(monthly) to ₹54,000 (yearly); the longer terms are cheaper per month.

**55 members are on PT across the four coaches.** A few plans have already
lapsed, so the renewal prompt has something to point at.

- *Staff → Personal Training*: create a plan and the term drives the validity.
  The session cap is optional — leave it blank for unlimited.
- `Demo PT 12-Session` is the one capped plan, so both paths are exercised.
- Log a session on an unlimited plan: it records, and nothing counts down.
- Log one on the capped plan until it is exhausted: further logging is refused.

---

## 5. Form validation

Every one of these was accepted before and is now refused. The per-API files have
a ready-made request for each.

| Module | Try |
|---|---|
| Member | paid > fee · expiry before start · `abcdefghij` as a phone · a 3-digit phone · `not-an-email` · a date of birth in 2036 · a one-letter name |
| Payment | dated next year |
| Class | scheduled last month |
| Lead | letters in the phone |
| Expense | dated next year |
| Progress | −70 kg · 900 kg · measured next year |
| Assessment | dated next year |
| Device | empty form · no IP · `999.1.1.1` · port 99999 |
| User | `bad user!` as a username |
| PT plan | no `plan_type` |

Also worth a look: submit **every** module's create form completely empty. All
of them block with a message naming the field.

---

## 6. Login and passwords

- Usernames are **case-insensitive** and display in caps: `admin`, `ADMIN` and
  `AdMiN` are one account. Passwords are **case-sensitive**.
- A wrong username says so; a wrong password says so and counts down. Five
  failures force a reset rather than locking anyone out on a timer.
- OTP resends get progressively more expensive: 1 min → 10 min → 20 min → 1 h → 24 h.
- A rejected new password does **not** burn the OTP.

---

## 7. White-labelling

The gym's identity lives in
`backend-java/src/main/resources/branding.properties`. Change the name there,
restart, and both portals follow. Drop a `branding.properties` next to the war
to rebrand a site without rebuilding.

---

## Reset

```bash
cd "Gym 2.0/db" && node seed-demo.js --wipe
```

To work in a sandbox instead of your own database, put `DB_NAME=gymdb_test` in
front of both the migration and the seed.
