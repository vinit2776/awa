# Support desk — design & build plan

In-app support ticketing: customers report bugs, feature requests and feedback from
wherever they are in the app; a platform-side support team triages, responds, resolves
and escalates against a TAT clock. Active in every tenant, no feature flag.

> **Status: Phases A and B built.**
> Migration `0014_support_desk.sql` is applied to the dev database. Report widget,
> `/dashboard/support`, `/dashboard/support/[id]`, `/platform/support`,
> `/platform/support/[id]`, attachments, and the events audit trail are all in.
> Phase B added routing and the TAT clock (migration `0016`): auto-assignment, the agent
> roster at `/platform/support/agents`, SLA targets populated at creation, the clock
> pausing while `awaiting_customer`, and breach shown in the queue. Phases C–D
> (escalation matrix, the cron sweep, auto-close) are not started —
> `escalation_level` exists but nothing ever increments it.
>
> Decisions **D1** (email provider) and **D4** (publish TAT) are still open and were built
> to the recommended default. **D2** (paste + file picker) and **D3** (reporter + tenant
> admins) are implemented as recommended. **D5** (global `SUP-00042` reference) is live.

Sections marked **Decision** carry a recommendation; the ones already implemented are
noted above.

---

## 1. Principles

Five rules that keep this simple. Everything below follows from them.

1. **One status field, two vocabularies.** A single internal state machine, with a
   customer-facing label map on top. Two independent lifecycles would drift within a
   month and nobody would be able to say what state a ticket is *actually* in.
2. **Tenant isolation is the existing RLS model, not new code.** Every ticket table
   carries `tenant_id`; `app.current_tenant_id()` does the rest. The "dedicated channel
   per customer" requirement is satisfied by the same mechanism that already isolates
   requisitions.
3. **Derive, don't store.** SLA breach, ticket age, unread counts — computed at read
   time from two stored timestamps. The only thing a scheduler does is *notify*.
4. **Small enums, separate outcome field.** Resolution reasons (`duplicate`, `wont_do`,
   `not_a_bug`) are not statuses. Keeping them out of the status enum is what stops it
   growing to fifteen values.
5. **Never get stuck.** No eligible assignee, no SLA policy match, no active agent — the
   ticket still gets created and lands somewhere visible. Same reasoning as
   `isTenantAdmin`'s zero-admin bootstrap ([db/permissions.ts:15](../db/permissions.ts))
   and `resolveApprovals`' zero-approver auto-approve path.

---

## 2. Codebase constraints this design has to respect

These are facts about the repo as it stands, not assumptions. Each one changes the design.

| Finding | Consequence |
|---|---|
| RLS is applied generically to any table with a `tenant_id` column, but the `do $$` block that does it only ran in `0001_init.sql`. Later migrations add policies by hand (see `0009_push_subscriptions.sql`). | The support migration must write its own `enable row level security` + `create policy tenant_isolation` per table. Not automatic. |
| `audit_log.actor_user_id` references `users(id)`; a platform support agent has no `users` row. | Support actions cannot go in `audit_log`. Needs a dedicated `support_ticket_events` table with a two-column actor (customer user *or* platform admin). |
| `platform_admins` has role `super_admin \| support`, and is outside RLS entirely (no `tenant_id`). | The support team principal already exists. `getCurrentPlatformAdmin()` is the auth entry point. |
| A platform admin connects as `app_runtime` with **no** `app.tenant_id` set, so `app.current_tenant_id()` returns `NULL` and every tenant-scoped policy evaluates false. | The cross-tenant queue view needs a deliberate mechanism. See §6. |
| `@aws-sdk/client-s3` is a dependency but **has zero imports**. R2 env vars exist; the bucket may not. | Attachments are the first object storage in this project. Budget for bucket creation + a `SETUP.md` update, not just code. |
| `db/notifications.ts#deliver` logs to console. Web Push is real; email is not. | A ticket reply reaches the customer only if they are logged in or have a push subscription. This is the single biggest gap in the feature's value. **Decision D1.** |
| `src/app/platform/` is one `page.tsx` with no `layout.tsx` — the `getCurrentPlatformAdmin` try/catch is inline. | Add `src/app/platform/layout.tsx` doing the check once plus nav, before adding three more pages that would each repeat it. |
| `src/components/ui/` contains only `button.tsx` and `breadcrumbs.tsx`. | The report widget needs a Dialog/slide-over component added (`@base-ui/react` is already a dependency). |
| A `tenant_id uuid NULL` row is invisible to *everyone* under the `tenant_id = app.current_tenant_id()` policy. | Do not model "global default, tenant override" as one nullable-tenant table. Platform-level config tables get **no** `tenant_id` column at all. |

---

## 3. Lifecycle

The centrepiece. One enum, one map.

### Internal states

```
                    ┌──────────────── reopened (≤14d) ─────────────┐
                    ▼                                              │
  new ──▶ triaged ──▶ in_progress ──▶ resolved ──▶ closed          │
                          ▲   │          ▲                         │
                          │   ▼          │                         │
                    awaiting_customer ───┘                         │
                          └────────────────────────────────────────┘
```

| State | Set by | Meaning |
|---|---|---|
| `new` | system, on create | Landed, not yet looked at by a human |
| `triaged` | support | Read, categorised, priority set, assigned |
| `in_progress` | support | Actively being worked |
| `awaiting_customer` | system, when support posts a message flagged `is_question` | Ball is in the customer's court |
| `resolved` | support, with an outcome + summary | Support believes it's done; customer can confirm or reopen |
| `closed` | system (7d after resolve, or customer confirms) | Terminal |

Transitions out of `awaiting_customer` back to `in_progress` happen automatically the
moment the customer posts a reply. No one has to remember to flip it.

Reopen: `resolved → in_progress` within 14 days of `resolved_at`. After that the customer
files a new ticket, which we link to the old one via `related_ticket_id`. A ticket that
can be reopened forever never closes.

### Who is talking to whom

Three participant classes, two lanes.

| | Reporter | Their colleagues / tenant admins | AWA support agents |
|---|---|---|---|
| `visibility = 'customer'` | write + read | read, and write per **D3** | write + read |
| `visibility = 'support_only'` | — | — | write + read |

**The asymmetry is deliberate.** Support has a private lane; the customer organisation
does not. Under D3 a tenant admin can read a colleague's ticket, and anything they write
goes to AWA support. Adding a `tenant_internal` third lane would take the matrix from
2 lanes × 3 classes to 3 × 3 and put a "who sees this?" decision on every customer reply —
which makes accidental disclosure more likely, not less.

That is *not* because customer-side discussion doesn't matter. It matters enough to be its
own system, on the record rather than on a ticket — see the boundary below.

---

## 3.1 Boundary: this is not the clarification system

**A clarification is a question about a transaction. A support ticket is a question about
the product.** They look superficially alike — both are threads that stay open until
someone resolves them — and merging them would be a serious mistake.

|  | Transaction clarification | Support ticket |
|---|---|---|
| **Asked about** | A requisition, PO, invoice, GRN, quotation | The application |
| **Between** | Two users inside the same customer org | The customer org and AWA support |
| **Answered by** | A colleague | AWA |
| **Lives on** | The record's own page | `/dashboard/support` |
| **Blocks** | Can hold an approval decision | Nothing in the procurement flow |
| **AWA sees it** | Never | Always |
| **Audit** | Existing `audit_log` — both actors have `users` rows | Its own events table — support agents don't |
| **Volume** | Routine, many per week | Occasional |

The decision rule, for a user staring at both buttons: **is the answer inside your
organisation, or inside our product?** An approver asking "which cost centre does this hit?"
needs their colleague, not AWA. A buyer reporting "the match screen throws an exception on a
part-delivered line" needs AWA, not their colleague.

Transaction clarifications are specified separately in
[transaction-clarifications-plan.md](transaction-clarifications-plan.md). The only link
between the two systems is a one-way promotion: a clarification that turns out to be a
product defect can be **escalated into a support ticket**, carrying its record context and a
back-reference. Nothing is shared — not a table, not an enum, not a status model.

**Naming consequence.** Nothing in the support desk is called a "clarification". Support
asking the customer a follow-up question is a *support question*
(`is_question`), which moves the ticket to `awaiting_customer`. Reusing the word across both
systems is exactly how two features become one confusing one.

### Customer-facing labels

Five words. This is the entire vocabulary the customer ever sees.

| Internal | Customer sees | Colour |
|---|---|---|
| `new`, `triaged` | **Open** | neutral |
| `in_progress` | **In progress** | blue |
| `awaiting_customer` | **Needs your input** | amber — loud, this is the one that stalls tickets |
| `resolved` | **Resolved** — with *Confirm* / *Reopen* buttons | green |
| `closed` | **Closed** | muted |

### Resolution outcomes (separate field, not a status)

`fixed` · `shipped` · `wont_do` · `duplicate` · `not_a_bug` · `no_response`

Every resolve requires an outcome **and** a free-text `resolution_summary`. The summary is
customer-visible — it is the thing that makes a support system feel honest rather than a
black hole.

---

## 4. Data model

Four tenant-scoped tables (RLS) and three platform-level tables (no RLS, no `tenant_id`).

### 4.1 `support_tickets` — tenant-scoped

```sql
id                      uuid pk
tenant_id               uuid not null references tenants(id)
reference               text not null unique      -- 'SUP-00042', from a global sequence
type                    support_ticket_type       -- bug | feature_request | feedback | question
status                  support_ticket_status     -- new|triaged|in_progress|awaiting_customer|resolved|closed
priority                support_ticket_priority   -- urgent|high|normal|low
subject                 text not null
description             text not null
reported_by_user_id     uuid not null references users(id)

-- context snapshot, captured at report time (see §5)
page_path               text
page_url                text
related_entity_type     text          -- 'requisition' | 'purchase_order' | ...
related_entity_id       uuid
app_version             text
user_agent              text
viewport                text

-- assignment (platform side)
assigned_to_admin_id    uuid references platform_admins(id)
assigned_at             timestamptz

-- TAT
first_response_due_at   timestamptz
resolution_due_at       timestamptz
first_responded_at      timestamptz
resolved_at             timestamptz
closed_at               timestamptz
resolution_outcome      support_resolution_outcome
resolution_summary      text
escalation_level        int not null default 0
escalated_at            timestamptz
customer_escalated_at   timestamptz   -- customer pressed "escalate", once per ticket

related_ticket_id       uuid references support_tickets(id)
created_at, updated_at  timestamptz not null default now()
```

**Reference numbering — Decision D5.** Recommend a single global sequence
(`SUP-00042`, unique platform-wide) rather than per-tenant numbering. Support staff work
a cross-tenant queue; two customers both having a "Ticket 7" is a standing source of
mistakes. The only cost is that a customer can infer total platform ticket volume, which
is not sensitive.

### 4.2 `support_ticket_messages` — tenant-scoped

The support conversation lives here. One thread, two visibilities (§3, *Who is talking to
whom*). Not to be confused with transaction clarifications (§3.1) — different system,
different table, different participants.

```sql
id, tenant_id, ticket_id
visibility                  support_message_visibility  -- 'customer' | 'support_only'
body                        text not null
is_question                 boolean not null default false  -- drives → awaiting_customer
author_user_id              uuid references users(id)
author_platform_admin_id    uuid references platform_admins(id)
created_at                  timestamptz not null default now()

check (num_nonnulls(author_user_id, author_platform_admin_id) = 1)
check (visibility <> 'support_only' or author_platform_admin_id is not null)
```

The value is `support_only`, not `internal`, on purpose. With three participant classes in
play, "internal" doesn't say internal *to whom* — a future contributor could reasonably
read it as "internal to the customer's organisation" and build the wrong thing on top of
it. `support_only` names the audience.

The second check is load-bearing: it makes "a customer wrote a support-only note"
impossible at the database level, not merely unlikely in the UI. A support agent's private
note and a customer's reply travel the same table, so the constraint — not a server
action, not a UI guard — is what keeps the lanes apart.

**The single highest-risk bug in this whole feature is a support-only note leaking into
the customer view** — §9 makes it a named test.

### 4.3 `support_ticket_attachments` — tenant-scoped

```sql
id, tenant_id, ticket_id
message_id                    uuid references support_ticket_messages(id)  -- null = attached to the ticket itself
storage_key                   text not null
file_name, content_type       text not null
size_bytes                    integer not null
uploaded_by_user_id           uuid references users(id)
uploaded_by_platform_admin_id uuid references platform_admins(id)
created_at
```

Storage key layout: `support/<tenant_id>/<ticket_id>/<attachment_id>.<ext>`. Tenant id in
the path means a leaked key still cannot cross tenants without also passing the DB check.

### 4.4 `support_ticket_events` — tenant-scoped, append-only

The audit trail: how a ticket was managed and resolved, and by whom.

```sql
id, tenant_id, ticket_id
event                       text not null
   -- created | assigned | reassigned | status_changed | priority_changed
   -- | message_posted | escalated | sla_breached | resolved | reopened | closed
actor_kind                  support_actor_kind   -- 'customer' | 'support' | 'system'
actor_user_id               uuid references users(id)
actor_platform_admin_id     uuid references platform_admins(id)
from_value, to_value        text
metadata                    jsonb not null default '{}'
occurred_at                 timestamptz not null default now()
```

Append-only, enforced the same way `audit_log` is
([0003_app_role.sql:26](../db/migrations/0003_app_role.sql)):

```sql
revoke update, delete on support_ticket_events from app_runtime;
```

Written inside the same transaction as the mutation it describes, via the existing
`logAction` discipline — same commit-or-rollback-together guarantee, different table
(because of the `actor_user_id` FK constraint noted in §2).

### 4.5 `support_agents` — platform-level, **no** `tenant_id`, no RLS

```sql
id
platform_admin_id   uuid not null unique references platform_admins(id)
active              boolean not null default true
handles_types       support_ticket_type[] not null default '{}'   -- empty = all types
covers_tenant_ids   uuid[] not null default '{}'                  -- empty = all customers
max_open            integer                                        -- null = no cap
created_at
```

### 4.6 `support_sla_policies` — platform-level, no `tenant_id`

Uniform TAT across customers in v1. Per-tenant overrides, when a customer negotiates one,
become a *separate* tenant-scoped `support_sla_overrides` table — **not** a nullable
`tenant_id` on this one (§2, last row).

```sql
id
ticket_type              support_ticket_type
priority                 support_ticket_priority
first_response_minutes   integer not null
resolution_minutes       integer          -- null = no resolution TAT (feature requests)
```

Seed values:

| Type | Priority | First response | Resolution |
|---|---|---|---|
| bug | urgent | 1 h | 8 h |
| bug | high | 4 h | 48 h |
| bug | normal | 8 h | 5 days |
| bug | low | 24 h | 15 days |
| question | any | 8 h | 3 days |
| feature_request | any | 3 days | *none* |
| feedback | any | 3 days | *none* |

A feature request has no honest resolution TAT — it goes to a backlog, not to a fix.
Promising one would make every feature request a permanent SLA breach. `NULL` says so.

### 4.7 `support_escalation_matrix` — platform-level, no `tenant_id`

```sql
id
level                    integer not null           -- 1, 2
trigger                  support_escalation_trigger
  -- first_response_breach | resolution_breach | aging_no_update
  -- | reopened_twice | customer_escalated
after_minutes            integer                     -- grace past the breach; 0 = immediate
notify_platform_admin_id uuid references platform_admins(id)
notify_role              platform_admin_role         -- e.g. all super_admins
```

Three levels, deliberately:

- **L0** — the assigned agent. Not a row; the default.
- **L1** — first-response or resolution breach → notify agent + designated escalation
  contact, set `escalation_level = 1`.
- **L2** — 2× the resolution target still unresolved, *or* reopened twice, *or* the
  customer pressed escalate → notify all `super_admin`s, set `escalation_level = 2`.

Escalation never silently changes priority. A human decides that, and the change is an
event.

---

## 5. Capturing context from the reported page

The widget is a client component mounted once in
[src/app/dashboard/layout.tsx](../src/app/dashboard/layout.tsx), beside `PushNotifications`.
It opens a slide-over rather than navigating, so the page the user is reporting about
stays on screen and in state.

**Captured automatically:**

- `usePathname()` and `window.location.href`
- `navigator.userAgent`, viewport `w×h`
- `NEXT_PUBLIC_APP_VERSION` (wire to the Vercel git SHA)
- the tenant and user, from the server action's own session — never from the client payload

**Deliberately not captured:** DOM snapshots, form field values, `localStorage`. This app
holds bank details, invoice values and vendor pricing. A support system that vacuums up
page state would be exfiltrating exactly the data
[db/crypto.ts](../db/crypto.ts) exists to protect. The screenshot is the escape hatch —
and the user chooses what's in it.

**Disclosure line in the form:** *"We'll include: this page, your browser, and your name
and organisation."* Transparency costs one line and removes the whole category of "the
support widget captured what?"

### Screenshots — Decision D2

**Recommended v1: file picker + clipboard paste.** An `onPaste` handler on the description
textarea reading `event.clipboardData.files`. Zero new dependencies. Users already know
`Cmd+Shift+4` / `PrtScn`, and it captures what they actually see — including native
dialogs, other windows, and cropped regions.

Rejected: `html2canvas`-style DOM-to-image. It adds a dependency and re-renders the DOM
rather than photographing it, so it silently misses cross-origin images, canvas content
and shadow DOM. A bug screenshot that doesn't match what the user saw is worse than no
screenshot.

Optional Phase D: a *Capture this page* button using `navigator.mediaDevices.getDisplayMedia()`
— real capture, no dependencies, but a browser permission prompt and a tab-picker step.
Add it if paste turns out to be a friction point, not before.

### Upload path

Route handler upload (`POST /api/support/attachments`), not presigned URLs.
`@aws-sdk/s3-request-presigner` is not installed; a route handler needs no new dependency,
validates content-type and size server-side, and keeps the bucket fully private.
Downloads stream back through a route handler that checks the ticket's tenant scope first.

Limits: 5 files per message, 10 MB each, `image/png`, `image/jpeg`, `image/webp`,
`application/pdf`, `text/plain` only. Everything else rejected by extension *and* sniffed
content type.

---

## 6. Cross-tenant access for the support console

The one genuinely hard call. A platform admin has no `app.tenant_id`, so every
tenant-scoped policy returns zero rows.

**Recommendation: `adminDb` for exactly two read queries, `withTenant` for everything else.**

Once you know which tenant a ticket belongs to, you can scope normally. Only the *queue
list* and *search* are inherently cross-tenant:

```
db/supportDesk.ts
  listQueue(filters)      → adminDb   ← cross-tenant by nature
  searchTickets(q)        → adminDb   ← cross-tenant by nature
  getTicket(id)           → adminDb to resolve tenant_id, then withTenant for the body
  everything that writes  → withTenant(ticket.tenantId)
```

This keeps the RLS-bypassing surface to two functions in one file, guarded by
`getCurrentSupportAgent()` (wrapping `getCurrentPlatformAdmin()` plus a `support_agents`
lookup). It matches the existing precedent — `db/session.ts`, `db/tenant.ts` and
`db/vendorAuth.ts` all use `adminDb` for lookups that must run *before* a tenant scope
exists — and it gets the same file-header comment treatment as
[db/adminClient.ts](../db/adminClient.ts).

**Alternative, if the support team grows past a handful of people:** a second RLS policy
keyed on an `app.platform_actor` GUC, so the console runs under RLS too. Cleaner in
principle, but it doubles the policy surface on these four tables and every tenant-scoped
table added afterwards. Note it as the upgrade path; don't pay for it at one customer.

---

## 7. Auto-assignment and reassignment

Deterministic, three steps, testable:

1. **Account ownership wins.** Any active agent with this `tenant_id` in
   `covers_tenant_ids` → assign to them.
2. **Otherwise least-loaded, by type.** Among active agents whose `handles_types`
   includes the ticket type (or is empty), pick the fewest open tickets
   (`status not in ('resolved','closed')`), ties broken by longest time since last
   assignment. Skip anyone at `max_open`.
3. **Otherwise leave it unassigned**, status `new`, and notify every `super_admin`. The
   ticket is never lost because routing had nothing to say.

Reassignment: any support agent can reassign, with an optional note. Writes a
`reassigned` event carrying `from_value`/`to_value`. The event table *is* the audit trail
of how the ticket was managed — no separate assignment-history table.

---

## 8. TAT clock and escalation mechanics

At creation, resolve the matching `support_sla_policies` row and store two absolute
timestamps: `first_response_due_at` and `resolution_due_at`. Nothing else is stored.

**Breach is derived, never stored:**

```sql
first_responded_at is null and now() > first_response_due_at   -- response breach
resolved_at        is null and now() > resolution_due_at       -- resolution breach
```

**The clock pauses while waiting on the customer.** When a ticket leaves
`awaiting_customer`, shift `resolution_due_at` forward by the duration it waited, in the
same transaction as the status change, recorded as an event. One update, honest clock,
and queries stay a single comparison. Without this, every ticket where the customer takes
a day to reply shows as breached and the whole SLA display becomes noise people ignore.

`first_response_due_at` never shifts — first response is unconditionally support's job.

**The only scheduled job:** Vercel Cron → `POST /api/support/sla-sweep` every 15 minutes,
guarded by a `CRON_SECRET` header. It does exactly two things:

1. Find newly-breached tickets, write an `sla_breached` event, bump `escalation_level`
   per the matrix, notify.
2. Auto-close `resolved` tickets past the 7-day confirmation window
   (`resolution_outcome` stays; a `closed` event records it was automatic).

Idempotent by construction: it never acts on a ticket whose `escalation_level` already
covers that trigger. No worker infrastructure — Railway is not needed for this.

---

## 9. Testing

Following the existing throwaway-tenant discipline
([db/\_\_tests\_\_](../db/__tests__)); these run in CI per `.github/workflows/ci.yml`.

**Extend `rls-isolation.test.ts` with all four new tenant-scoped tables.** AGENTS.md calls
that test the thing that actually proves tenant isolation holds and a launch blocker if
it fails. A new tenant-scoped table that isn't in it is an untested isolation claim.

New `db/__tests__/support-desk.test.ts`:

| Test | Why |
|---|---|
| **A `support_only` note is never returned by the customer-side query** | The highest-consequence bug in the feature. Named test, not an assertion buried in a larger one. |
| A ticket raised in tenant A is invisible to tenant B | The dedicated-channel requirement, proven rather than assumed |
| Auto-assign picks the least-loaded eligible agent | Routing correctness |
| Auto-assign with zero eligible agents still creates the ticket, unassigned | The never-get-stuck rule |
| Support reply flagged `is_question` moves the ticket to `awaiting_customer`; customer reply moves it back | The follow-up question loop |
| `resolution_due_at` shifts by the customer-wait duration | The clock is honest |
| The `check` constraint rejects a customer-authored `support_only` note | DB-level enforcement actually applies |
| A tenant admin reading a colleague's ticket sees no `support_only` message | D3 widens who reads the thread; it must not widen which lane they read |
| `update`/`delete` on `support_ticket_events` are denied to `app_runtime` | Append-only actually applies |

---

## 10. Build phases

Each phase is one branch and one PR into `main` per the AGENTS.md shipping policy.

### Phase A — Report & respond *(the "base")*

The smallest thing that is genuinely useful: a customer can report from any page with a
screenshot, and a human replies.

- Migration `0014_support_desk.sql`: enums, four tenant-scoped tables, RLS policies per
  table (hand-written — the generic `do $$` block does not re-run), append-only revoke,
  reference sequence
- `db/schema.ts` additions to match
- `db/supportDesk.ts` — create, list, get, post message, status transitions, event logging
- Attachment upload/download route handlers + R2 bucket created and documented in SETUP.md
- `src/components/ui/dialog.tsx` (Base UI)
- Customer: report widget in the dashboard shell, `/dashboard/support`,
  `/dashboard/support/[id]`
- Platform: `src/app/platform/layout.tsx` (auth once + nav), `/platform/support` queue,
  `/platform/support/[id]` with `support_only` notes and manual assignment
- In-app + Web Push notification on reply; email per **D1**
- Tests per §9

### Phase B — Routing & TAT

- `support_agents`, `support_sla_policies` + seed
- Auto-assignment (§7), reassignment UI
- Due dates at creation, clock shift on `awaiting_customer` exit
- Breach state and SLA colour in the queue; `/platform/support/agents` roster

### Phase C — Escalation & automation

- `support_escalation_matrix` + seed
- `/api/support/sla-sweep` + Vercel Cron + `CRON_SECRET`
- Customer *Escalate* button (once per ticket), auto-close after 7 days

### Phase D — Polish

Ranked by expected value:

1. **Console error capture** — a global `window.onerror` / `unhandledrejection` ring
   buffer of the last ~20 entries, attached to bug reports. The single highest-value
   addition for triage speed.
2. Saved replies / macros for the support console
3. CSAT thumbs on resolve
4. Per-tenant SLA overrides (`support_sla_overrides`, tenant-scoped)
5. Business-hours calendars — deliberately deferred; v1 is a 24×7 clock
6. Weekly open-ticket digest to tenant admins
7. Vendor portal reporting (external users, separate auth — a different problem)

---

## 11. What the support console shows about the customer

The requirement that every ticket carries clear customer detail, made concrete. The ticket
header at `/platform/support/[id]` renders:

**Organisation** — tenant name, slug, status (`active`/`suspended`), feature flags,
open ticket count, account owner
**Reporter** — full name, email, roles held, department and cost centre, account status
**Environment** — page reported from (as a link), browser, viewport, app version,
timestamp
**Related record** — a link to the requisition / PO / invoice, when the report came from
one of those pages

Reporter and organisation details are **joined live**, not denormalised, so a renamed
department or changed role shows current truth. Environment is **snapshotted at report
time**, because it is a historical fact about the moment the bug happened. That split is
deliberate: joining the environment would show the browser they're using *now*, which is
useless for reproducing a bug from three weeks ago.

---

## 12. Decisions needed

Each has a recommendation; none blocks Phase A from starting if left at the default.

**D1 — Email delivery.** `db/notifications.ts` logs to console. Without a real provider, a
support reply only reaches a customer who is logged in or has a push subscription — which
makes "we replied, they never saw it" the default failure mode.
→ **Recommend: wire Resend as part of Phase A.** It is already a launch-readiness item in
AGENTS.md, `deliver()` is the single function that changes, and this feature is the one
that makes it urgent rather than pending.

**D2 — Screenshot capture.** → **Recommend: file picker + clipboard paste** (§5). Zero
dependencies, captures what the user actually sees. Revisit `getDisplayMedia` in Phase D.

**D3 — Ticket visibility inside a customer org.** → **Recommend: reporter + tenant
admins.** A tenant admin needs to see what their organisation has raised; a junior buyer's
feedback about their manager's approval flow shouldn't be org-wide reading. Alternatives:
everyone in the tenant, or reporter-only.

**D4 — Publish the TAT to the customer.** → **Recommend: show the first-response target
only** ("we aim to respond within 4 hours"), keep the resolution clock internal. A visible
first-response promise is the one that builds trust and is nearly always met; a visible
resolution clock on a hard bug turns into a weekly argument.

**D5 — Reference numbering.** → **Recommend: global sequence** (`SUP-00042`), §4.1.

---

## 13. Deliberately out of scope for v1

Named so they're choices, not oversights:

- Business-hours / holiday calendars on the SLA clock — 24×7 in v1
- Vendor-portal ticket reporting — external users, separate auth model
- Customer-to-customer visibility of feature requests (a public roadmap) — different product
- Email-in ticket creation (reply-to-create) — needs inbound email parsing
- Ticket merging and splitting — `related_ticket_id` covers the common case
- Knowledge base / deflection — no article corpus exists yet
- EXIF stripping on uploaded images — noted as a real gap, low risk for app screenshots
