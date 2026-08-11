# Adopting the Claude design language for AWA

This is a brief for restyling AWA's UI to look and feel like Claude.ai. Token values below marked **[confirmed]** were pulled live from claude.ai's shipped CSS (custom properties + computed styles on the sign-in page, light and dark) — not guessed. Values marked **[estimated]** are inferred from the same token set but weren't directly visible on an unauthenticated page (the in-app chat surfaces require login, so sidebar/message-bubble treatments couldn't be inspected directly).

## 1. What "Claude design" actually is

- **Warm, not neutral.** Backgrounds and grays are cream/off-white, not pure white or gray. Text is near-black, not `#000`.
- **One accent color, used sparingly.** A single terracotta/clay tone carries all primary actions, the logo mark, and focus states. Everything else is grayscale.
- **Serif for voice, sans for interface.** Headlines and marketing copy use a serif; all UI chrome (buttons, labels, inputs, nav) uses a grotesque sans. This split is deliberate — don't use the serif for buttons/forms.
- **Soft, minimal chrome.** Low-opacity black borders instead of solid gray lines, very soft shadows (barely-there, used mostly on overlays/modals not static cards), generous whitespace, rounded corners on interactive surfaces (inputs, cards) rather than sharp edges.
- **Restraint over decoration.** No gradients, no heavy iconography, no busy color-coding — status/semantic color (success/warn/error/info) exists but is used narrowly.

## 2. Design tokens

### Color

| Token | Value | Source |
|---|---|---|
| Brand / primary (clay) | `#D97757` | **[confirmed]** `--cds-clay` |
| Brand emphasized (hover/active) | `#C6613F` | **[confirmed]** `--cds-clay-emphasized` |
| Background (light) | `#FCFCFB` | **[confirmed]** computed `body` bg, light mode |
| Foreground (light) | `#0B0B0B` | **[confirmed]** computed `body` color, light mode |
| Background (dark) | `#151515` | **[confirmed]** computed `body` bg, dark mode (marketing page — in-app surfaces may use a slightly different step, see gray scale below) |
| Foreground (dark) | `#FFFFFF` | **[confirmed]** computed `body` color, dark mode |
| Neutral scale | warm-tinted grays, hue ~45–60° (not 0° neutral gray) at the light end, flattening toward true black at the dark end — 15+ steps from `hsl(60,14%,99%)` down to `hsl(0,0%,4%)` | **[confirmed]** `--cds-hsl-gray-*` (0–900) |
| Info | blue, mid step ≈ `hsl(213,68%,45%)` | **[confirmed]** `--cds-hsl-blue-500` |
| Success | green, mid step ≈ `hsl(120,86%,34%)` | **[confirmed]** `--cds-hsl-green-400` |
| Warning | yellow/amber ≈ `hsl(41,96%,54%)` | **[confirmed]** `--cds-hsl-yellow-200` |
| Danger | red ≈ `hsl(0.4,73%,59%)` | **[confirmed]** `--cds-hsl-red-400` |
| Decorative accents (used sparingly, e.g. avatars/tags) | sage `#BCD1CA`, lavender `#CBCADB`, teal `#629987`, purple `#827DBD` | **[confirmed]** `--cds-cactus`, `--cds-heather`, `--cds-mineral`, `--cds-plum` |

### Shape & elevation

| Token | Value | Source |
|---|---|---|
| Base radius | `0.25rem` (4px) | **[confirmed]** `--cds-radius` |
| Input radius (observed) | `0.625rem` (10px) | **[confirmed]** computed on sign-in inputs — radius is contextual, not one flat scale; interactive/contained fields get a larger radius than the base token |
| Shadow (sm) | `0 1px 2px 0 rgb(0 0 0 / 5%)` | **[confirmed]** `--cds-shadow-sm` |
| Shadow (md) | `0 4px 6px -1px rgb(0 0 0 / 10%), 0 2px 4px -2px rgb(0 0 0 / 10%)` | **[confirmed]** `--cds-shadow-md` |
| Shadow (lg) | `0 10px 15px -3px rgb(0 0 0 / 10%), 0 4px 6px -4px rgb(0 0 0 / 10%)` | **[confirmed]** `--cds-shadow-lg` |

### Typography

| Role | Family | Source |
|---|---|---|
| UI / body | `anthropic-sans` → falls back to `system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` | **[confirmed]** `--font-anthropic-sans` |
| Headlines / display | `anthropic-serif` → falls back to `Georgia, Times` | **[confirmed]** `--font-anthropic-serif`, visually confirmed on the "Question what's next" hero |
| Code / mono | `anthropic-mono` → falls back to `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas` | **[confirmed]** `--font-anthropic-mono` |
| Weights in use | 400 (regular), 500 (medium), 580 (semibold — non-standard step), 600 (bold) | **[confirmed]** `--cds-font-weight-*` |

**Licensing note:** `anthropic-sans`, `anthropic-serif`, and `anthropic-mono` are Anthropic's proprietary typefaces — they aren't shipped as downloadable font files and AWA has no license to use them. Match the *feel*, not the exact files:
- Sans substitute: **Inter** or **Söhne**-alike (already close to the fallback stack Claude itself uses).
- Serif substitute for headlines: **Source Serif 4**, **Newsreader**, or **Lora** — all free, warm literary serifs in the same family as the fallback (`Georgia`/`Times`).
- Mono: system mono stack is fine as-is (`ui-monospace, SFMono-Regular, Menlo, Consolas`).

## 3. Component/layout patterns to carry over

- **Cards**: white/cream surface, hairline border (`black @ 5–10% opacity`, not a solid gray), no shadow at rest; shadow only appears on hover or for floating elements (menus, modals, tooltips).
- **Buttons**: primary = solid clay fill, white text; secondary = transparent/outline with the warm-gray border; ghost = text-only, gray, clay on hover. No gradients.
- **Inputs**: soft rounded (10px-ish), subtle background tint rather than a hard border, clay-colored focus ring.
- **Sidebar/nav** (typical of the app shell): flat warm-gray panel slightly darker/lighter than the main canvas, not a bordered box.
- **Status color** stays narrow: reserve red/green/yellow for actual state (errors, success toasts, warnings) — don't use the decorative accents (sage/lavender/teal/purple) for status, those read as purely decorative (tags, avatar backgrounds).
- **Dark mode**: background steps down through the warm-neutral scale (never pure black), text stays nearly-white, clay accent stays the same hue but is used a bit less saturated/emphasized variant for contrast.

## 4. Mapping onto AWA's current setup

Current stack (checked in this repo): [components.json](../components.json) — shadcn `base-nova` style, `base-ui/react` (not Radix), Tailwind v4, `baseColor: neutral`, radius `0.625rem`, all-grayscale OKLCH tokens in [globals.css](../src/app/globals.css) — no brand color defined yet.

Concrete changes needed in `src/app/globals.css`:
1. Replace the neutral OKLCH grays (`oklch(0.97 0 0)` etc., all hue 0) with warm-tinted equivalents (small positive hue, ~50-60° in HSL terms) for `--background`, `--card`, `--muted`, `--border`, `--sidebar*`.
2. Add `--primary` = clay `#D97757` (`oklch` equivalent) and `--primary-foreground` = white; keep `--accent`/`--secondary` as warm neutrals, not clay — clay stays reserved for primary actions per Claude's "one accent" rule.
3. Set `--destructive` to the confirmed red step, and add success/warning CSS vars (shadcn's default token set doesn't ship these — needed for toasts/badges across the procurement workflows: PO approvals, invoice matching, etc.).
4. `--radius` can likely stay close to current (`0.625rem` already matches the observed Claude input radius) — no change needed there.
5. Add `--font-serif` (Source Serif 4 or similar) for page headings/empty-states only; keep `--font-sans` for all form/table/nav chrome.
6. Shadows: current shadcn defaults are already close in spirit (soft); just make sure card-at-rest has no shadow and only overlays (dialogs, dropdowns, popovers) get one.

## 5. Decisions

- **Scope: full re-theme.** Colors, typography (serif for headings), spacing, radius, and shadows all get updated together rather than an accent-only pass.
- **Dark mode: deferred.** Ship light mode first; `globals.css` already scaffolds a `.dark` block, so wiring warm-neutral dark tokens later is a clean follow-up, not a rewrite.

## 6. Decisions (cont'd)

- **Brand distance: intentional.** "Claude-inspired" is the goal — no use of the sunburst mark or "Claude" wordmark, but the clay hue + serif headline pairing is deliberate, not something to avoid.
- **Rollout order: dashboard shell first** (nav/sidebar/app chrome in `src/app/dashboard/`), then the rest of the app follows.
