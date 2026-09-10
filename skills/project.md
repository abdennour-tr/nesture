# Skill: Project — NestureAI Platform

> AI context for the NestureAI codebase. Read this first. It is the single source
> of truth for what the product is, how it is structured, and the non-negotiable
> rules that apply to every file in the repo.

---

## 1. Project overview

**NestureAI** is an **EdTech platform for non-speaking and motor-impaired
children**. It fuses three things into one web app:

1. **Hand-tracking games** (browser webcam + MediaPipe) that double as
   occupational-therapy (OT) practice activities.
2. **Atlas 360°** — an AI-generated child profile assembled from uploaded
   clinical documents (IEPs, OT evaluations, speech reports).
3. **Role-based dashboards** for Parents, Occupational Therapists (OT /
   "practitioner"), Learners, and Admins.

`package.json` name: `nesture-ai-frontend`, version `1.0.1`. Product status:
**1.0 Beta, active development**.

> ⚠️ **This is NOT a medical diagnostic tool.** All AI and motion outputs are
> *educational inferences about developmental movement patterns* only. This
> constraint shapes the data model, the language, and the compliance posture —
> it is not optional marketing text.

### Compliance envelope
- **COPPA** (children under 13) — learners never provide an email; they log in
  with a pseudonym.
- **FERPA** (educational records) — uploaded documents are private, consent-gated.
- **SOC 2** posture — RLS, audit logs, private storage, least privilege.

---

## 2. Architecture

The system is a **React SPA + Supabase backend-as-a-service**. There is **no
custom Node/FastAPI/Django server** — the historical FastAPI backend was replaced
by a frontend shim (`src/services/api.js`) that maps the old REST surface onto
Supabase calls. Do not reintroduce a separate API server.

```
┌──────────────────────────────────────────────────────────────┐
│  React 18 SPA  (Create React App / react-scripts 5.0.1)      │
│                                                              │
│  Pages ── Zustand stores ── services/ (data + AI + auth)     │
│    │                              │                          │
│    │  MediaPipe Hands / FaceMesh  │                          │
│    │  → reflexEngine (realtime)   │  api.js (axios-shaped    │
│    │  → aiEngine (post-session)   │  shim) → supabaseDB.js   │
└────┼──────────────────────────────┼──────────────────────────┘
     │                              │
     ▼ (webcam, on-device)          ▼
  No data leaves device       ┌─────────────────────────────────┐
  for tracking itself         │  Supabase                       │
                              │   • PostgreSQL 17 (RLS on all)  │
                              │   • Auth (email + pseudonym)    │
                              │   • Storage (patient-documents) │
                              │   • Edge Functions (Deno / TS)  │
                              └─────────────────────────────────┘
                                        │
                    ┌───────────────────┼─────────────────────┐
                    ▼                   ▼                     ▼
              Stripe (billing)    Groq (llama-3.1)     Anthropic Claude
                                  OCR.Space            (Atlas profile)
```

**Two data layers:**
- **Cloud (authoritative):** Supabase Postgres via `services/supabaseDB.js`.
- **Local fallback:** `services/localDB.js` (IndexedDB) — legacy/offline path,
  kept behind the same `api.js` interface.

---

## 3. Technologies used

| Concern | Technology |
|---|---|
| UI framework | React 18.3 (Create React App, **react-scripts 5.0.1** — not Vite) |
| Routing | react-router-dom v6 |
| State | Zustand 4 (`persist` middleware, sessionStorage) |
| Animation | Framer Motion 11 |
| Charts | Recharts 2 |
| Icons | lucide-react |
| Toasts | react-hot-toast |
| i18n | i18next / react-i18next (locale: `en`) |
| Hand/face tracking | @mediapipe/hands, @mediapipe/face_mesh, camera_utils, drawing_utils |
| Reports/export | jspdf, exceljs |
| Hashing | bcryptjs |
| Backend | Supabase (PostgreSQL 17, Auth, Storage, Edge Functions in Deno/TypeScript) |
| Payments | Stripe |
| AI — document parsing | Groq `llama-3.1-8b-instant` (+ OCR.Space) |
| AI — Atlas profile | Anthropic Claude (`ANTHROPIC_API_KEY`) |
| Testing | Playwright (e2e + axe accessibility), react-scripts test (Jest) |
| Deploy | Docker (node:20-alpine dev; multi-stage → nginx:alpine prod) |

---

## 4. User roles

| Role (`users.role`) | Home route | Login | Notes |
|---|---|---|---|
| `parent` | `/parent` | email + password | Owns children, uploads documents, billing |
| `practitioner` (OT) | `/ot` | email + password | Linked to children via consent |
| `learner` | `/play` | **pseudonym** + password | No email (COPPA); mapped to a `children` row |
| `admin` | `/admin` | email + password | Platform admin, **impersonation** capability |

Role routing lives in `getRouteForRole()` (`services/authService.js`). Route
guards are `ProtectedRoute` / `PublicRoute` in `src/App.js`.

---

## 5. Core features / domain concepts

- **Games** (`/play/*`): Path Tracing, Finger Copy, Trace Type, Finger Piano,
  Pinch Coin, Ladybug, Bubble, and LetterQuest (`GamePage`). All webcam-driven,
  dwell-time / pinch / trace selection, with per-game difficulty and calibration.
- **Reflex engine** (`services/reflexEngine/`): real-time detection of 10 retained
  primitive reflexes (ATNR, STNR, TLR, Moro, VOR, Palmar Grasp, Babkin,
  Hand-to-Mouth, Eye Coordination, Visual Tracking) from a rolling MediaPipe frame
  buffer, analysed in ~5 s windows and aggregated per session.
- **AI engine** (`services/aiEngine.js`): post-session, rule-based mapping of
  gesture metrics → reflex scores → OT movement-activity recommendations, plus an
  **LPI** (Learning Progress Index) score.
- **Atlas 360°**: a 12-domain child profile with `completeness_percentage`,
  seeded from an onboarding questionnaire (~20%) and enriched to 100% by the AI
  document pipeline.
- **NestureConnect**: consent-based linking between a parent's child and an OT.
- **Grounded AI assistant**: floating chat widget grounded in the specific
  learner's Atlas profile.

---

## 6. Important business rules

1. **Non-diagnostic language is mandatory** (PRD §1). See the allow/deny word list
   in `services/authService.js`:
   - **Use:** support plan, learning plan, professional assessment, movement
     activities, practice sessions, evidence-backed, recommended.
   - **Never use:** treatment plan, prescribe, clinical, therapeutic, patient,
     medical, diagnose. This applies to UI copy, docs, and AI prompts.
2. **Learners have no email and no PII beyond a pseudonym** — never add an email
   requirement to the learner flow.
3. **A user's `role` must match the tab they log in through** — cross-role login
   is rejected server-side (`signIn` in `authService.js`).
4. **Consent gates data sharing** — an OT sees a child only through an accepted
   connection; revoking consent removes the `practitioner_children` link.
5. **Documents are private** — the `patient-documents` storage bucket is never
   public; only owners (and `service_role` via edge functions) read them.

---

## 7. Common workflows

- **Parent onboarding**: 4 sequential steps (Details → Reports upload →
  Verification questionnaire → Learner pseudonym mapping).
- **Play → score**: game records gestures → `reflexEngine` produces a live result
  → `useSessionStore.endSession()` merges it with `aiEngine` output → persisted to
  `sessions`.
- **Atlas build**: parent uploads doc → `process-document` edge function (OCR +
  Groq) → `calculate-atlas-profile` (Claude) → `atlas_profiles` row updated via
  `service_role`.
- **Billing**: `/pricing` → `create-checkout-session` → Stripe Checkout →
  `stripe-webhook` writes to `subscriptions`.

---

## 8. Development guidelines

- Run: `npm install` then `npm start` (CRA dev server, `http://localhost:3000`).
- Demo accounts: `jennifer@example.com` / `password123` (parent),
  `sarah@example.com` / `password123` (OT), learner `akhil` / `password123`.
- **Do not commit secrets.** All keys come from env (`REACT_APP_*` for the
  frontend, Supabase Function secrets for the backend). `.env` is gitignored.
- Keep the `api.js` shim shape stable — many pages call `api.get('/...')` /
  `api.post('/...')`. Add routes there rather than importing `supabaseDB.js`
  directly into pages.
- The repo contains loose root-level scripts (`check_db.js`, `test_accounts.js`,
  `list_exercises.js`, etc.) — these are **dev-only scratch tools**, not app code.
- See the sibling skills for depth: `frontend.md`, `backend.md`, `database.md`,
  `security.md`, `deployment.md`.
