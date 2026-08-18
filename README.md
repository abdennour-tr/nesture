# NestureAI Platform — Project Description
**Version:** 1.0 Beta · **Date:** May 2026 · **Status:** Active Development

---

## 🎯 What is NestureAI?

NestureAI is an **EdTech platform** designed for non-speaking and motor-impaired children. It combines **hand-tracking technology**, **AI-powered clinical profiling**, and **occupational therapy tools** into a single unified platform.

The platform has **three core pillars**:
1. **LetterQuest** — A hands-free spelling game controlled by eye/finger tracking
2. **Atlas 360°** — An AI-generated child profile built from clinical documents (IEPs, OT reports)
3. **Dashboards** — Role-based interfaces for Parents, Occupational Therapists (OT), and Learners

> ⚠️ **Compliance:** COPPA (under-13), FERPA (educational records), SOC 2.
> This is **not a medical diagnostic tool**. All AI outputs are educational inferences only.

---

## 👥 User Roles

| Role | Access | Login Strategy |
|------|--------|--------------|
| **Parent** | Child's progress, Atlas profile, document upload | Standard Email / Password (`jennifer@example.com`) |
| **Occupational Therapist (OT)** | All learners, exercises, reflex assessment | Standard Email / Password (`sarah@example.com`) |
| **Learner** | LetterQuest game, personal progress | **Pseudonym Only** (`Maya123`) — *No email required for COPPA compliance* |

---

## 🏗️ Architecture

```
NestureAI Frontend (React / Vite)
│
├── 🟦 Local Layer (IndexedDB via localDB.js)
│   ├── Sessions: Game session history & motor data
│   └── Exercises: Reflex integration exercises
│
└── 🟩 Cloud Layer (Supabase PostgreSQL + Edge Functions)
    ├── learners: Learner profiles & pseudonym mapping
    ├── atlas_profiles: AI-generated 360° profile (strengths, challenges, etc.)
    ├── documents: Uploaded clinical reports (patient-documents bucket)
    └── Edge Function: process-document (OCR + Groq AI pipeline)
```

---

## 🧠 Core Features

### 1. Sequential 4-Step Onboarding (Parent Dashboard)
- **Step 1:** Details (Name, Age, Diagnosis)
- **Step 2:** Reports & Intakes (PDF/Image upload to Supabase Storage)
- **Step 3:** Verification (Literacy, Communication method, Parent Hopes)
- **Step 4:** Learner Login (Pseudonym mapping for COPPA compliant login)

### 2. LetterQuest Game (`/play`)
- **Hand tracking** via MediaPipe Hands
- **Dwell-time selection**: Point index finger at a key for 2.5 seconds to select
- **3 difficulty modes**: Easy (3-letter words) → Medium → Complex sentences
- **3 keyboard sizes**: Big keys / Medium keys / Standard keys (calibration for motor ability)
- **AI Engine**: Analyses motor patterns → detects primitive reflex retention → generates LPI score

### 3. Atlas 360° Profile (`/parent` → Atlas tab)
- Parents upload clinical documents
- Documents stored in **Supabase Storage**
- AI Pipeline extracts 12 Domains (Document Intelligence, Strengths, Motor Reflexes, Sensory, etc.)
- Starts at 20% completeness (from onboarding questionnaire) and goes to 100% after AI processing.

### 4. Grounded AI Assistant (Floating Widget)
- Persistent floating chat widget (FAB) across Parent and OT dashboards.
- Powered by LLM (Groq) with **System Prompts grounded in the specific Learner's Atlas Profile**.
- Context-aware responses regarding the child's strengths and challenges.

### 5. Parent Dashboard (`/parent`)
- **Overview**: Child progress summary, recent sessions
- **Progress**: Accuracy & LPI trend charts (Recharts)
- **Exercises**: Prescribed reflex integration exercises
- **Atlas Profile**: Full 360° AI profile viewer

### 6. OT/Practitioner Dashboard (`/ot`)
- **Learner Overview**: All assigned learners with attention flags
- **Analytics**: Accuracy comparison charts
- **Learner Detail**: Individual deep-dive + Atlas insights
- **Consent & Connection**: Ability to be linked to a parent's child profile

---

## 🔌 Technology Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | React 18 |
| **State Management** | Zustand |
| **Animations** | Framer Motion |
| **Charts** | Recharts |
| **Hand Tracking** | MediaPipe Hands |
| **Cloud Database** | Supabase (PostgreSQL) |
| **Cloud Storage** | Supabase Storage |
| **AI Inference** | Groq API — `llama3-70b-8192` |
| **OCR** | OCR.Space API / Llama-3 Vision |

---

## 🗄️ Supabase Database Schema

| Table | Purpose |
|-------|---------|
| `users` | Platform users (Parents, OTs) |
| `learners` | Child profiles (Mapped via parent_id) |
| `practitioner_children` | OT ↔ Child relationships |
| `documents` | Uploaded clinical files |
| `atlas_profiles` | AI-generated 360° profiles |
| `sessions` | LetterQuest game results |
| `consent` | COPPA/FERPA consent records |

---

## ☁️ Supabase Backend Setup

The platform relies on Supabase for its database, storage, and edge functions. Follow these steps to configure your Supabase instance:

### 1. Deploy Edge Functions
Ensure you have the [Supabase CLI](https://supabase.com/docs/guides/cli) installed.
```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy process-document --no-verify-jwt
```

### 2. Configure Secrets
In the Supabase Dashboard, navigate to **Edge Functions → process-document → Secrets** and add the following:
- `GROQ_API_KEY`: Your Groq API key
- `OCR_API_KEY`: Your OCR.Space API key
- `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase Service Role Key (required for bypassing RLS to update `atlas_profiles` and manage storage)

### 3. Setup Storage
Create a new bucket named `patient-documents`:
- **Public**: No (must remain private for compliance)
- **RLS Policies**:
  - Allow authenticated users to upload (`INSERT`)
  - Allow authenticated users to read their own files (`SELECT`)
  - Allow `service_role` to manage files (`DELETE`)

### 4. Database RLS Policies
Ensure the following tables are correctly configured with Row Level Security (RLS):
- `learners`: Table must exist and be linked to `users`.
- `atlas_profiles`: RLS must allow parents to read profiles associated with their children, and practitioners to read profiles of linked learners. The Edge Function bypasses these using the `service_role_key`.

---

## 🚀 Running the Project

```bash
# Install dependencies
npm install

# Start development server
npm start
# → Opens at http://localhost:3000
```

**Login with Demo Accounts:**
- `jennifer@example.com` / `password123` → Parent
- `sarah@example.com` / `password123` → OT
- Learner: Enter nickname (e.g. `maya` or `akhil`) and password.

---

## 📋 Remaining Technical Tasks (Option C)

- **AI Document Pipeline**: Edge Function to parse PDFs (OCR) and populate `atlas_profiles` via LangChain.
- **Two-way OT Linking**: Allow Practitioners to request access to a child's profile via code/pseudonym.
- **Game Telemetry**: Connect frontend game session data (LPI, reflexes) to the backend `sessions` table.
