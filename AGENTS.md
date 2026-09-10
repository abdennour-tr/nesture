# AGENTS.md — NestureAI

How an AI coding agent should behave in this repository. Pair this with
**`CLAUDE.md`** (project rules) and **`/skills`** (deep-dive docs). When a rule
here conflicts with a user instruction, follow the user; when it conflicts with
the code, trust the code and flag the doc.

---

## 1. Agent behavior

- **Read before writing.** Start from `CLAUDE.md`, then the `/skills` file for the
  area (frontend / backend / database / security / deployment). Open the actual
  files you'll change — many pages are large and stateful.
- **Small, surgical diffs.** Prefer targeted edits over rewrites. Never grow the
  giant page files (`GamePage.jsx`, `AdminDashboard.jsx`, `ParentDashboard.jsx`);
  extract shared logic into `components/` or `hooks/`.
- **Respect the guardrails in `CLAUDE.md` §5** (no new backend server, no PII in
  the learner flow, no secrets in client code, RLS on new tables, non-diagnostic
  language). Treat them as blocking.
- **Never invent product facts.** If behavior isn't in the code or `/skills`, say
  so; don't fill gaps with assumptions.
- **Handle children's data as sensitive by default.** When in doubt about consent,
  privacy, or compliance, stop and ask rather than proceed.
- **Keep secrets out of logs, output, and commits.**

---

## 2. Planning workflow

1. **Restate the goal** in one or two sentences and identify the layer(s) touched
   (UI page, service/shim, engine, edge function, migration, tests).
2. **Locate the seams:** which route in `App.js`, which `api.js` handler +
   `supabaseDB.js` function, which table/RLS policy, which env/secret.
3. **Draft a short plan** (a task list for anything ≥3 steps) and note the
   verification step up front.
4. **Check cross-cutting impact:** does this touch auth, consent, RLS, billing, or
   compliance language? If yes, review `security.md` before coding.
5. **Confirm ambiguous scope** with the user (deliverable format, which role/flow)
   before large changes; proceed with a stated assumption only when unattended.

---

## 3. Code review checklist

- [ ] **Correctness** — does it do what was asked; edge cases and error paths
      handled; loading/empty/error UI states covered.
- [ ] **Architecture** — pages talk to data via `api.js`, not `supabaseDB.js`
      directly; no new server; engines/util logic stays pure and testable.
- [ ] **Security** — input validated + sanitized + length-capped; no secret in
      `REACT_APP_*`/client; new tables have RLS in the same migration; privileged
      edge writes re-verify ownership/consent; deletions audit-logged.
- [ ] **COPPA/FERPA** — no learner PII/email added; documents stay private;
      consent respected.
- [ ] **Language** — copy/AI prompts use the approved non-diagnostic vocabulary.
- [ ] **Consistency** — plain CSS in `styles/`, Recharts/Framer Motion/lucide,
      i18n via `t()`, `[Scope]` logs, `prefers-reduced-motion` honored.
- [ ] **On-device tracking** — no webcam data leaves the client.
- [ ] **Tests** — new pure logic has a `*.test.js`; relevant Playwright suite still
      passes, including accessibility.
- [ ] **Migrations** — dated, idempotent, one logical change; no real credentials.

---

## 4. Debugging process

1. **Reproduce** with the matching demo account (parent `jennifer@example.com`, OT
   `sarah@example.com`, learner `akhil`, all `password123`) and the exact route.
2. **Localize the layer:**
   - UI/state → React DevTools, `useAuthStore`/`useSessionStore`, console `[Scope]`
     logs.
   - Data → check the `api.js` handler and the `supabaseDB.js` function; inspect
     the Supabase query and **RLS** (a silent empty result is often an RLS denial,
     not missing data). Watch for policy **recursion** errors (see `database.md`).
   - Tracking/games → verify MediaPipe landmarks, simulation mode, and per-difficulty
     thresholds; check the reflex frame buffer/windowing.
   - Backend → read the edge function logs (`supabase functions logs <name>`);
     confirm required secrets are set (missing secret → 500).
   - Billing → Stripe dashboard events vs `stripe-webhook` logs and the
     `subscriptions` row.
3. **Confirm the root cause** before patching; add/adjust a test that would have
   caught it.
4. **Avoid rabbit holes** — after 2–3 failed attempts on the same path, step back,
   summarize findings, and ask for guidance.

---

## 5. Testing process

- Run **`npm test`** for touched pure logic; add a colocated `*.test.js` for new
  scoring/filter/detector code.
- Run **`npm run test:e2e`** (or the specific suite in `tests/`) for flow changes;
  the **accessibility** suite (`axe-playwright`) is a required gate.
- For UI, manually walk the flow across at least one desktop and one tablet/mobile
  Playwright project (webcam games must work on tablets).
- Never mark work done with failing tests, partial implementation, or unresolved
  errors — keep the task in progress and note the blocker instead.

---

## 6. Deployment process

Follow `/skills/deployment.md`. In short:

1. Ensure the target environment's `REACT_APP_SUPABASE_URL/ANON_KEY` are set —
   they are **baked into the CRA build**.
2. `npm run build`; build the prod image (`Dockerfile.prod` → nginx). Keep the SPA
   fallback config.
3. `supabase db push` migrations to the target project.
4. Deploy each edge function (`--no-verify-jwt` where it self-authorizes) and set
   **all** secrets (Groq/OCR/Anthropic/Stripe) — no placeholders.
5. Confirm the `patient-documents` bucket is private with correct policies, and the
   Stripe webhook secret is set (so signatures verify).
6. **Pre-prod safety:** remove any seeded/demo admin credentials, and tighten the
   dev-wide CORS/network CIDR defaults.
7. Run the full release checklist in `deployment.md` §6 before shipping.

---

## 7. Escalate to a human when…

- A change would weaken COPPA/FERPA posture, RLS, or consent gating.
- A migration is destructive or alters cascade/delete behavior on child data.
- Billing/webhook logic or seeded credentials are involved.
- Requirements are ambiguous in a way that changes user-facing behavior for
  children or clinicians.
