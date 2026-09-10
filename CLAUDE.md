# CLAUDE.md — NestureAI

AI working context for this repository. Read this before writing or changing code.
Deep-dive docs live in **`/skills`** (`project.md`, `frontend.md`, `backend.md`,
`database.md`, `security.md`, `deployment.md`) — consult the relevant one for the
area you're touching.

---

## 1. What this project is

**NestureAI** is a **1.0-Beta EdTech platform for non-speaking and motor-impaired
children**. It combines webcam **hand-tracking games** (occupational-therapy
practice), an AI-built **Atlas 360°** child profile from clinical documents, and
**role-based dashboards** for Parents, Occupational Therapists (OT /
"practitioner"), Learners, and Admins.

> **It is NOT a medical/diagnostic tool.** Every motion and AI output is an
> *educational inference about developmental movement patterns*. This shapes the
> data model, the copy, and compliance — treat it as a hard constraint.

**Compliance:** COPPA (under-13, learners have no email/PII), FERPA (private,
consent-gated educational records), SOC 2 posture (RLS, audit logs, least
privilege).

---

## 2. Architecture rules

- **Stack:** React 18 SPA (**Create React App / react-scripts 5.0.1**, not Vite) +
  **Supabase** (PostgreSQL 17, Auth, Storage, Deno/TS Edge Functions). Stripe for
  billing; Groq + OCR.Space + Anthropic Claude for AI.
- **There is no standalone API server.** The old FastAPI backend was replaced by
  an axios-shaped shim, `src/services/api.js`, that maps REST-looking calls onto
  `src/services/supabaseDB.js`. **Do not reintroduce a separate API server**, and
  do not import `supabaseDB.js` into pages — go through `api.js`.
- **Two data layers:** Supabase (`supabaseDB.js`, authoritative) and an IndexedDB
  fallback (`localDB.js`, legacy) behind the same `api.js` interface.
- **Secrets never reach the browser** except `REACT_APP_SUPABASE_URL` /
  `REACT_APP_SUPABASE_ANON_KEY`. All service keys, Stripe, and AI keys live only
  as Supabase Function secrets.
- **RLS is on for every table.** Frontend is RLS-limited; edge functions run as
  `service_role` and must re-check ownership/consent themselves.
- **Auth = Supabase Auth.** Email verification is mandatory; login role must match
  the selected tab; learners log in by pseudonym (no email).

---

## 3. Coding standards

- Function components + hooks only. Pages `.jsx`; services/utils/hooks `.js`.
  PascalCase components, `useX` hooks, one CSS file per feature in `src/styles/`.
- No CSS framework and no CSS-in-JS lib — plain CSS + inline styles (match
  existing files). Charts via **Recharts**, animation via **Framer Motion**
  (honor `prefers-reduced-motion`), icons via **lucide-react**, toasts via
  **react-hot-toast**.
- User-facing strings go through i18next `t('key', 'fallback')`; add keys under
  `src/locales/en/`.
- Log with a `[Scope]` prefix; show user errors via toast, wrap risky UI in
  `ErrorBoundary`.
- MediaPipe runs **on-device**; webcam frames must not leave the client.
- Validate + sanitize all input at the boundary (`utils/security.js`,
  `authService.js`); cap string lengths; never concatenate SQL.
- Edge functions: answer CORS `OPTIONS`, read secrets via `Deno.env.get`, fail
  loudly (500) on missing secrets, validate inputs and return `400` early.

---

## 4. Non-diagnostic language (MANDATORY)

In UI copy, docs, and AI prompts:
- **Use:** support plan, learning plan, professional assessment, movement
  activities, practice sessions, evidence-backed, recommended.
- **Never use:** treatment plan, prescribe, clinical, therapeutic, patient,
  medical, diagnose.

---

## 5. Things to avoid

- ❌ Adding a separate backend server, or bypassing the `api.js` shim from pages.
- ❌ Requiring an email or collecting PII in the learner flow (breaks COPPA).
- ❌ Putting any secret in `REACT_APP_*` or client code.
- ❌ Creating a user-owned table without RLS policies in the same migration.
- ❌ Making the `patient-documents` bucket public, or deleting child data without
  an audit-log row.
- ❌ Committing real credentials in SQL/source. Historical migrations seed a demo
  admin (`admin@gmail.com` / `admin123`) and an admin email appears in
  `App.js` — these are prototype artifacts to remove for prod, **not** patterns to
  copy.
- ❌ Shipping the Stripe webhook without `STRIPE_WEBHOOK_SECRET` (it otherwise
  skips signature verification).
- ❌ Removing the nginx SPA fallback, the logout `sessionStorage/localStorage`
  clear, or the learner email/password suffix scheme.
- ❌ Growing the already-huge page files (`GamePage.jsx`, `AdminDashboard.jsx`,
  `ParentDashboard.jsx`) — extract into `components/`/`hooks/` instead.

---

## 6. Testing requirements

- **Unit (Jest):** `npm test`. New pure logic (scoring, filters, detectors) ships
  a colocated `*.test.js`.
- **E2E (Playwright):** `npm run test:e2e` — suites for auth, onboarding,
  dashboard, exercises, admin, responsive, security, and **accessibility**
  (`axe-playwright`). Runs across chromium/safari/ipad/iphone/pixel.
- **Accessibility is a gate** — the axe suite must pass; the audience includes
  children and assistive-tech users.
- Verify a change end-to-end with the relevant demo account before calling it
  done.

---

## 7. Common commands

```bash
npm start                 # dev server (localhost:3000)
npm run build             # production bundle → build/
npm test                  # Jest unit tests
npm run test:e2e          # Playwright e2e + a11y
supabase db push          # apply migrations
supabase functions deploy <name> [--no-verify-jwt]
```

See `/skills/deployment.md` for the full deploy + release checklist.
