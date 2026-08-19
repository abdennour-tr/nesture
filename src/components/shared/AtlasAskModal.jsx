import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Brain, User, X, Sparkles, ChevronRight, Trash2, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../../services/supabaseClient';
import { useAuthStore } from '../../store';

const SUGGESTIONS = [
  "What are the primary strengths I should focus on?",
  "How can I help with fine motor skills at home?",
  "What sensory strategies work best?",
  "Explain the reflex scores to me",
  "What communication methods should I try?",
  "What daily routine would you recommend?",
];

export default function AtlasAskModal({ isOpen, onClose, childName = 'your child', childId, profile }) {
  const { user, profile: authProfile } = useAuthStore();
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [child, setChild] = useState(null);
  const [localProfile, setLocalProfile] = useState(null);
  const [domainScores, setDomainScores] = useState(null);
  const [questionnaireResponses, setQuestionnaireResponses] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const targetId = childId || '00000000-0000-0000-0000-000000000010';
  const isUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

  // Load child record, profile, and validated documents when drawer is opened or childId changes
  useEffect(() => {
    async function loadData() {
      if (!isOpen || !user || !authProfile) return;

      // Strict child_id check
      if (!isUUID(targetId)) {
        setMessages([
          { id: 'greeting', sender: 'ai', text: "I do not have enough validated information. The child ID is invalid. Please select a valid child profile." }
        ]);
        return;
      }

      setLoading(true);
      try {
        // Clear messages first
        setMessages([]);

        // Fetch child
        const { data: childData } = await supabase
          .from('children')
          .select('*')
          .eq('id', targetId)
          .maybeSingle();
        setChild(childData);

        // Fetch profile
        const { data: profileData } = await supabase
          .from('atlas_profiles')
          .select('*')
          .eq('child_id', targetId)
          .maybeSingle();
        setLocalProfile(profileData);

        // Fetch validated documents
        const { data: docsData } = await supabase
          .from('documents')
          .select('*')
          .eq('child_id', targetId)
          .eq('status', 'definitive');
        setDocuments(docsData || []);

        // Fetch domain scores
        const { data: scoresData } = await supabase
          .from('atlas_domain_scores')
          .select('*')
          .eq('child_id', targetId)
          .maybeSingle();
        setDomainScores(scoresData);

        // Fetch questionnaire responses
        const { data: qResponsesData } = await supabase
          .from('atlas_questionnaire_responses')
          .select('*')
          .eq('child_id', targetId)
          .maybeSingle();
        setQuestionnaireResponses(qResponsesData);

        // Fetch chat history from DB
        const { data: dbMessages, error: dbError } = await supabase
          .from('ask_ai_messages')
          .select('*')
          .eq('user_id', authProfile.id)
          .eq('user_role', authProfile.role)
          .eq('child_id', targetId)
          .order('created_at', { ascending: true });

        if (dbError) throw dbError;

        const cName = childData?.first_name || childData?.name || childName || 'your child';
        const initialGreeting = {
          id: 'greeting',
          sender: 'ai',
          text: `Hi! I'm the Nesture AI assistant. I've analyzed ${cName}'s child profile and session history. What would you like to know?`
        };

        if (dbMessages && dbMessages.length > 0) {
          const mappedMsgs = dbMessages.map(m => ({
            id: m.id,
            sender: m.sender,
            text: m.text
          }));
          setMessages([initialGreeting, ...mappedMsgs]);
        } else {
          setMessages([initialGreeting]);
        }
      } catch (err) {
        console.error("Failed to load chat data", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [isOpen, targetId, user, authProfile]);

  // Scroll to bottom when messages list updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  if (!isOpen) return null;

  const handleSend = async (text) => {
    const userMsg = text.trim();
    if (!userMsg || !user || !authProfile) return;

    // Insert user message to DB
    const { data: insertedUserMsg, error: userMsgErr } = await supabase
      .from('ask_ai_messages')
      .insert([{
        user_id: authProfile.id,
        user_role: authProfile.role,
        child_id: targetId,
        sender: 'user',
        text: userMsg
      }])
      .select()
      .single();

    if (userMsgErr) {
      console.error("Failed to save user message", userMsgErr);
      return;
    }

    const newUserMsgObj = { id: insertedUserMsg.id, sender: 'user', text: userMsg };
    setMessages(prev => [...prev, newUserMsgObj]);
    setInputValue('');
    setIsTyping(true);

    const friendlyFallback = "I do not have enough information to answer your questions. Please complete the Atlas 360° questionnaire for this child in the dashboard first.";

    // Verify targetId is UUID and either domainScores or questionnaireResponses exist
    if (!isUUID(targetId) || (!domainScores && !questionnaireResponses)) {
      const { data: insertedAiMsg } = await supabase
        .from('ask_ai_messages')
        .insert([{
          user_id: authProfile.id,
          user_role: authProfile.role,
          child_id: targetId,
          sender: 'ai',
          text: friendlyFallback
        }])
        .select()
        .single();
      
      setMessages(prev => [...prev, { id: insertedAiMsg?.id || Date.now(), sender: 'ai', text: friendlyFallback }]);
      setIsTyping(false);
      return;
    }

    const activeChildName = child?.first_name || child?.name || childName || 'your child';

    const d2 = domainScores?.d2_score !== null && domainScores?.d2_score !== undefined ? `${domainScores.d2_score}` : 'Not assessed';
    const d3 = domainScores?.d3_score !== null && domainScores?.d3_score !== undefined ? `${domainScores.d3_score}` : 'Not assessed';
    const d4 = domainScores?.d4_score !== null && domainScores?.d4_score !== undefined ? `${domainScores.d4_score}` : 'Not assessed';
    const d5 = domainScores?.d5_score !== null && domainScores?.d5_score !== undefined ? `${domainScores.d5_score}` : 'Not assessed';
    const d6 = domainScores?.d6_score !== null && domainScores?.d6_score !== undefined ? `${domainScores.d6_score}` : 'Not assessed';
    const d7 = domainScores?.d7_score !== null && domainScores?.d7_score !== undefined ? `${domainScores.d7_score}` : 'Not assessed';
    const d8 = domainScores?.d8_score !== null && domainScores?.d8_score !== undefined ? `${domainScores.d8_score}` : 'Not assessed';
    const d9 = domainScores?.d9_score !== null && domainScores?.d9_score !== undefined ? `${domainScores.d9_score}` : 'Not assessed';
    const composite = domainScores?.composite_score !== null && domainScores?.composite_score !== undefined ? `${domainScores.composite_score}` : 'Not assessed';

    const strengthsChecklist = (questionnaireResponses?.d1_strengths_checklist || []).join(', ') || 'Not assessed';
    const communicationMode = questionnaireResponses?.d1_communication_mode || 'Not assessed';
    const supportPlan = domainScores?.d12_support_plan || 'Not assessed';
    const location = questionnaireResponses?.d11_location || 'Not assessed';
    const calmSpace = questionnaireResponses?.d11_calm_space || 'Not assessed';

    const systemPrompt = `You are a supportive educational assistant for the NestureAI platform. 
You have access to ${activeChildName}'s Atlas 360° profile built from a structured questionnaire filled by their parent/carer.

Profile data available:
- Domain scores (0-100): Social & Communication: ${d2}, 
  Academics & Learning: ${d3}, Behaviour & Regulation: ${d4},
  Sensory: ${d5}, Functional Wellness: ${d6}, 
  Motor Reflexes: ${d7}, Brain Development: ${d8}, 
  Daily Living: ${d9}, Composite: ${composite}
- Strengths: ${strengthsChecklist}
- Communication mode: ${communicationMode}
- Support Plan: ${supportPlan}
- Environment: ${location}, calm space: ${calmSpace}

Rules: 
- Use only the data provided above to answer questions
- Never ask the user to upload reports — the questionnaire IS the data source
- Use strengths-first language
- Say 'learner' not 'patient', 'support area' not 'deficit'
- Never suggest a diagnosis
- If data for a specific question is missing, say so honestly`;

    const apiMessages = [
      { role: 'system', content: systemPrompt }
    ];
    
    // Memory cleanup: filter out greetings and warning error logs
    const validHistory = messages.filter(msg => 
      msg.id !== 'greeting' && (
        msg.sender !== 'ai' || 
        (!msg.text.startsWith('Hi! I\'m the Nesture') && !msg.text.startsWith('Connection Error:'))
      )
    );
    // Limit memory context to 10 most recent messages
    const recentHistory = validHistory.slice(-10);

    recentHistory.forEach(msg => {
      apiMessages.push({ role: msg.sender === 'ai' ? 'assistant' : 'user', content: msg.text });
    });
    apiMessages.push({ role: 'user', content: userMsg });

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.REACT_APP_GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-20b',
          messages: apiMessages,
          temperature: 0.0, // strict deterministic responses
          max_tokens: 500,
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      const aiText = data.choices[0].message.content;

      // Save AI response to DB
      const { data: insertedAiMsg, error: aiMsgErr } = await supabase
        .from('ask_ai_messages')
        .insert([{
          user_id: authProfile.id,
          user_role: authProfile.role,
          child_id: targetId,
          sender: 'ai',
          text: aiText
        }])
        .select()
        .single();

      if (aiMsgErr) throw aiMsgErr;

      setMessages(prev => [...prev, { id: insertedAiMsg.id, sender: 'ai', text: aiText }]);
    } catch (error) {
      console.error("Groq API Error:", error);
      setMessages(prev => [...prev, { id: Date.now(), sender: 'ai', text: `Connection Error: ${error.message}. Please check console.` }]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleReset = async () => {
    if (window.confirm("Are you sure you want to reset the conversation history for this child?")) {
      try {
        const { error } = await supabase
          .from('ask_ai_messages')
          .delete()
          .eq('user_id', authProfile.id)
          .eq('user_role', authProfile.role)
          .eq('child_id', targetId);

        if (error) throw error;

        const cName = child?.first_name || child?.name || childName || 'your child';
        setMessages([
          { id: 'greeting', sender: 'ai', text: `Hi! I'm the Nesture AI assistant. I've analyzed ${cName}'s child profile and session history. What would you like to know?` }
        ]);
      } catch (err) {
        console.error("Failed to reset chat history", err);
      }
    }
  };

  const prepareSessionTransfer = () => {
    try {
      const transferPayload = {
        timestamp: Date.now(),
        sessionStorageData: {}
      };
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && (key.startsWith('sb-') || key === 'nesture-auth')) {
          transferPayload.sessionStorageData[key] = sessionStorage.getItem(key);
        }
      }
      localStorage.setItem('nesture_session_transfer_payload', JSON.stringify(transferPayload));
    } catch (err) {
      console.error("Failed to prepare session transfer", err);
    }
  };

  return (
    <div style={styles.overlay} className="drawer-overlay" onClick={onClose}>
      <style>{`
        .suggestions-container {
          padding: 0 20px 12px;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          overflow-y: auto;
          max-height: 180px;
          box-sizing: border-box;
        }
        .suggestions-container::-webkit-scrollbar {
          width: 4px;
        }
        .suggestions-container::-webkit-scrollbar-track {
          background: transparent;
        }
        .suggestions-container::-webkit-scrollbar-thumb {
          background: #E5E7EB;
          border-radius: 2px;
        }
        .suggestion-item {
          white-space: normal !important;
          word-wrap: break-word;
          word-break: break-word;
          text-align: left;
          padding: 10px 14px;
          background: #fff;
          border: 1.5px solid #E5E7EB;
          border-radius: 12px;
          font-size: 0.8rem;
          color: #4B5563;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          transition: all 0.2s ease-in-out;
          font-weight: 600;
          width: 100%;
          box-sizing: border-box;
          gap: 8px;
        }
        .suggestion-item:hover {
          border-color: #1A8FA0;
          background: #EEF6F8;
          color: #0D5E6B;
        }
        @media (min-width: 600px) {
          .suggestion-item {
            width: calc(50% - 4px);
          }
        }
      `}</style>
      {/* Side Panel Drawer */}
      <motion.div 
        style={styles.drawer}
        className="drawer-panel"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        onClick={(e) => e.stopPropagation()} // Stop propagation to prevent closing
      >
        {/* Header */}
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={styles.aiIconWrapper}>
              <Sparkles size={16} color="#fff" />
            </div>
            <div>
              <h2 style={styles.title}>Ask about {childName}</h2>
              <p style={styles.subtitle}>Powered by Atlas 360° questionnaire & NesturePlay data</p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Reset Chat Button */}
            <button 
              onClick={handleReset} 
              style={styles.resetBtn} 
              title="Reset Conversation"
            >
              <Trash2 size={16} />
            </button>

            {/* Open in new tab Link */}
            <Link 
              to={`/chat/${targetId}`} 
              target="_blank" 
              onClick={prepareSessionTransfer}
              style={styles.newTabLink}
              title="Open in new tab"
            >
              <ExternalLink size={16} />
            </Link>

            {/* Close Button */}
            <button onClick={onClose} style={styles.closeBtn} title="Close Chat">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Chat Area */}
        <div style={styles.chatArea}>
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div 
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                style={msg.sender === 'ai' ? styles.msgAiRow : styles.msgUserRow}
              >
                {msg.sender === 'ai' && (
                  <div style={styles.msgAvatarAi}><Brain size={14} color="#0D5E6B" /></div>
                )}
                
                <div style={msg.sender === 'ai' ? styles.msgAiBubble : styles.msgUserBubble}>
                  {msg.text}
                </div>

                {msg.sender === 'user' && (
                  <div style={styles.msgAvatarUser}><User size={14} color="#fff" /></div>
                )}
              </motion.div>
            ))}
            
            {isTyping && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={styles.msgAiRow}>
                <div style={styles.msgAvatarAi}><Brain size={14} color="#0D5E6B" /></div>
                <div style={styles.typingIndicator}>
                  <div style={styles.dot} />
                  <div style={{...styles.dot, animationDelay: '0.2s'}} />
                  <div style={{...styles.dot, animationDelay: '0.4s'}} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>

        {/* Suggestions */}
        {messages.length <= 2 && !isTyping && (
          <div className="suggestions-container">
            {SUGGESTIONS.map((sug, i) => (
              <button key={i} onClick={() => handleSend(sug)} className="suggestion-item">
                {sug} <ChevronRight size={12} style={{ marginLeft: 4, opacity: 0.5, flexShrink: 0 }} />
              </button>
            ))}
          </div>
        )}

        {/* Input Area */}
        <div style={styles.inputArea}>
          <input 
            type="text" 
            placeholder="Ask anything about the child profile..." 
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSend(inputValue);
            }}
            style={styles.input}
          />
          <button 
            onClick={() => handleSend(inputValue)}
            disabled={!inputValue.trim() || isTyping}
            style={{
              ...styles.sendBtn,
              opacity: (!inputValue.trim() || isTyping) ? 0.5 : 1
            }}
          >
            <Send size={16} />
          </button>
        </div>
      </motion.div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', 
    inset: 0, 
    zIndex: 9999,
    background: 'rgba(15,30,34,0.4)', 
    backdropFilter: 'blur(3px)',
    display: 'flex', 
    justifyContent: 'flex-end',
  },
  drawer: {
    background: '#fff', 
    width: '100%', 
    maxWidth: 450,
    boxShadow: '-10px 0 40px rgba(0,0,0,0.15)', 
    display: 'flex', 
    flexDirection: 'column',
    height: '100vh', 
    overflow: 'hidden',
  },
  header: {
    display: 'flex', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    padding: '16px 20px', 
    borderBottom: '1px solid #E5E7EB', 
    background: '#F9FAFB',
  },
  aiIconWrapper: {
    width: 36, 
    height: 36, 
    borderRadius: 10,
    background: 'linear-gradient(135deg, #1A8FA0, #23BFDB)',
    display: 'flex', 
    alignItems: 'center', 
    justifyContent: 'center',
  },
  title: {
    fontFamily: 'Inter, sans-serif', 
    fontSize: '1.05rem', 
    fontWeight: 800, 
    color: '#111827', 
    margin: 0,
    letterSpacing: '-0.01em',
  },
  subtitle: {
    fontSize: '0.72rem', 
    color: '#6B7280', 
    margin: 0,
  },
  resetBtn: {
    background: 'transparent',
    border: 'none',
    color: '#EF4444',
    cursor: 'pointer',
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    transition: 'background 0.2s',
    '&:hover': {
      background: '#FFF5F5',
    }
  },
  newTabLink: {
    color: '#0D5E6B',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: '50%',
    transition: 'background 0.2s',
  },
  closeBtn: {
    background: 'transparent', 
    border: 'none', 
    color: '#9CA3AF', 
    cursor: 'pointer',
    width: 32, 
    height: 32, 
    display: 'flex', 
    alignItems: 'center', 
    justifyContent: 'center',
    borderRadius: '50%', 
    transition: 'background 0.2s',
  },
  chatArea: {
    flex: 1, 
    padding: 20, 
    overflowY: 'auto', 
    display: 'flex', 
    flexDirection: 'column', 
    gap: 16,
    background: '#fff',
  },
  msgAiRow: {
    display: 'flex', 
    gap: 10, 
    alignItems: 'flex-start', 
    maxWidth: '88%',
  },
  msgUserRow: {
    display: 'flex', 
    gap: 10, 
    alignItems: 'flex-start', 
    maxWidth: '88%', 
    alignSelf: 'flex-end',
    flexDirection: 'row-reverse',
  },
  msgAvatarAi: {
    width: 26, 
    height: 26, 
    borderRadius: '50%', 
    background: '#EEF6F8',
    display: 'flex', 
    alignItems: 'center', 
    justifyContent: 'center', 
    flexShrink: 0,
    border: '1px solid #C8E8ED',
  },
  msgAvatarUser: {
    width: 26, 
    height: 26, 
    borderRadius: '50%', 
    background: '#111827',
    display: 'flex', 
    alignItems: 'center', 
    justifyContent: 'center', 
    flexShrink: 0,
  },
  msgAiBubble: {
    background: '#F3F4F6', 
    color: '#1F2937', 
    padding: '12px 16px', 
    borderRadius: '4px 18px 18px 18px',
    fontSize: '0.92rem', 
    lineHeight: 1.55, 
    boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
  },
  msgUserBubble: {
    background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)', 
    color: '#fff', 
    padding: '12px 16px',
    borderRadius: '18px 4px 18px 18px', 
    fontSize: '0.92rem', 
    lineHeight: 1.55, 
    boxShadow: '0 4px 10px rgba(13,94,107,0.12)',
  },
  typingIndicator: {
    background: '#F3F4F6', 
    padding: '12px 18px', 
    borderRadius: '4px 18px 18px 18px',
    display: 'flex', 
    gap: 5, 
    alignItems: 'center',
  },
  dot: {
    width: 5, 
    height: 5, 
    background: '#9CA3AF', 
    borderRadius: '50%',
    animation: 'pulse 1.4s infinite ease-in-out both',
  },
  suggestionsWrapper: {
    padding: '0 20px 12px', 
    display: 'flex', 
    gap: 8, 
    overflowX: 'auto', 
    paddingBottom: 12,
    scrollbarWidth: 'none', 
  },
  suggestionBtn: {
    whiteSpace: 'nowrap', 
    padding: '8px 14px', 
    background: '#fff', 
    border: '1.5px solid #E5E7EB',
    borderRadius: 18, 
    fontSize: '0.78rem', 
    color: '#4B5563', 
    cursor: 'pointer', 
    display: 'flex', 
    alignItems: 'center',
    transition: 'all 0.2s', 
    flexShrink: 0, 
    fontWeight: 600,
  },
  inputArea: {
    padding: '14px 20px 20px', 
    borderTop: '1px solid #E5E7EB', 
    background: '#fff', 
    display: 'flex', 
    gap: 10,
  },
  input: {
    flex: 1, 
    padding: '12px 18px', 
    background: '#F9FAFB', 
    border: '1.5px solid #E5E7EB',
    borderRadius: 22, 
    fontSize: '0.92rem', 
    color: '#1F2937', 
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  sendBtn: {
    width: 44, 
    height: 44, 
    borderRadius: 22, 
    background: '#0D5E6B', 
    color: '#fff',
    border: 'none', 
    display: 'flex', 
    alignItems: 'center', 
    justifyContent: 'center', 
    cursor: 'pointer',
    transition: 'all 0.2s',
  }
};
