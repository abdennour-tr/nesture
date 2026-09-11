/**
 * api.js — Frontend-only shim (replaces the Axios → FastAPI connection)
 *
 * Every call that was previously routed to localDB.js is now handled
 * by supabaseDB.js which persists data in Supabase instead of IndexedDB.
 *
 * The public surface is intentionally shaped like an Axios instance so that
 * existing page code (`api.get(url)`, `api.post(url, body)`) works unchanged.
 */
import * as localDB from './supabaseDB.js';
import { generateGameReportBytes } from './reportBuilder.js';
import { buildReflexSections, reflexMapFromStoredRows, gameIdFromName } from './reflexProfiles';

// ── Route handlers ────────────────────────────────────────────────────────────

async function handleGet(url) {
  const [path, qs] = url.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));

  // GET /users/demo-accounts
  if (path === '/users/demo-accounts') {
    return localDB.getDemoAccounts();
  }

  // GET /users/professionals
  if (path === '/users/professionals') {
    return localDB.getProfessionals();
  }

  // GET /specialists (NestureConnect directory)
  if (path === '/specialists') {
    return localDB.getSpecialists();
  }

  // GET /sessions/learner/:id
  const sessionsLearner = path.match(/^\/sessions\/learner\/([^/]+)$/);
  if (sessionsLearner) {
    const limit = parseInt(params.limit) || 20;
    const page = params.page ? parseInt(params.page) : null;
    const filters = {
      game_name: params.game_name || null,
      start_date: params.start_date || null,
      end_date: params.end_date || null,
      archived: params.archived || null,
      difficulty: params.difficulty || null,
      min_accuracy: params.min_accuracy || null,
    };
    const res = await localDB.getSessions(sessionsLearner[1], limit, page || 1, filters);
    
    // If page parameter wasn't requested explicitly in URL, return flat array for backward compatibility
    if (page === null) {
      return res.sessions;
    }
    return res;
  }

  // GET /sessions/:id/analysis
  const sessionAnalysis = path.match(/^\/sessions\/([^/]+)\/analysis$/);
  if (sessionAnalysis) {
    return localDB.getSessionAnalysis(sessionAnalysis[1]);
  }

  // GET /sessions/:id
  const sessionById = path.match(/^\/sessions\/([^/]+)$/);
  if (sessionById) {
    return localDB.getSession(sessionById[1]);
  }

  // GET /reflexes/learner/:id/summary
  const reflexSummary = path.match(/^\/reflexes\/learner\/([^/]+)\/summary$/);
  if (reflexSummary) {
    return localDB.getReflexSummary(reflexSummary[1]);
  }

  // GET /reflexes/learner/:id/latest
  const reflexLatest = path.match(/^\/reflexes\/learner\/([^/]+)\/latest$/);
  if (reflexLatest) {
    return localDB.getLatestReflexes(reflexLatest[1]);
  }

  // GET /learners/by-parent/:id
  const byParent = path.match(/^\/learners\/by-parent\/([^/]+)$/);
  if (byParent) {
    return localDB.getLearnersByParent(byParent[1]);
  }

  // GET /learners/by-ot/:id
  const byOT = path.match(/^\/learners\/by-ot\/([^/]+)$/);
  if (byOT) {
    return localDB.getLearnersByOT(byOT[1]);
  }

  // GET /learners/by-auth/:id
  const byAuth = path.match(/^\/learners\/by-auth\/([^/]+)$/);
  if (byAuth) {
    return localDB.getChildByAuthUserId(byAuth[1]);
  }

  // GET /learners/ (list all)
  if (path === '/learners/' || path === '/learners') {
    return localDB.getLearners();
  }

  // GET /learners/:id
  const learnerById = path.match(/^\/learners\/([^/]+)$/);
  if (learnerById) {
    return localDB.getLearner(learnerById[1]);
  }

  // GET /exercises/prescriptions/:learner_id
  const prescriptions = path.match(/^\/exercises\/prescriptions\/([^/]+)$/);
  if (prescriptions) {
    return localDB.getPrescriptions(prescriptions[1]);
  }

  // GET /exercises/ or /exercises
  if (path === '/exercises/' || path === '/exercises') {
    const specId = params.specialist_id && params.specialist_id !== 'undefined' ? params.specialist_id : null;
    return localDB.getExercises(params.reflex || null, specId);
  }

  // GET /exercises/:id
  const exerciseById = path.match(/^\/exercises\/([^/]+)$/);
  if (exerciseById) {
    return localDB.getExercise(exerciseById[1]);
  }

  // GET /prescriptions/by-exercise/:exerciseId
  const presByExercise = path.match(/^\/prescriptions\/by-exercise\/([^/]+)$/);
  if (presByExercise) {
    return localDB.getPrescriptionsByExercise(presByExercise[1]);
  }

  // GET /prescriptions/all
  if (path === '/prescriptions/all') {
    return localDB.getAllPrescriptions();
  }

  /* GET /reports/:sessionId/pdf
     ------------------------------------------------------------------------
     Builds the SAME report the results screen shows, from the same model, so a
     PDF pulled from a dashboard states the same findings as the screen the
     child and parent saw at the end of the round. The previous builder drew its
     own reflex table: a missing score defaulted to 50 and the status column was
     computed from confidence, so a settled, well-observed reflex printed
     "Action recommended". */
  const reportPdf = path.match(/^\/reports\/([^/]+)\/pdf$/);
  if (reportPdf) {
    const sessionId = reportPdf[1];
    const { session, learner, reflexScores, exercises, analysis } = await localDB.getReportData(sessionId);

    const gameId = gameIdFromName(session?.game_name) || 'letterquest';
    const sections = buildReflexSections(gameId, reflexMapFromStoredRows(reflexScores));
    const pct = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v) * 100);
    const lpi = Number(session?.lpi_score) || Number(analysis?.lpi_score) || null;
    const seconds = Number(session?.duration_seconds) || 0;

    const buffer = generateGameReportBytes({
      gameId,
      gameName: session?.game_name || 'Session',
      title: 'Session report',
      subtitle: session?.difficulty ? `Level: ${session.difficulty}` : undefined,
      endedEarly: false,
      headline: { value: lpi, caption: 'LPI Score' },
      breakdown: [
        { label: 'Accuracy', value: pct(session?.accuracy_score) },
        { label: 'Movement smoothness', value: pct(session?.trajectory_smoothness) },
        {
          label: 'Stamina through the round',
          value: session?.fatigue_index == null ? null : (1 - Number(session.fatigue_index)) * 100,
        },
      ],
      metrics: [
        { label: 'Total attempts', value: session?.total_attempts ?? '-' },
        { label: 'Perfect actions', value: session?.perfect_grabs ?? '-' },
        {
          label: 'Avg response',
          value: session?.avg_response_time_ms
            ? `${(Number(session.avg_response_time_ms) / 1000).toFixed(1)}s` : '-',
        },
        {
          label: 'Time played',
          value: seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '-',
        },
      ],
      sections,
      notMeasuredReason: analysis?.reflex_not_measured_reason || null,
    }, {
      learnerName: learner?.name,
      sessionId,
      date: (session?.start_time || '').slice(0, 10),
      narrative: analysis?.narrative,
      recommendations: analysis?.recommendations,
      exercises,
    });

    // Raw ArrayBuffer — the caller wraps it in new Blob([res.data], { type: 'application/pdf' })
    return buffer;
  }

  // GET /connections/search-code?code=XYZ  (child code — practitioner uses)
  const searchCode = path.match(/^\/connections\/search-code$/);
  if (searchCode) {
    return localDB.searchChildByCode(params.code);
  }

  // GET /connections/search-practitioner?code=OT-XXXXX  (OT code — parent uses)
  const searchOT = path.match(/^\/connections\/search-practitioner$/);
  if (searchOT) {
    return localDB.searchPractitionerByCode(params.code);
  }

  // GET /connections/pending/:userId
  const pendingReqs = path.match(/^\/connections\/pending\/([^/]+)$/);
  if (pendingReqs) {
    return localDB.getPendingRequests(pendingReqs[1]);
  }

  // GET /connections/active/:childId — active practitioners for a child
  const activeConns = path.match(/^\/connections\/active\/([^/]+)$/);
  if (activeConns) {
    return localDB.getChildActiveConnections(activeConns[1]);
  }

  // GET /connections/practitioner-code/:userId — get/generate OT code
  const otCode = path.match(/^\/connections\/practitioner-code\/([^/]+)$/);
  if (otCode) {
    return localDB.getPractitionerCode(otCode[1]);
  }

  // GET /atlas-profiles/:childId
  const atlasProfile = path.match(/^\/atlas-profiles\/([^/]+)$/);
  if (atlasProfile) {
    return localDB.getAtlasProfile(atlasProfile[1]);
  }

  // GET /learn-content?tags=sensory,reflex
  if (path === '/learn-content' || path.startsWith('/learn-content?')) {
    const urlObj = new URL(url, 'http://localhost');
    const tagsParam = urlObj.searchParams.get('tags');
    const tags = tagsParam ? tagsParam.split(',').map(t => t.trim()).filter(Boolean) : [];
    return localDB.getLearnContent(tags);
  }

  // ── Admin routes ──────────────────────────────────────────────────────────

  // GET /admin/parents
  if (path === '/admin/parents') {
    return localDB.getParents();
  }

  // GET /admin/specialists
  if (path === '/admin/specialists') {
    return localDB.getSpecialists();
  }

  // GET /admin/learn-content
  if (path === '/admin/learn-content') {
    return localDB.getAllLearnContent();
  }

  // GET /admin/audit-logs
  if (path === '/admin/audit-logs') {
    return localDB.getAdminAuditLogs();
  }

  // GET /connections/requests/child/:childId
  const reqsByChild = path.match(/^\/connections\/requests\/child\/([^/]+)$/);
  if (reqsByChild) {
    return localDB.getConnectionRequestsByChild(reqsByChild[1]);
  }

  // GET /admin/specialists/:id/invitation-status
  const specInvStatus = path.match(/^\/admin\/specialists\/([^/]+)\/invitation-status$/);
  if (specInvStatus) {
    return localDB.checkInvitationStatus(specInvStatus[1]);
  }

  console.warn('[api shim] Unhandled GET:', url);
  return null;
}

async function handlePost(url, body) {
  // POST /users/login
  if (url === '/users/login') {
    throw new Error('Authentication is now handled directly by Supabase via authService.js');
  }

  // POST /learners
  if (url === '/learners') {
    return localDB.addChild(body);
  }

  // POST /learners/link-ot
  if (url === '/learners/link-ot') {
    return localDB.linkChildToOT(body.childId, body.otId);
  }

  // POST /sessions/start
  if (url === '/sessions/start') {
    const gameName = body.game_name || (body.game_type === 'pathtracer' ? 'Path Tracing' : body.game_type === 'finger_copy' ? 'Magic Finger Copy' : 'LetterQuest');
    return localDB.startSession(
      body.learner_id, 
      body.difficulty, 
      gameName
    );
  }

  // POST /sessions/end
  if (url === '/sessions/end') {
    return localDB.endSession(body.session_id, body.gestures || [], null, body);
  }

  // POST /exercises
  if (url === '/exercises') {
    return localDB.addExercise(body);
  }

  // POST /exercises/upload-video
  if (url === '/exercises/upload-video') {
    const file = body instanceof FormData ? body.get('file') : body.file;
    return localDB.uploadExerciseVideo(file);
  }

  // POST /exercises/prescribe
  if (url === '/exercises/prescribe') {
    return localDB.prescribeExercise(
      body.learner_id, 
      body.exercise_id, 
      body.session_id, 
      body.notes,
      body.specialist_id,
      body.status
    );
  }

  // POST /exercises/prescriptions/:id/status
  const prescriptionStatusMatch = url.match(/^\/exercises\/prescriptions\/([^/]+)\/status$/);
  if (prescriptionStatusMatch) {
    return localDB.updatePrescriptionStatus(prescriptionStatusMatch[1], body.status);
  }


  // POST /connections/generate-code
  if (url === '/connections/generate-code') {
    return localDB.generateConnectionCode(body.childId);
  }

  // POST /connections/request
  if (url === '/connections/request') {
    return localDB.sendConnectionRequest(body.practitionerId, body.parentId, body.childId);
  }

  // POST /connections/approve
  if (url === '/connections/approve') {
    return localDB.approveConnectionRequest(body.requestId);
  }

  // POST /connections/reject
  if (url === '/connections/reject') {
    return localDB.rejectConnectionRequest(body.requestId);
  }

  // POST /connections/revoke
  if (url === '/connections/revoke') {
    return localDB.revokePractitionerAccess(body.practitionerId, body.childId);
  }

  // POST /connections/parent-request  (parent initiates connection to a specific OT)
  if (url === '/connections/parent-request') {
    return localDB.parentRequestConnection(body.parentId, body.practitionerId, body.childId);
  }

  // POST /sessions/:id/feedback
  const sessionFeedback = url.match(/^\/sessions\/([^/]+)\/feedback$/);
  if (sessionFeedback) {
    return localDB.saveSessionFeedback(sessionFeedback[1], body.rating);
  }

  // ── Admin POST routes ─────────────────────────────────────────────────────

  // POST /admin/specialists
  if (url === '/admin/specialists') {
    return localDB.addSpecialist(body);
  }

  // POST /admin/upload-thumbnail
  if (url === '/admin/upload-thumbnail') {
    return localDB.uploadResourceThumbnail(body.file);
  }

  // POST /admin/learn-content
  if (url === '/admin/learn-content') {
    return localDB.addLearnContent(body);
  }

  // POST /admin/audit-logs
  if (url === '/admin/audit-logs') {
    return localDB.logAdminAction(body.adminId, body.action, body.targetUserId, body.details);
  }

  // POST /admin/specialists/:id/status
  const specStatus = url.match(/^\/admin\/specialists\/([^/]+)\/status$/);
  if (specStatus) {
    return localDB.setSpecialistActiveStatus(specStatus[1], body.isActive, body.adminId);
  }

  // POST /admin/specialists/:id/reset-password
  const specResetPassword = url.match(/^\/admin\/specialists\/([^/]+)\/reset-password$/);
  if (specResetPassword) {
    return localDB.resetSpecialistPassword(specResetPassword[1], body.adminId);
  }

  // POST /admin/specialists/:id/resend-invitation
  const specResendInv = url.match(/^\/admin\/specialists\/([^/]+)\/resend-invitation$/);
  if (specResendInv) {
    return localDB.resendInvitation(specResendInv[1], body.adminId);
  }

  // POST /admin/parents/grant-free-access
  if (url === '/admin/parents/grant-free-access') {
    return localDB.grantFreeAccess(body.parentId, body.adminId);
  }

  console.warn('[api shim] Unhandled POST:', url);
  return null;
}

async function handlePut(url, body) {
  // PUT /users/:id
  const userPut = url.match(/^\/users\/([^/]+)$/);
  if (userPut) {
    return localDB.updateUser(userPut[1], body);
  }

  // PUT /learners/:id
  const learnerPut = url.match(/^\/learners\/([^/]+)$/);
  if (learnerPut) {
    return localDB.updateChild(learnerPut[1], body);
  }

  // PUT /exercises/:id
  const exercisePut = url.match(/^\/exercises\/([^/]+)$/);
  if (exercisePut) {
    return localDB.updateExercise(exercisePut[1], body);
  }

  // PUT /admin/specialists/:id
  const specPut = url.match(/^\/admin\/specialists\/([^/]+)$/);
  if (specPut) {
    return localDB.updateSpecialistProfile(specPut[1], body.updates, body.adminId);
  }

  // PUT /users/accept-invitation
  if (url === '/users/accept-invitation') {
    return localDB.acceptInvitation(body.userId);
  }

  console.warn('[api shim] Unhandled PUT:', url);
  return null;
}

async function handleDelete(url) {
  // DELETE /sessions/:id
  const sessionDel = url.match(/^\/sessions\/([^/]+)$/);
  if (sessionDel) {
    return localDB.deleteSession(sessionDel[1]);
  }

  // DELETE /prescriptions/:id
  const presDel = url.match(/^\/prescriptions\/([^/]+)$/);
  if (presDel) {
    return localDB.deletePrescription(presDel[1]);
  }

  // DELETE /learners/:id
  const learnerDel = url.match(/^\/learners\/([^/]+)$/);
  if (learnerDel) {
    return localDB.deleteChild(learnerDel[1]);
  }

  // DELETE /exercises/:id
  const exerciseDel = url.match(/^\/exercises\/([^/]+)$/);
  if (exerciseDel) {
    return localDB.deleteExercise(exerciseDel[1]);
  }

  // ── Admin DELETE routes ───────────────────────────────────────────────────

  // DELETE /admin/parents/:id
  const parentDel = url.match(/^\/admin\/parents\/([^/]+)$/);
  if (parentDel) {
    return localDB.deleteParent(parentDel[1]);
  }

  // DELETE /admin/specialists/:id
  const specDel = url.match(/^\/admin\/specialists\/([^/]+)$/);
  if (specDel) {
    return localDB.deleteSpecialist(specDel[1]);
  }

  // DELETE /admin/learn-content/:id
  const contentDel = url.match(/^\/admin\/learn-content\/([^/]+)$/);
  if (contentDel) {
    return localDB.deleteLearnContent(contentDel[1]);
  }

  console.warn('[api shim] Unhandled DELETE:', url);
  return null;
}

// ── Shim object (Axios-like interface) ────────────────────────────────────────

const _noop = () => {};
const _headersProxy = new Proxy({}, { set: _noop, get: () => _headersProxy });

const api = {
  defaults: {
    headers: {
      common: _headersProxy,
    },
  },

  interceptors: {
    request:  { use: _noop },
    response: { use: _noop },
  },

  get: async (url, config) => {
    try {
      const data = await handleGet(url);
      return { data };
    } catch (err) {
      if (err.status === 401 || err.message?.includes('401')) {
        localStorage.removeItem('nesture-auth');
        window.location.href = '/login';
      }
      const msg = typeof err === 'string' ? err : err?.message || 'API request failed';
      const errorObj = new Error(msg);
      errorObj.response = { status: err.status || 500, data: { detail: msg } };
      return Promise.reject(errorObj);
    }
  },

  post: async (url, body, config) => {
    try {
      const data = await handlePost(url, body);
      return { data };
    } catch (err) {
      if (err.status === 401) {
        localStorage.removeItem('nesture-auth');
        window.location.href = '/login';
      }
      const msg = typeof err === 'string' ? err : err?.message || 'API request failed';
      const errorObj = new Error(msg);
      errorObj.response = { status: err.status || 500, data: { detail: msg } };
      return Promise.reject(errorObj);
    }
  },

  put: async (url, body) => {
    try {
      const data = await handlePut(url, body);
      return { data };
    } catch (err) {
      const msg = typeof err === 'string' ? err : err?.message || 'API request failed';
      const errorObj = new Error(msg);
      errorObj.response = { status: err.status || 500, data: { detail: msg } };
      return Promise.reject(errorObj);
    }
  },

  delete: async (url) => {
    try {
      const data = await handleDelete(url);
      return { data };
    } catch (err) {
      const msg = typeof err === 'string' ? err : err?.message || 'API request failed';
      const errorObj = new Error(msg);
      errorObj.response = { status: err.status || 500, data: { detail: msg } };
      return Promise.reject(errorObj);
    }
  },
};

export default api;
