# Skill: Deployment, Build & Testing

> How to run, test, build, and ship NestureAI. The frontend is a static CRA build
> served by nginx in a container; the backend is Supabase (hosted) with
> CLI-deployed edge functions.

---

## 1. Local development

```bash
npm install
npm start            # CRA dev server → http://localhost:3000
```

Environment (create `.env`, gitignored):
```
REACT_APP_SUPABASE_URL=https://<project-ref>.supabase.co
REACT_APP_SUPABASE_ANON_KEY=<anon key>
```
Without these, `supabaseClient.js` falls back to a `placeholder` URL/key and
nothing will authenticate.

Demo logins: `jennifer@example.com` / `password123` (parent),
`sarah@example.com` / `password123` (OT), learner `akhil` / `password123`.

### Local Supabase (optional)
`supabase/config.toml` defines local ports: API `54321`, DB `54322`, Studio
`54323`, Inbucket `54324`, pooler `54329`. `auth.site_url` is
`http://127.0.0.1:3000`. Run `supabase start`, `supabase db reset` (applies
migrations + `seed.sql`), `supabase functions serve` for functions.

---

## 2. Build

```bash
npm run build        # → build/ (hashed static assets, asset-manifest.json)
```

The repo also ships a checked-in `build/` directory (an older artifact) — the CI
build regenerates it; don't hand-edit files under `build/`.

---

## 3. Docker

Two images:

- **`Dockerfile` (dev):** `node:20-alpine`, `npm install`, `npm start`, exposes
  `3000`. For local containerized dev.
- **`Dockerfile.prod` (prod):** multi-stage —
  1. `node:20-alpine` builder: `npm ci` → `npm run build`.
  2. `nginx:alpine`: copies `build/` to `/usr/share/nginx/html`, uses
     `nginx-frontend.conf`, exposes `80`.

```bash
# Production image
docker build -f Dockerfile.prod -t nesture-frontend:prod .
docker run -p 80:80 nesture-frontend:prod
```

`nginx-frontend.conf`: SPA fallback (`try_files ... /index.html`), 1-year immutable
cache for static assets, `no-store` for `index.html`. Because routing is
client-side (react-router), the SPA fallback is required — don't remove it.

> Build-time env: `REACT_APP_*` values are **baked into the bundle at build time**
> (CRA), so the production build must be built with the correct Supabase project
> URL/anon key for that environment.

---

## 4. Backend deployment (Supabase)

```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>

# Migrations
supabase db push                     # apply supabase/migrations/*

# Edge functions (deploy each; --no-verify-jwt where the fn self-authorizes)
supabase functions deploy process-document --no-verify-jwt
supabase functions deploy calculate-atlas-profile
supabase functions deploy create-checkout-session
supabase functions deploy create-portal-session
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy create-learner-account
supabase functions deploy reset-learner-password
supabase functions deploy delete-document

# Secrets (per project)
supabase secrets set GROQ_API_KEY=... OCR_API_KEY=... ANTHROPIC_API_KEY=... \
  STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... \
  STRIPE_PRICE_PREMIUM=... STRIPE_PRICE_FAMILY=... \
  STRIPE_PRICE_7DAY_PASS=... STRIPE_PRICE_ANNUAL_FAMILY=...
```

Storage: create private bucket **`patient-documents`** with the RLS policies in
`security.md` §6. Point the Stripe webhook endpoint at the deployed
`stripe-webhook` URL and set `STRIPE_WEBHOOK_SECRET` so signatures are verified.

---

## 5. Testing

- **Unit (Jest / CRA):** `npm test`. Colocated `*.test.js` / `*.test.jsx` for pure
  logic (`utils/activeHandSelector`, `handPointerFilter`, `pianoTapDetector`,
  `pointerMotion`, `pages/TraceTypeGame`). New pure logic should ship a test.
- **E2E (Playwright):** `npm run test:e2e` (headless), `npm run test:e2e:ui`.
  Config `playwright.config.js`: `testDir ./tests`, base URL
  `http://localhost:3000`, auto-starts `npm start` via `webServer`
  (`reuseExistingServer: true`), trace on first retry, screenshot on failure.
  Projects: **chromium, safari, ipad, iphone, pixel** — mobile/tablet coverage is
  intentional (webcam games must work on tablets).
- **Suites** (`tests/`): `auth`, `onboarding`, `dashboard`, `exercises`,
  `admin`, `responsive`, `security`, and `accessibility` (uses `axe-playwright`).
- **Accessibility is a gate** — run the axe suite; children + assistive-tech users
  are the audience.

---

## 6. Release checklist

- [ ] `npm run build` succeeds with the target environment's `REACT_APP_*` values.
- [ ] `npm test` and `npm run test:e2e` (incl. accessibility) green.
- [ ] Migrations pushed to the target Supabase project.
- [ ] All edge functions deployed and secrets set (no placeholders).
- [ ] `patient-documents` bucket private with correct policies.
- [ ] Stripe webhook secret configured and endpoint verified.
- [ ] No seeded/demo admin credentials in the production database (see
      `security.md` §7).
- [ ] Prod CORS / network CIDRs tightened from the dev-wide defaults.
