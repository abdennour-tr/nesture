# Skill: Backend — Supabase Edge Functions & Integrations

> The server side of NestureAI is **Supabase**: Postgres + Auth + Storage +
> **Deno/TypeScript Edge Functions**. There is no standalone API server. Read
> `project.md` for domain, `database.md` for schema, `security.md` for RLS.

---

## 1. Overview

All backend logic that can't run in the browser (secrets, `service_role` writes,
third-party APIs, Stripe signatures) lives in **Supabase Edge Functions** under
`supabase/functions/*`, each an `index.ts` served by
`https://deno.land/std/http/server.ts`. They use the Supabase JS client from
`esm.sh` and run with the **service role key**, deliberately bypassing RLS — so
every function must do its own authorization checks.

---

## 2. Edge functions

| Function | Purpose | Key secrets |
|---|---|---|
| `process-document` | OCR + AI extraction pipeline for uploaded clinical docs → structured Atlas fields | `GROQ_API_KEY(S)`, `OCR_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| `calculate-atlas-profile` | Builds the 12-domain Atlas 360° profile from questionnaire + documents | `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| `create-checkout-session` | Creates a Stripe Checkout session for a plan | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_*` |
| `create-portal-session` | Opens the Stripe customer billing portal | `STRIPE_SECRET_KEY` |
| `stripe-webhook` | Verifies Stripe events, writes `subscriptions` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| `create-learner-account` | Provisions a learner (pseudonym) auth user + `children` link | `SUPABASE_SERVICE_ROLE_KEY` |
| `reset-learner-password` | Admin/parent-driven learner password reset | `SUPABASE_SERVICE_ROLE_KEY` |
| `delete-document` | Hard-deletes a document + storage object, writes audit log | `SUPABASE_SERVICE_ROLE_KEY` |

---

## 3. AI / integration stack

### Document parsing — Groq (`process-document`)
- OCR via **OCR.Space** (or Llama-3 vision path) turns PDFs/images into text.
- Extraction via **Groq** chat completions, model **`llama-3.1-8b-instant`**,
  `response_format: { type: "json_object" }`, `temperature: 0.2`.
- **Key rotation:** reads `GROQ_API_KEYS` (comma-separated) **and** `GROQ_API_KEY`,
  rotating on 429 / rate-limit / `organization_restricted` responses. Preserve
  this fallback loop — the shared org daily token quota is a real constraint.

### Atlas profile — Anthropic Claude (`calculate-atlas-profile`)
- Fetches `children` + questionnaire responses, calls the Anthropic API
  (`ANTHROPIC_API_KEY`) to synthesize the profile, writes `atlas_profiles` with
  `service_role`. Requires a valid `childId` in the request body.

### Payments — Stripe
- **Plans** (`create-checkout-session`): `7day_pass` (1 child, no trial),
  `premium` (1 child, 14-day trial), `family` (unlimited, 14-day trial),
  `annual_family` (unlimited, 14-day trial). Legacy tier aliases:
  `starter→premium`, `growth→family`, `enterprise→annual_family`.
- Prices come from env keys `STRIPE_PRICE_7DAY_PASS`, `STRIPE_PRICE_PREMIUM`,
  `STRIPE_PRICE_FAMILY`, `STRIPE_PRICE_ANNUAL_FAMILY` — never hardcode price IDs.
- **Webhook** (`stripe-webhook`): verifies the `stripe-signature` with
  `constructEventAsync` when `STRIPE_WEBHOOK_SECRET` is set, updates the
  `subscriptions` table (`VALID_PLAN_TYPES` guard, `current_period_end`,
  `trial_end`, `cancel_at_period_end`). Stripe API version pinned `2023-10-16`,
  `Stripe.createFetchHttpClient()` for Deno.

---

## 4. Conventions & standards

- **CORS:** every function returns the shared `corsHeaders` and answers `OPTIONS`
  preflight with `"ok"`. Keep this on every new function.
- **Client construction:** `createClient(supabaseUrl, serviceRoleKey, { auth: {
  autoRefreshToken: false, persistSession: false } })` for admin clients.
- **Secrets:** always `Deno.env.get(...)`; fail with a 500 + logged message when a
  required secret is missing (never proceed with a placeholder).
- **Responses:** JSON with explicit HTTP status; `Content-Type: application/json`
  merged into `corsHeaders`. Validate required inputs and return `400` early.
- **Never trust the caller's role from the JWT alone** for privileged writes —
  because functions run as `service_role`, re-check ownership/consent against the
  DB before mutating another user's data.
- Some functions carry French log/error strings (legacy). New user-facing copy
  should follow the non-diagnostic language rules in `project.md` §6.

---

## 5. Common workflows

- **Deploy a function:**
  ```bash
  supabase functions deploy process-document --no-verify-jwt
  ```
  (`--no-verify-jwt` is used where the function does its own auth, e.g. the doc
  pipeline and Stripe webhook.)
- **Set secrets:** Supabase Dashboard → Edge Functions → *function* → Secrets, or
  `supabase secrets set GROQ_API_KEY=...`.
- **Local dev:** `supabase start` boots Postgres (54322), API (54321), Studio
  (54323); functions run via `supabase functions serve`.

---

## 6. Best practices

- Keep third-party model names and API versions pinned and centralized; a model
  swap (e.g. Groq model, Stripe API version) is a deliberate, reviewed change.
- Log with enough context to debug but **never log secrets, document contents, or
  child PII**.
- The document pipeline is the most complex function (~50 KB) — change it in small
  steps and test against a real sample document in a non-prod project.
- When adding a function that writes to a user-owned table, add the matching RLS
  reasoning to `security.md` and confirm the frontend calls it via `api.js` or a
  dedicated service, not ad-hoc `fetch`.
