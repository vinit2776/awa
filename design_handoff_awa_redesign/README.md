# Handoff: AWA self-teaching redesign

## Overview
AWA's UI works but doesn't teach itself — ten flat nav items, dismissible help that disappears for good, and no visible path from "empty tenant" to "I know how to use this." This redesign restructures navigation around "yours vs. shared," promotes the existing seven-stage lifecycle into the spine of the home page and the request form, and turns the request form's approval-preview data into a persistent "if you send this now" rail.

## About the design files
The files in `designs/` are **HTML design references**, built as standalone prototypes to test layout, copy, and interaction — they are not production code and should not be copied into the Next.js app directly. The task is to **recreate these designs inside AWA's existing stack** (Next.js App Router, Tailwind v4, shadcn `base-ui/react` components, the existing `src/components/ui/*` primitives) using the app's real data, not the placeholder numbers shown here.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii and copy are final — pulled from `src/app/globals.css` and `docs/design-system-claude.md` (clay `#D97757` primary, warm-neutral grays, Source Serif 4 for headings, Geist/system-ui for UI text). Recreate pixel-close using the tokens already defined in `globals.css`; do not introduce new colors.

## Status of each screen
Every screen below is **built and functional** — not a static mockup. Click through each file in a browser before handing to a developer.

| Screen | File | What's wired up |
|---|---|---|
| Sidebar nav ("yours" vs "shared") | `AwaSidebarNew.dc.html` | Every row navigates; active state driven by `active` prop |
| Home / Today | `AWA Home.dc.html` | Clickable 7-stage bar; "Agree" / "Ask a question" show a live outcome message |
| Request form ("Ask for something") | `AWA Request Form.dc.html` | Add/remove/edit line items, live totals, live budget bar, Send/Draft actions with confirmation |
| Admin setup — "Start here" checklist | `AWA Start Here.dc.html` | Rule-template picker updates a live approval-chain rehearsal; "Turn this rule on" flips the page from "Not live yet" to "Live" and advances the progress bar |
| "How AWA works" / glossary | `AWA Help.dc.html` | Section nav switches content; clicking any underlined term or glossary chip updates the definition panel; search filters by keyword |
| Mobile approver flow | `AWA Mobile Approver.dc.html` | Full sign-in → inbox → decision flow; Agree/Ask/Send-back each show their real consequence text |
| Vendor portal | `AWA Vendor Portal.dc.html` | "Yes — we can supply this" confirms the PO and replaces the action card with a confirmation state |

Two things from the original option set are **not** included, by design: the guided first-task overlay (1b) — its content is functionally identical to "Start here" (1a) with a different presentation shell, and building both was redundant once 1a shipped as the real onboarding surface; and the full current-UI baseline / concept-options canvas doc, kept below only as reference, not part of the delivered design.

| Reference only (not for implementation) | File |
|---|---|
| All redesign options side-by-side, as originally proposed | `AWA — Redesign (concept options).dc.html` |
| Current shipped UI, screen by screen, captioned with source file | `AWA — Current UI (baseline).dc.html` |

## Screens

### Sidebar (`AwaSidebarNew.dc.html`)
- **Purpose**: primary navigation, restructured from 10 flat items into a pinned "Start here," a "Yours" group (3 items, badge counts), and "The rest of the process" group (4 items, badge counts, visually dimmer to signal shared/not-yours).
- **Layout**: 248px fixed width, flex column, `justify-content: space-between`. Background `#F3F3F0`, right border `1px solid rgba(11,11,11,0.08)`.
- **Components**:
  - Logo mark: 28×28px, `#D97757` bg, 6px radius, "A" in Source Serif 4 14px white.
  - "Start here" pinned row: bordered pill, `1px solid rgba(217,119,87,0.35)`, bg `rgba(217,119,87,0.07)` (or `.14` active), clay text `#C6613F`, compass icon.
  - Nav rows: 8px gap icon+label, 8px border-radius, active state `background: rgba(217,119,87,0.10)`, active text/icon `#D97757`; inactive `rgba(11,11,11,0.75)` (Yours) or `#8C8980` (Shared, dimmer by design).
  - Badge: pill, `11px` font, `rgba(11,11,11,0.06)` bg / `rgba(217,119,87,0.16)` if row active.
  - Icons: lucide-static SVGs via CSS mask (swap for the app's existing `lucide-react` icon set — same icon names: `house`, `clipboard-list`, `circle-check-big`, `search`, `truck`, `receipt`, `wallet`, `compass`, `book-open`, `chart-column`, `life-buoy`).
  - Footer: user chip with initials avatar (26px circle, sage `#BCD1CA` bg per the design system's decorative-accent palette).
- **Interactions**: clicking any row calls `onNav(key)` — wire to Next.js router `push()` per key → route.

### Home (`AWA Home.dc.html`)
- **Purpose**: replace the current `Today` page. Answers "where do I sit in the process" via a clickable seven-stage bar, then surfaces exactly what's waiting on the signed-in user.
- **Layout**: sidebar + main (flex, `padding: 32px 36px`, `gap: 24px`).
- **Components**:
  - Seven-stage bar: single row, `1px solid rgba(11,11,11,0.10)` border, `12px` radius, `overflow:hidden`. Each cell: `flex:1`, right border divider, "yours" cells tinted `rgba(217,119,87,0.07)` with a clay dot; formal name in `11.5px` `#9A968C`; count `20px` tabular-nums; sub-line colored `#C6613F` (yours) or `#9A968C` (shared).
    - Data source: `computeStage()` / `poStage()` / `invoiceStage()` in `src/lib/lifecycle.ts` already buckets every record into these 7 stages (`LIFECYCLE_STEPS`) — aggregate counts per stage server-side rather than inventing a new query.
    - "Yours" flag per stage: `stagesForRoles()` in `src/lib/roleStages.ts` already computes this from the signed-in user's roles.
  - "Waiting on you" panel: reuses the same data as the current `ActionRow` component on `dashboard/page.tsx` — just restyled, same underlying queries (`myApprovals`, `myRejected`, `openQueries`, `myDrafts`).
  - "Yours, on the map" panel: per-record mini version of the 7-segment bar (`4px` height segments, `2px` radius, `3px` gap) — this is a compact variant of the existing `LifecycleRail` component (`src/components/ui/lifecycle-rail.tsx`); consider adding a `compact` + `interactive` prop there rather than a new component.
  - Two footer CTAs ("Ask for something" / "Find out what happened to something") replace the dismissible `WelcomeCard`.
- **State removed**: the current `WelcomeCard.tsx` (`localStorage` dismiss pattern) is not carried forward — its content (role explanation, stage ownership) is now always-visible in the stage bar, so nothing needs dismissing.

### Request form (`AWA Request Form.dc.html`)
- **Purpose**: replace `src/app/dashboard/requisitions/RequisitionForm.tsx`. Same underlying fields and server actions, restructured into a form (left, 2/3 width) + persistent consequences rail (right, 330px, `border-left: 1px solid rgba(11,11,11,0.08)`).
- **Layout**: sidebar + main (flex, `gap: 28px`, `padding: 32px 36px`).
- **Components**:
  - Three `<fieldset>` groups — "What" (line items table, inline not tabular-header'd), "Who pays" (department/cost-centre selects + budget bar), "Why" (justification textarea). Legends: `12px` uppercase `#9A968C`, `0.06em` letter-spacing.
  - Line item row: Item (flex:1) / Qty (80px) / Price (120px) / line total (96px, right-aligned) / Remove. All existing fields from `LineInput` type in `requisitions/actions.ts` — no fields dropped, just relaid-out.
  - Budget bar: reuses the same two-segment bar already in the current `RequisitionForm.tsx` (`committed` segment `rgba(120,118,111,0.45)`, `this request` segment `#D97757`, amber `#F9B21A` if over budget) — copy this logic over unchanged.
  - Right rail "If you send this now": renders `previewApprovers()`'s existing `ApprovalPreview` result (approver chain with avatar-initial chips, decorative-accent colors per person e.g. `#CBCADB` lavender, `#BCD1CA` sage) plus three always-visible insight rows (budget status, duplicate-item warning, typical decision time) — these three rows are **new UI surfacing data the app doesn't currently expose together**; budget/duplicate data already exists (`db/budget.ts`, duplicate-detection tables per approvals inbox); "typical decision time" is net-new and needs a query (median time-to-decision by value bucket) or can ship as a static placeholder initially.
  - Buttons: primary "Send to [name]" (`#D97757` fill), secondary "Keep as a draft" (outline) — map to the existing `submit(true)` / `submit(false)` handlers in the current form.
- **Interactions**: add/remove line, live total recompute, live budget bar recompute — all client-state, matching the current form's existing `useState`/`useMemo` pattern; no new state-management approach needed.

## Design tokens
Pulled directly from `src/app/globals.css` / `docs/design-system-claude.md` — do not add new colors.
- Primary / clay: `#D97757`; emphasized/hover: `#C6613F`
- Background: `hsl(60 14.2857% 98.6275%)` (~`#FCFCFB`); foreground: `hsl(0 0% 4.3137%)` (~`#0B0B0B`)
- Borders: `rgba(11,11,11,0.08)` (hairline), `rgba(11,11,11,0.10–0.14)` (inputs)
- Warning: `hsl(40.8 95.7447% 53.9216%)` (~`#F9B21A`); success: `hsl(120 86.2857% 34.3137%)` (~`#0CA30C`); destructive: `hsl(0 61.3169% 52.3529%)` (~`#D03B3B`); info: `hsl(213.117 67.5439% 44.7059%)` (~`#256ABF`)
- Decorative accents (avatars/tags only, never status): sage `#BCD1CA`, lavender `#CBCADB`
- Radius: `0.625rem` base (10px), buttons/pills use `8px`–`999px` per component
- Type: Source Serif 4 (headings only), Geist/system-ui (all UI chrome) — matches existing `--font-serif` / `--font-sans` tokens
- Shadows: soft, overlay-only — no shadow on static cards (unchanged from current system)

## Assets
- Icons: lucide (same icon set already in use via `lucide-react`); prototype uses `unpkg.com/lucide-static` SVGs as a stand-in — swap for the installed `lucide-react` components.
- Avatars: initials-only, no images.

### Admin setup — "Start here" (`AWA Start Here.dc.html`)
- **Purpose**: replaces `src/app/dashboard/admin/page.tsx`. Same 5-step dependency order, but step 3 (approval rules) becomes an inline rule-template picker instead of a link out to a separate CRUD screen.
- **Components**: progress bar (4 segments, green=done/clay=current/grey=upcoming) mirrors the existing `doneCount / required.length` logic already in `admin/page.tsx`. Rule-template radio group (3 options: single-step, two-step, custom) drives a live "rehearsal" panel showing a real request routed through the selected rule, using avatar-initial chips in the same decorative accents as elsewhere (lavender `#CBCADB`, sage `#BCD1CA`). "Turn this rule on" should call the existing approval-rule-creation server action with a pre-filled rule matching the template chosen (single = one department-head step; two-step = department-head then finance-over-50000, matching the current seed rule shape in `db/approvalRulesYaml.ts`).
- **Note**: "custom" falls through to today's existing full rule-builder screen (`admin/approval-rules`) — no new UI needed for that path.

### "How AWA works" (`AWA Help.dc.html`)
- **Purpose**: gives `src/lib/glossary.ts` a browsable home instead of only being reachable via inline `<Term>` hovers.
- **Components**: left contents nav (6 sections, only "The seven stages" built out); center content area with the 7 stages as expandable cards; right glossary panel reproduces the existing `<Info>`/`<Term>` popover content (title / plain-language / why-it-matters) but pinned rather than hover-only, with a search box and quick-access chips. Every underlined term in the app should deep-link here with the right term pre-selected (e.g. `?term=goods-receipt`), not just open a popover — the popover can stay for quick hovers, this page is for someone who wants to read all of it.

### Mobile approver flow (`AWA Mobile Approver.dc.html`)
- **Purpose**: a responsive pass over the existing approvals inbox + sign-in, tuned for a manager who mostly meets AWA in a push notification.
- **Components**: 3 screens (sign-in, inbox, decision), each single-column, all touch targets ≥44px height. Decision screen's 3 buttons map 1:1 to the existing `approveRequirement` / add-a-query / `requestRevision` server actions in `dashboard/approvals/actions.ts` — same actions, reformatted as full-width stacked buttons with the consequence as a subtitle instead of inline help text.
- **Implementation note**: this should be a responsive breakpoint of the *same* approvals inbox and sign-in pages, not a separate mobile-only route — the content and actions are identical to desktop, only density and layout change.

### Vendor portal (`AWA Vendor Portal.dc.html`)
- **Purpose**: replaces `src/app/vendor-portal/page.tsx`. Turns raw status enums (`partially_fulfilled`) into a sentence describing what's owed and by whom, and makes "confirm the PO" the primary action instead of a small "View" link.
- **Components**: one card per PO, tone-coded by state (needs confirmation = clay border, part-delivered = neutral, finished = muted/grey). QR/hash trust panel reuses the existing `purchase_orders.documentHash` and QR token already generated at PO issuance (see README's Phase 2 notes on `/po-verify/[token]`) — just surfaced here instead of only on the PDF. "Yes — we can supply this" maps to the existing `vendor_confirmed_at/by` fields on `purchase_orders`.

## Files in this bundle
- `designs/AwaSidebarNew.dc.html` — sidebar
- `designs/AWA Home.dc.html` — home page
- `designs/AWA Request Form.dc.html` — request form
- `designs/AWA Start Here.dc.html` — admin onboarding checklist
- `designs/AWA Help.dc.html` — glossary / "How AWA works" page
- `designs/AWA Mobile Approver.dc.html` — mobile sign-in/inbox/decision flow
- `designs/AWA Vendor Portal.dc.html` — vendor-facing portal
- `designs/AWA — Redesign (concept options).dc.html` — reference only, the original side-by-side option set
- `designs/AWA — Current UI (baseline).dc.html` — reference only, today's UI for diffing

Open any `.dc.html` file directly in a browser (double-click, or drag into a browser tab) to view and click through it — every file listed above (except the two reference-only ones) is interactive.

## Applying this to the live app — step by step

These files are references to *build from*, not code to paste in. Here's the simplest path:

1. **Open each `.dc.html` file in a browser first.** Click through every screen and note anything that feels off before a developer starts — changes are far cheaper now than after implementation.
2. **Hand this whole folder to whoever builds it** — a developer on your team, or Claude Code pointed at your AWA repo. Tell them to start with this README; it names the exact source file each screen replaces.
3. **Build one screen at a time, in this order**, so each step is easy to test in isolation:
   - Sidebar nav (`DashboardNav.tsx`) — touches every page, do it first.
   - Home (`dashboard/page.tsx`).
   - Request form (`RequisitionForm.tsx`).
   - Admin "Start here" (`dashboard/admin/page.tsx`).
   - Help/glossary (new route, e.g. `dashboard/help/page.tsx`).
   - Mobile responsive pass on the approvals inbox + sign-in.
   - Vendor portal (`vendor-portal/page.tsx`).
4. **Reuse existing data and server actions — don't rewrite the backend.** Every screen above calls out which existing query, table, or server action it maps to. The redesign is a layout and copy change on top of what already works, not a new data model.
5. **Test each screen against real tenant data** before moving to the next — an empty tenant, a mid-flight tenant, and a fully-configured one, since a lot of this redesign is specifically about how those three states read to a new user.
6. **Ship behind a flag if you can**, screen by screen, rather than all at once — it's the same underlying data, so old and new can coexist while you roll it out.
