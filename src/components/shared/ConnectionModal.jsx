import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, UserPlus, Copy, CheckCircle, Search, Shield, RefreshCw, Unlink, ArrowRight, KeyRound, QrCode, Link2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { useAuthStore } from '../../store';

export default function ConnectionModal({ isOpen, onClose, role = 'parent', childId }) {
  const { user } = useAuthStore();
  const isParent = role === 'parent';

  // Common
  const [tab, setTab] = useState('share'); // 'share' | 'search'
  const [activeConnections, setActiveConnections] = useState([]);
  const [disconnecting, setDisconnecting] = useState(null);

  // Parent: child code
  const [childCode, setChildCode] = useState('');
  const [childCodeLoading, setChildCodeLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Parent: search OT by code
  const [otCodeInput, setOtCodeInput] = useState('');
  const [otResult, setOtResult] = useState(null);
  const [otSearching, setOtSearching] = useState(false);
  const [otRequestSent, setOtRequestSent] = useState(false);

  // Practitioner: own code
  const [myOtCode, setMyOtCode] = useState('');
  const [myOtCodeLoading, setMyOtCodeLoading] = useState(false);

  // Practitioner: search child by code
  const [childCodeInput, setChildCodeInput] = useState('');
  const [childResult, setChildResult] = useState(null);
  const [childSearching, setChildSearching] = useState(false);
  const [childRequestSent, setChildRequestSent] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setTab('share');
      setOtCodeInput(''); setOtResult(null); setOtRequestSent(false);
      setChildCodeInput(''); setChildResult(null); setChildRequestSent(false);
      setCopied(false);
      return;
    }
    // Load child code + active connections for parent
    if (isParent && childId) {
      setChildCodeLoading(true);
      api.post('/connections/generate-code', { childId })
        .then(r => setChildCode(r.data?.connection_code || ''))
        .catch(() => {})
        .finally(() => setChildCodeLoading(false));
      api.get(`/connections/active/${childId}`)
        .then(r => setActiveConnections(r.data || []))
        .catch(() => {});
    }
    // Load OT's own code for practitioner
    if (!isParent && user?.id) {
      setMyOtCodeLoading(true);
      api.get(`/connections/practitioner-code/${user.id}`)
        .then(r => setMyOtCode(r.data?.connection_code || ''))
        .catch(() => {})
        .finally(() => setMyOtCodeLoading(false));
    }
  }, [isOpen, childId, isParent, user?.id]);

  const handleCopy = (code) => {
    navigator.clipboard.writeText(code).then(() => { setCopied(true); toast.success('Code copied!'); setTimeout(() => setCopied(false), 2500); });
  };

  const handleDisconnect = async (practitionerId) => {
    if (!childId) return;
    setDisconnecting(practitionerId);
    try {
      await api.post('/connections/revoke', { practitionerId, childId });
      setActiveConnections(prev => prev.filter(c => c.practitioner_id !== practitionerId));
      toast.success('Specialist disconnected.');
    } catch { toast.error('Error during disconnection'); }
    finally { setDisconnecting(null); }
  };

  const handleSearchOT = async () => {
    const code = otCodeInput.trim().toUpperCase();
    if (!code) return;
    setOtSearching(true); setOtResult(null);
    try {
      const r = await api.get(`/connections/search-practitioner?code=${code}`);
      if (!r.data) { toast.error('No specialist found.'); return; }
      setOtResult(r.data);
    } catch { toast.error('Invalid code.'); }
    finally { setOtSearching(false); }
  };

  const handleSendOTRequest = async () => {
    if (!otResult) return;
    if (!childId) {
      toast.error('Please select a child first to link with this specialist.');
      return;
    }
    try {
      await api.post('/connections/parent-request', { parentId: user.id, practitionerId: otResult.id, childId });
      setOtRequestSent(true);
      toast.success(`Request sent to ${otResult.first_name}!`);
    } catch (e) {
      const msg = e?.message || '';
      if (msg.includes('409') || msg.toLowerCase().includes('already')) {
        toast.error('You are already connected to this specialist or a request is already in progress.');
      } else {
        toast.error('Error: ' + (msg || 'Unable to send request. Please try again.'));
        console.error('[ConnectionModal] sendOTRequest error:', e);
      }
    }
  };

  const handleSearchChild = async () => {
    const code = childCodeInput.trim().toUpperCase();
    if (!code) return;
    setChildSearching(true); setChildResult(null);
    try {
      const r = await api.get(`/connections/search-code?code=${code}`);
      if (!r.data) { toast.error('No child found.'); return; }
      setChildResult(r.data);
    } catch { toast.error('Invalid code.'); }
    finally { setChildSearching(false); }
  };

  const handleSendChildRequest = async () => {
    if (!childResult) return;
    try {
      await api.post('/connections/request', {
        practitionerId: user.id,
        parentId: childResult.parent_id,
        childId: childResult.id,
      });
      setChildRequestSent(true);
      toast.success(`Request sent for ${childResult.first_name}!`);
    } catch (e) {
      const msg = e?.message || '';
      if (msg.includes('409') || msg.toLowerCase().includes('already')) {
        toast.error('Already connected or request already pending for this child.');
      } else if (!childResult.parent_id) {
        toast.error('Unable to find the parent of this child. Please contact the administrator.');
      } else {
        toast.error('Error: ' + (msg || 'Please try again in a few moments.'));
        console.error('[ConnectionModal] sendChildRequest error:', e);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div style={S.overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div style={S.modal} initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.2 }}>
        <div style={S.topBar} />
        <button onClick={onClose} style={S.closeBtn}><X size={18} /></button>

        <div style={S.body}>
          {/* Header */}
          <div style={S.headerRow}>
            <div style={S.iconCircle}><UserPlus size={22} color="#0D5E6B" /></div>
            <div>
              <h2 style={S.title}>{isParent ? 'Manage Connections' : 'Connect a Learner'}</h2>
              <p style={S.subtitle}>{isParent ? `Share your child's profile or connect a specialist.` : 'Share your specialist code or enter a learner\'s connection code.'}</p>
            </div>
          </div>

          {/* Tabs */}
          <div style={S.tabs}>
            <button style={{ ...S.tab, ...(tab === 'share' ? S.tabActive : {}) }} onClick={() => setTab('share')}>
              <div style={S.tabContent}>
                <div style={S.tabIcon}>{isParent ? <KeyRound size={20} /> : <QrCode size={20} />}</div>
                <div>
                  <div style={S.tabTitle}>{isParent ? 'My Child\'s Code' : 'My Specialist Code'}</div>
                  <div style={S.tabDesc}>Share this code</div>
                </div>
              </div>
            </button>
            <button style={{ ...S.tab, ...(tab === 'search' ? S.tabActive : {}) }} onClick={() => setTab('search')}>
              <div style={S.tabContent}>
                <div style={S.tabIcon}><Search size={20} /></div>
                <div>
                  <div style={S.tabTitle}>{isParent ? 'Find a Specialist' : 'Find a Learner'}</div>
                  <div style={S.tabDesc}>Enter their code</div>
                </div>
              </div>
            </button>
          </div>

          <AnimatePresence mode="wait">
            {tab === 'share' && (
              <motion.div key="share" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {/* Code card */}
                <div style={S.codeCard}>
                  <div style={S.codeLabel}>
                    {isParent ? 'CONNECTION CODE — CHILD' : 'YOUR SPECIALIST CODE'}
                  </div>
                  {(isParent ? childCodeLoading : myOtCodeLoading) ? (
                    <div style={{ color: '#9CA3AF', fontSize: '0.85rem', padding: '12px 0' }}>Generating…</div>
                  ) : (
                    <>
                      <div style={S.codeDisplay}>
                        {(isParent ? childCode : myOtCode || '------').split('').map((ch, i) => (
                          <span key={i} style={S.codeLetter}>{ch}</span>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                        <button onClick={() => handleCopy(isParent ? childCode : myOtCode)} style={S.copyBtn}>
                          {copied ? <CheckCircle size={15} color="#10B981" /> : <Copy size={15} />}
                          {copied ? 'Copied!' : 'Copy'}
                        </button>
                        {isParent && (
                          <button onClick={() => {
                            setChildCodeLoading(true);
                            api.post('/connections/generate-code', { childId })
                              .then(r => setChildCode(r.data?.connection_code || ''))
                              .finally(() => setChildCodeLoading(false));
                          }} style={S.regenBtn} title="New code"><RefreshCw size={15} /></button>
                        )}
                      </div>
                    </>
                  )}
                </div>

                <div style={S.hint}>
                  <Shield size={13} color="#0D5E6B" style={{ flexShrink: 0 }} />
                  <span>
                    {isParent
                      ? 'Give this code to your specialist. They must enter it in their dashboard to request access.'
                      : 'Give this code to the family or parent. They can enter it in their dashboard to link their account.'}
                  </span>
                </div>

                {/* Active connections (parent only) */}
                {isParent && activeConnections.length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <div style={S.sectionLabel}>CONNECTED SPECIALISTS</div>
                    {activeConnections.map(c => (
                      <div key={c.practitioner_id} style={S.connRow}>
                        <div style={S.connAvatar}>{c.practitioner?.first_name?.[0] || 'P'}</div>
                        <div style={{ flex: 1 }}>
                          <div style={S.connName}>{c.practitioner?.first_name} {c.practitioner?.last_name}</div>
                          <div style={S.connSub}>Access granted · {c.granted_at ? new Date(c.granted_at).toLocaleDateString('en-US') : ''}</div>
                        </div>
                        <button
                          disabled={disconnecting === c.practitioner_id}
                          onClick={() => handleDisconnect(c.practitioner_id)}
                          style={S.disconnectBtn}
                        >
                          <Unlink size={13} />
                          {disconnecting === c.practitioner_id ? '…' : 'Disconnect'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {isParent && activeConnections.length === 0 && !childCodeLoading && (
                  <div style={{ color: '#9CA3AF', fontSize: '0.8rem', marginTop: 16, textAlign: 'center' }}>
                    No specialists connected yet.
                  </div>
                )}
              </motion.div>
            )}

            {tab === 'search' && (
              <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {isParent ? (
                  /* Parent searches OT */
                  otRequestSent ? (
                    <div style={S.successBox}>
                      <CheckCircle size={40} color="#10B981" />
                      <div style={S.successTitle}>Request sent!</div>
                      <p style={S.successText}>The specialist must approve your request. They will appear in your connections after validation.</p>
                      <button onClick={() => { setOtRequestSent(false); setOtResult(null); setOtCodeInput(''); }} style={S.doneBtn}>Send another request</button>
                    </div>
                  ) : (
                    <>
                      <p style={S.instructionText}>Enter the specialist code provided by your specialist (format OT-XXXXX).</p>
                      <div style={S.searchRow}>
                        <input value={otCodeInput} onChange={e => { setOtCodeInput(e.target.value.toUpperCase()); setOtResult(null); }}
                          onKeyDown={e => e.key === 'Enter' && handleSearchOT()}
                          placeholder="OT-XXXXX" style={S.searchInput} maxLength={10} />
                        <button onClick={handleSearchOT} disabled={otSearching} style={S.searchBtn}>
                          {otSearching ? '…' : <Search size={18} />}
                        </button>
                      </div>
                      {otResult && (
                        <div style={S.resultCard}>
                          <div style={S.resultAvatar}>{otResult.first_name?.[0] || 'O'}</div>
                          <div style={{ flex: 1 }}>
                            <div style={S.resultName}>{otResult.first_name} {otResult.last_name}</div>
                            <div style={S.resultSub}>NestureAI Specialist</div>
                          </div>
                          <button onClick={handleSendOTRequest} style={S.requestBtn}>
                            <ArrowRight size={14} /> Request
                          </button>
                        </div>
                      )}
                    </>
                  )
                ) : (
                  /* Practitioner searches child */
                  childRequestSent ? (
                    <div style={S.successBox}>
                      <CheckCircle size={40} color="#10B981" />
                      <div style={S.successTitle}>Request sent!</div>
                      <p style={S.successText}>The parent of <strong>{childResult?.first_name}</strong> must approve your request.</p>
                      <button onClick={() => { setChildRequestSent(false); setChildResult(null); setChildCodeInput(''); }} style={S.doneBtn}>New request</button>
                    </div>
                  ) : (
                    <>
                      <p style={S.instructionText}>Enter the connection code provided by the learner's family or parent.</p>
                      <div style={S.searchRow}>
                        <input value={childCodeInput} onChange={e => { setChildCodeInput(e.target.value.toUpperCase()); setChildResult(null); }}
                          onKeyDown={e => e.key === 'Enter' && handleSearchChild()}
                          placeholder="Learner code…" style={S.searchInput} maxLength={10} />
                        <button onClick={handleSearchChild} disabled={childSearching} style={S.searchBtn}>
                          {childSearching ? '…' : <Search size={18} />}
                        </button>
                      </div>
                      {childResult && (
                        <div style={S.resultCard}>
                          <div style={S.resultAvatar}>{childResult.first_name?.[0] || 'E'}</div>
                          <div style={{ flex: 1 }}>
                            <div style={S.resultName}>{childResult.first_name} {childResult.last_name || ''}</div>
                            <div style={S.resultSub}>Learner profile found · request pending parent approval</div>
                          </div>
                          <button onClick={handleSendChildRequest} style={S.requestBtn}>
                            <ArrowRight size={14} /> Request
                          </button>
                        </div>
                      )}
                    </>
                  )
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

const S = {
  overlay: { position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(10,25,30,0.65)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal: { background: '#fff', borderRadius: 24, width: '100%', maxWidth: 520, boxShadow: '0 32px 80px rgba(0,0,0,0.25)', position: 'relative', overflow: 'hidden', maxHeight: '92vh', overflowY: 'auto' },
  topBar: { height: 5, background: 'linear-gradient(90deg, #0D5E6B, #1A8FA0, #E8841A)' },
  closeBtn: { position: 'absolute', top: 14, right: 14, background: '#F3F4F6', border: 'none', borderRadius: '50%', width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B7280', cursor: 'pointer', zIndex: 10 },
  body: { padding: '28px 30px 32px' },
  headerRow: { display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 20 },
  iconCircle: { width: 50, height: 50, borderRadius: 14, background: 'linear-gradient(135deg, #EEF6F8, #C8E8ED)', border: '2px solid #B2DFE6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title: { fontFamily: 'Inter, sans-serif', fontSize: '1.3rem', fontWeight: 800, color: '#0D5E6B', margin: '0 0 4px' },
  subtitle: { color: '#6B7280', fontSize: '0.82rem', margin: 0, lineHeight: 1.5 },
  tabs: { display: 'flex', background: '#F3F4F6', borderRadius: 10, padding: 3, gap: 3, marginBottom: 20 },
  tab: { flex: 1, padding: '9px 8px', background: 'transparent', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.79rem', color: '#6B7280', cursor: 'pointer', transition: 'all 0.18s' },
  tabActive: { background: '#fff', color: '#0D5E6B', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' },
  // Code display
  codeCard: { background: 'linear-gradient(135deg,#F0FAFB,#E6F4F6)', border: '2px dashed #8ECBD6', borderRadius: 16, padding: '20px 22px', textAlign: 'center', marginBottom: 16 },
  codeLabel: { fontSize: '0.62rem', fontWeight: 800, color: '#0D5E6B', letterSpacing: '0.1em', marginBottom: 14 },
  codeDisplay: { display: 'flex', justifyContent: 'center', gap: 6, flexWrap: 'wrap' },
  codeLetter: { width: 42, height: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', borderRadius: 10, border: '2px solid #B2DFE6', fontFamily: 'monospace', fontSize: '1.6rem', fontWeight: 900, color: '#0D5E6B', boxShadow: '0 2px 6px rgba(13,94,107,0.08)' },
  copyBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 16px', background: 'linear-gradient(135deg,#0D5E6B,#1A8FA0)', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: '0.875rem', cursor: 'pointer' },
  regenBtn: { width: 42, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F3F4F6', border: '1.5px solid #E5E7EB', borderRadius: 10, color: '#6B7280', cursor: 'pointer' },
  hint: { display: 'flex', alignItems: 'flex-start', gap: 8, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 12px', fontSize: '0.77rem', color: '#92400E', lineHeight: 1.5 },
  sectionLabel: { fontSize: '0.62rem', fontWeight: 800, color: '#6B7280', letterSpacing: '0.08em', marginBottom: 10 },
  // Connected rows
  connRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 12, marginBottom: 8 },
  connAvatar: { width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#0D5E6B,#1A8FA0)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.9rem', flexShrink: 0 },
  connName: { fontWeight: 700, fontSize: '0.87rem', color: '#065F46' },
  connSub: { fontSize: '0.72rem', color: '#6B7280', marginTop: 2 },
  disconnectBtn: { display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', background: '#FEE2E2', color: '#991B1B', border: '1px solid #FECACA', borderRadius: 8, fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' },
  // Search
  instructionText: { fontSize: '0.85rem', color: '#4B5563', lineHeight: 1.6, marginBottom: 14, marginTop: 0 },
  searchRow: { display: 'flex', gap: 10, marginBottom: 14 },
  searchInput: { flex: 1, padding: '12px 14px', borderRadius: 12, border: '2px solid #E5E7EB', fontSize: '1rem', fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.08em', outline: 'none', color: '#0D5E6B' },
  searchBtn: { width: 50, height: 50, borderRadius: 12, background: 'linear-gradient(135deg,#0D5E6B,#1A8FA0)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },
  resultCard: { display: 'flex', alignItems: 'center', gap: 12, background: '#F0FDF4', border: '1.5px solid #86EFAC', borderRadius: 12, padding: '13px 15px', marginBottom: 14 },
  resultAvatar: { width: 40, height: 40, borderRadius: 11, background: 'linear-gradient(135deg,#0D5E6B,#1A8FA0)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1rem', flexShrink: 0 },
  resultName: { fontWeight: 700, color: '#065F46', fontSize: '0.9rem' },
  resultSub: { fontSize: '0.73rem', color: '#6B7280', marginTop: 2 },
  requestBtn: { display: 'flex', alignItems: 'center', gap: 5, padding: '9px 14px', background: '#059669', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer', flexShrink: 0 },
  // Success
  successBox: { textAlign: 'center', padding: '12px 0 4px' },
  successTitle: { fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: '1.25rem', color: '#065F46', margin: '14px 0 8px' },
  successText: { fontSize: '0.88rem', color: '#4B5563', lineHeight: 1.6, maxWidth: 340, margin: '0 auto 20px' },
  doneBtn: { padding: '11px 28px', background: 'linear-gradient(135deg,#0D5E6B,#1A8FA0)', color: '#fff', border: 'none', borderRadius: 10, fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer' },
};
