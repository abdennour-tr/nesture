# Skill: Database — Supabase PostgreSQL

> Schema, relationships, RLS, and migration conventions for NestureAI. All data
> lives in a single **PostgreSQL 17** database managed by Supabase. Read
> `security.md` for the RLS/consent rules that ride on top of this schema.

---

## 1. Overview

- **Engine:** PostgreSQL 17 (`supabase/config.toml` → `[db] major_version = 17`).
- **Access:** frontend via the Supabase JS client (RLS-enforced); edge functions
  via `service_role` (RLS-bypassing).
- **Migrations:** plain SQL files in `supabase/migrations/`, roughly date-prefixed
  (`YYYYMMDD_*.sql`). Seeds: `supabase/seed.sql`, `seed_test_accounts.sql`, plus
  several `seed_*`/`recreate_*`/`enrich_*` helper migrations.
- `public.users.id` **equals** `auth.users.id` (standard Supabase 1:1 pattern).

---

## 2. Core schema

Created in `20260502_init.sql`; extended by later migrations.

### Enums
- `user_role`: `parent | practitioner | learner` (+ `admin` added later in
  `20260614_admin_rls_policies.sql`).
- `doc_type`: `OT_Evaluation | IEP | ISP | Speech_Language | Biomedical |
  Home_Plan | Protocol | School_Report | Other`.
- `doc_status`: `processing | definitive | derived | error`.
- `difficulty_mode`: `Easy | Medium | Complex - Words | Complex - Sentences |
  Self Expression`.
- `keyboard_size`: `Big keys | Medium keys | Standard keys`.

### Tables (core)
| Table | Key columns | Purpose |
|---|---|---|
| `users` | `id` (FK→auth.users), `role`, `first_name`, `last_name` | Platform users; role drives routing & RLS |
| `children` | `id`, `parent_id`→users, `first_name`, `age`, `diagnosis` | Learner profiles owned by a parent |
| `practitioner_children` | (`practitioner_id`, `child_id`) PK, `granted_at` | OT ↔ child link (consent-created) |
| `documents` | `id`, `child_id`, `file_name`, `file_path`, `file_type` (doc_type), `status` (doc_status) | Uploaded clinical files (Storage `patient-documents`) |
| `atlas_profiles` | `child_id` UNIQUE, `completeness_percentage`, 10+ JSONB domain columns | AI 360° profile (see §3) |
| `sessions` | `id`, `child_id`, `difficulty_mode`, `keyboard_size`, `accuracy`, `words_completed`, `average_response_time_ms`, `overrides_made` JSONB | Game session results |
| `consent` | `id`, `parent_id`, `agreement_version`, `accepted_at`, `ip_address`, `shared_sections` JSONB | COPPA/FERPA consent records |
| `subscriptions` | `parent_id`, `stripe_subscription_id` UNIQUE, `stripe_customer_id`, `tier`, `learner_count`, `status` | Stripe billing state |

### Tables added by later migrations
- `feedback` (beta feedback + rating), `ask_ai_messages` (grounded assistant
  history), `prescriptions` (assigned exercises, `specialist_id` + status),
  `learn_content`, `user_feature_flags`, `atlas_questionnaire_responses`,
  `atlas_domain_scores`, `raw_tracking`, and audit tables:
  `deletion_audit_log`, `decision_audit_logs`, `admin_impersonation_logs`.

> Note: some early code/README references a `learners` table; the implemented
> table is **`children`** (with `services/supabaseClient.js` helpers
> `getChildrenForParent`, `getChildByEmail`, etc.). Treat `children` as canonical.

---

## 3. `atlas_profiles` JSONB domains

`completeness_percentage` (0→100) plus JSONB columns: `strengths`, `challenges`,
`communication_profile`, `sensory_profile`, `functional_wellness`,
`motor_reflexes`, `cross_report_insights`, `home_plan`, `calibration_parameters`
(LetterQuest/game settings), `care_navigator`. Written by the
`calculate-atlas-profile` / `process-document` edge functions via `service_role`.

---

## 4. Row Level Security (RLS)

- **RLS is enabled on every table** from the start (`init.sql` ends with
  `ENABLE ROW LEVEL SECURITY` on all core tables). The init file leaves policies
  minimal for the prototype; **policies are added incrementally** in later
  migrations (`fix_children_rls.sql`, `20260614_admin_rls_policies.sql`,
  `20260614_fix_practitioner_rls.sql`, `20260614_fix_recursion.sql`,
  `20260509_fix_connection_rls.sql`, `20260625_allow_select_children_for_pending_requests.sql`).
- **General intent:** parents read/write their own `children` and related rows;
  practitioners read children they are linked to via `practitioner_children`;
  admins have broad read via admin policies; `service_role` (edge functions)
  bypasses RLS entirely.
- **Recursion hazard:** policies that self-reference `users`/`children` have
  caused infinite-recursion errors before — hence the dedicated
  `fix_recursion` migration. When writing a policy that queries the same table it
  protects, use a `SECURITY DEFINER` helper or a non-recursive predicate.
- Example (`subscriptions`): `SELECT` allowed when `auth.uid() = parent_id`;
  `service_role` has full access via a permissive `FOR ALL USING (true)` policy.

---

## 5. Migration conventions

- **One logical change per file**, dated `YYYYMMDD_description.sql`. Some files
  intentionally note "run STEP 1 then STEP 2 separately" (e.g. adding an enum value
  then using it — Postgres can't add + use a new enum value in one transaction).
- Enum extensions use the guarded `DO $$ ... IF NOT EXISTS ... ALTER TYPE ... ADD
  VALUE ... $$` pattern — reuse it.
- Prefer `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` for
  idempotency.
- Cascade deletes are used deliberately (`ON DELETE CASCADE` from `children`,
  `users`); there are dedicated cascade-fix migrations
  (`20260621_fix_user_deletion_cascade.sql`, `delete_user_cascade.sql`) — check
  those before changing FK behavior.
- **Never** put real secrets or production credentials in a migration. (The
  historical admin-seed migrations embed a bcrypt demo password — see
  `security.md`; do not copy that pattern for real accounts.)

---

## 6. Best practices / guidelines

- Add a migration for **every** schema change; never mutate the DB only through
  the Studio UI.
- New user-owned tables must (a) `ENABLE ROW LEVEL SECURITY` and (b) ship
  parent/practitioner/admin policies in the same migration.
- Store flexible/AI-derived data as JSONB (matches `atlas_profiles`,
  `overrides_made`, `shared_sections`); keep queryable scalars as real columns.
- Timestamps use `TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())`.
- Any deletion of child data must write to an audit log table (existing pattern in
  `delete-document` + `deletion_audit_log`).
