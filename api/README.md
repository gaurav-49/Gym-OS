# Sample API requests

One file per API, named after it. Open any of them in VS Code with the
[REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client)
extension (or in JetBrains, which reads `.http` natively) and click **Send
Request** above a block.

Each file stands on its own: it declares `@host`, signs in at the top, and every
request below it uses that token. **Send the sign-in block first** — REST Client
variables do not carry from one file to another, which is exactly why the token
is re-fetched in each.

Bodies work as-is against the demo gym from `db/seed-demo.js`. Anything that
writes is marked `[CHANGES DATA]`; the requests that are *meant* to be refused
say so in their comment, with the status to expect.

Run against the sandbox rather than your own database if you prefer:

```bash
cd "Gym 2.0/db" && DB_NAME=gymdb_test node migrate.js && DB_NAME=gymdb_test node seed-demo.js
```

## The files

| Front desk | |
|---|---|
| [auth.http](auth.http) | staff sign-in, password recovery |
| [users.http](users.http) | staff and trainer accounts |
| [clients.http](clients.http) | members — join, renew, upgrade, freeze, cancel |
| [attendance.http](attendance.http) | the access gate: manual, QR, report |
| [devices.http](devices.http) | turnstiles and card readers |
| [classes.http](classes.http) | timetable, bookings, waitlist |
| [leads.http](leads.http) | enquiries and conversion |
| [dashboard.http](dashboard.http) | the home screen in one call |

| Member portal | |
|---|---|
| [member-portal.http](member-portal.http) | the member's own sign-in and page |
| [member-classes.http](member-classes.http) | booking from the portal |
| [member-referrals.http](member-referrals.http) | Refer & earn |

| Money | |
|---|---|
| [payments.http](payments.http) | the ledger, and what each payment bought |
| [billing.http](billing.http) | auto-renewal and dunning |
| [invoices.http](invoices.http) | numbered, tax-bearing documents |
| [expenses.http](expenses.http) | what the gym spends |
| [finance.http](finance.http) | profit and loss |
| [plans.http](plans.http) | the membership price list |

| Selling | |
|---|---|
| [pt.http](pt.http) | personal training — plans, subscriptions, commissions |
| [products.http](products.http) | retail stock |
| [product-sales.http](product-sales.http) | counter sales |
| [lockers.http](lockers.http) | allocation and rent |
| [referrals.http](referrals.http) | member-get-member |

| Coaching | |
|---|---|
| [progress.http](progress.http) | body measurements over time |
| [workouts.http](workouts.http) | workout plans |
| [diets.http](diets.http) | diet plans |
| [assessments.http](assessments.http) | body composition |
| [challenges.http](challenges.http) | gym-wide competitions |

| Running the place | |
|---|---|
| [staff.http](staff.http) | employment, attendance, shifts, payroll |
| [tasks.http](tasks.http) | the follow-up queue |
| [retention.http](retention.http) | who is drifting away |
| [notifications.http](notifications.http) | expiry reminders, renewal receipts |
| [announcements.http](announcements.http) | notices to members |
| [feedback.http](feedback.http) | what members say back |
| [branding.http](branding.http) | this gym's own identity |
| [branches.http](branches.http) | more than one location |
| [audit.http](audit.http) | who changed what |
| [exceptions.http](exceptions.http) | the shared validation catalogue |

For a guided walk through the demo gym rather than a reference, see
[TEST_SCENARIOS.md](TEST_SCENARIOS.md).
