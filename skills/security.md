# Skill: Security & Compliance

> NestureAI handles children's educational and developmental data, so security is
> a first-class product requirement, not an afterthought. This file is the
> authority on auth, authorization, input safety, secrets, and COPPA/FERPA/SOC 2
> obligations. Read `database.md` for the RLS mechanics it references.

---

## 1. Compliance envelope (non-negotiable)

- **COPPA** — children under 13. Learners **never** provide an email or personal
  contact info. They authenticate with a pseudonym mapped internally to
  `<pseudonym>@learner.nestureai.com`. Do not add email/PII collection to the
  learner flow.
- **FERPA** — uploaded documents are educational records: private storage,
  consent-gated access, auditable deletion.
- **SOC 2 posture** — least privilege, RLS on every table, audit logging of
  privileged actions (deletions, impersonation, decisions), private buckets.
- **Non-diagnostic** — the platform must not present itself as medical. Enforce
  the language allow/deny list (`project.md` §6) in UI, AI prompts, and docs.

---

## 2. Authentication

- **Provider:** Supabase Auth (email+password). Session persisted by
  `supabaseClient.js` (`autoRefreshToken`, `persistSession`,
  `detectSessionInUrl`, `localStorage`).
- **Email verification is mandatory** — `signIn`/`restoreSession` reject any user
  without `email_confirmed_at` and sign them back out.
- **Role must match the login tab** — `signIn({ expectedRole })` signs the user
  out and throws if `profile.role !== expectedRole`. This blocks a parent from
  entering the OT dashboard and vice versa.
- **Learner scheme:** username without `@` → dummy learner email; learner password
  gets a `_learner_suffix` before Supabase Auth; learner min password length is 4
  (vs 8 for adults). This is deliberate COPPA design — keep it intact.
- **Account state:** `is_active === false` blocks login (deactivated accounts).
- **Profile fallback:** if the DB trigger hasn't created `public.users` yet,
  `ensureUserProfileFallback` / `ensureUserRow` create it post-verification.
- **Logout hygiene:** `signOut()` clears **both** `sessionStorage` and
  `localStorage` to prevent cross-child / cross-session data leakage.

---

## 3. Authorization (RLS + consent)

- **RLS enabled on all tables** (see `database.md` §4). The frontend can only
  read/write what policies allow; edge functions use `service_role` and therefore
  **must re-check ownership/consent themselves**.
- **Consent-based OT access:** an OT sees a child only through an accepted
  `practitioner_children` link. Revoking consent
  (`revokeConsentForPractitioner`) deletes that link and stamps
  `consent.withdrawal_at`. Never expose a child's data to an OT without a live
  link.
- **Admin impersonation** (`useAuthStore.impersonate` + `ImpersonationBanner`):
  admins can view another user's dashboard. Every impersonation must be visibly
  banner-flagged and logged to `admin_impersonation_logs`. Do not add silent
  impersonation.

---

## 4. Input validation & sanitization

Two validation modules enforce strict, injection-resistant input:

- `utils/security.js` — `sanitizeInput` (trims, strips `<...>` HTML/script tags,
  truncates), `validateName` (2–50 chars, `NAME_REGEX`), `validateNickname`
  (2–30, alphanumeric/`_`/`-`, no `@`), `validateEmail` (RFC-ish, ≤255,
  lowercased), `validateDateNotFuture`, `validateAgeRange` (0–80),
  `validatePassword` (≥8 adults / ≥4 learners, ≤72).
- `authService.js` mirrors the email/name/password validators at the auth
  boundary.

Rules: **validate at the boundary** (form + service), reject rather than coerce
unexpected characters, cap all string lengths (Postgres/bcrypt limits — passwords
≤72 bytes), and never build SQL by string concatenation (use the Supabase client /
parameterized RPC).

---

## 5. Secrets management

- **Frontend:** only `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY`
  are exposed to the browser (anon key is public by design; it is safe **only
  because RLS is correct**). No service keys, Stripe secrets, or AI keys ever go
  in `REACT_APP_*` or client code.
- **Backend:** `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`, `GROQ_API_KEY(S)`, `OCR_API_KEY`,
  `ANTHROPIC_API_KEY` live only as Supabase Function secrets (`Deno.env.get`).
- `.env`, `.env.local`, `.env.*.local` are gitignored. **Never commit real keys.**

---

## 6. Storage security

- Bucket **`patient-documents` is private** (never public). Policies: authenticated
  users `INSERT`/`SELECT` their own files; `service_role` manages `DELETE`.
- Document deletion goes through the `delete-document` edge function, which removes
  the storage object **and** writes `deletion_audit_log`.

---

## 7. Known risks / things to fix, not copy

- **Hardcoded demo/admin credentials exist in historical migrations** (e.g. a
  seeded `admin@gmail.com` with a bcrypt hash of `admin123`, and an admin email
  string in `App.js`'s impersonation banner). These are **prototype artifacts** —
  do **not** ship them to production; rotate/remove seeded admins and never
  hardcode a real credential in SQL or source.
- **Stripe webhook** falls back to unverified `JSON.parse` when
  `STRIPE_WEBHOOK_SECRET` is unset — production **must** set the secret so
  signatures are verified.
- **CORS `Access-Control-Allow-Origin: "*"`** on edge functions is broad; tighten
  to the app origin for production where feasible.
- **`config.toml` network restrictions** are wide open (`0.0.0.0/0`) for local dev;
  restrict in production.

---

## 8. Security checklist for changes

- [ ] Does this touch child data? If so, is it consent- and RLS-gated?
- [ ] Any new input is validated + sanitized at the boundary and length-capped.
- [ ] No secret added to client code or `REACT_APP_*`.
- [ ] New user-owned table ships RLS policies in the same migration.
- [ ] Any deletion of child data writes an audit log row.
- [ ] Privileged edge-function writes re-verify ownership (don't trust the JWT).
- [ ] UI/AI copy respects the non-diagnostic language rules.
