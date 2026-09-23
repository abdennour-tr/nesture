import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Brain, User, Sparkles, ChevronRight, Trash2, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import Sidebar from '../components/shared/Sidebar';
import BetaFooter from '../components/shared/BetaFooter';
import { supabase } from '../services/supabaseClient';
import { useAuthStore } from '../store';

const SUGGESTIONS = [
  "What are the primary strengths I should focus on?",
  "How can I help with fine motor skills at home?",
  "What sensory strategies work best?",
  "Explain the reflex scores to me",
  "What communication methods should I try?",
  "What daily routine would you recommend?",
];

export default function ChatPage() {
  const { childId } = useParams();
  const navigate = useNavigate();
  const { user, profile: authProfile } = useAuthStore();

  const [child, setChild] = useState(null);
  const [profile, setProfile] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState([]);

  const messagesEndRef = useRef(null);

  // Load child profile data and chat history on mount / childId change
  useEffect(() => {
    async function loadData() {
      if (!childId || !user || !authProfile) return;
      setLoading(true);
      try {
        const isUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
        const targetId = isUUID(childId) ? childId : '00000000-0000-0000-0000-000000000010';

        // Clear messages to prevent flash of old child's chat or old user's chat
        setMessages([]);
        setChild(null);
        setProfile(null);
        setDocuments([]);

        // Fetch child record
        const { data: childData } = await supabase
          .from('children').select('*').eq('id', targetId).maybeSingle();
        if (childData) setChild(childData);

        // Fetch atlas profile
        const { data: profileData } = await supabase
          .from('atlas_profiles').select('*').eq('child_id', targetId).maybeSingle();
        if (profileData) setProfile(profileData);

        // Fetch validated documents
        const { data: docsData } = await supabase
          .from('documents')
          .select('*')
          .eq('child_id', targetId)
          .eq('status', 'definitive');
        setDocuments(docsData || []);

        // Fetch chat history from DB
        const { data: dbMessages, error: dbError } = await supabase
          .from('ask_ai_messages')
          .select('*')
          .eq('user_id', authProfile.id)
          .eq('user_role', authProfile.role)
          .eq('child_id', targetId)
          .order('created_at', { ascending: true });

        if (dbError) throw dbError;

        const cName = childData?.first_name || childData?.name || 'your child';
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
        console.error("Failed to load Chat page data", err);
        toast.error("Error loading chat workspace");
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [childId, user, authProfile]);

  // Scroll to bottom when typing or new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSend = async (text) => {
    const userMsg = text.trim();
    if (!userMsg || !user || !authProfile) return;

    const isUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    const targetId = isUUID(childId) ? childId : '00000000-0000-0000-0000-000000000010';

    // Optimistic local bubble — the edge function below is the one that
    // actually persists the user message and the AI reply to ask_ai_messages.
    const tempId = `local-${Date.now()}`;
    setMessages(prev => [...prev, { id: tempId, sender: 'user', text: userMsg }]);
    setInputValue('');
    setIsTyping(true);

    // The prompt, the Groq call (with the Groq key) and the de-identification
    // of the child's name now all happen server-side in the ask-ai-chat edge
    // function — the browser never sees the AI provider's API key.
    try {
      const { data, error } = await supabase.functions.invoke('ask-ai-chat', {
        body: { childId: targetId, message: userMsg },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'The AI assistant could not answer that.');

      setMessages(prev => [
        ...prev.filter(m => m.id !== tempId),
        { id: data.userMessageId || tempId, sender: 'user', text: userMsg },
        { id: data.aiMessageId || Date.now(), sender: 'ai', text: data.aiText },
      ]);
    } catch (error) {
      console.error("ask-ai-chat error:", error);
      setMessages(prev => [...prev, { id: Date.now(), sender: 'ai', text: `Connection Error: ${error.message}. Please try again.` }]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleReset = async () => {
    if (window.confirm("Are you sure you want to reset the conversation history for this child?")) {
      const isUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
      const targetId = isUUID(childId) ? childId : '00000000-0000-0000-0000-000000000010';

      try {
        const { error } = await supabase
          .from('ask_ai_messages')
          .delete()
          .eq('user_id', authProfile.id)
          .eq('user_role', authProfile.role)
          .eq('child_id', targetId);

        if (error) throw error;

        const cName = child?.first_name || child?.name || 'your child';
        setMessages([
          { id: 'greeting', sender: 'ai', text: `Hi! I'm the Nesture AI assistant. I've analyzed ${cName}'s child profile and session history. What would you like to know?` }
        ]);
        toast.success("Conversation history cleared");
      } catch (err) {
        console.error("Failed to reset chat history", err);
        toast.error("Failed to reset chat");
      }
    }
  };

  const NAV = [
    { to: '/parent', label: 'Back to Dashboard', icon: <ArrowLeft size={18} /> }
  ];

  const childName = child?.name || child?.first_name || 'Learner';

  return (
    <div className="page-layout" style={styles.root}>
      <style>{`
        .chat-suggestions-container {
          padding: 0 32px 16px;
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          overflow-y: auto;
          max-height: 200px;
          box-sizing: border-box;
        }
        .chat-suggestions-container::-webkit-scrollbar {
          width: 4px;
        }
        .chat-suggestions-container::-webkit-scrollbar-track {
          background: transparent;
        }
        .chat-suggestions-container::-webkit-scrollbar-thumb {
          background: #E5E7EB;
          border-radius: 2px;
        }
        .chat-suggestion-item {
          white-space: normal !important;
          word-wrap: break-word;
          word-break: break-word;
          text-align: left;
          padding: 10px 16px;
          background: #fff;
          border: 1.5px solid #E5E7EB;
          border-radius: 12px;
          font-size: 0.85rem;
          color: #4B5563;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          transition: all 0.2s ease-in-out;
          font-weight: 600;
          width: 100%;
          box-sizing: border-box;
          gap: 10px;
        }
        .chat-suggestion-item:hover {
          border-color: #1A8FA0;
          background: #EEF6F8;
          color: #0D5E6B;
        }
        @media (min-width: 640px) {
          .chat-suggestion-item {
            width: calc(50% - 5px);
          }
        }
        @media (min-width: 1024px) {
          .chat-suggestion-item {
            width: calc(33.333% - 7px);
          }
        }
      `}</style>
      <Sidebar navItems={NAV} />
      
      <main className="main-content" style={styles.main}>
        {loading ? (
          <div style={styles.spinnerWrapper}>
            <div className="spinner" />
          </div>
        ) : (
          <div style={styles.chatContainer}>
            {/* Header */}
            <div style={styles.chatHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={styles.aiIconWrapper}>
                  <Sparkles size={20} color="#fff" />
                </div>
                <div>
                  <h1 style={styles.chatTitle}>Ask about {childName}</h1>
                  <p style={styles.chatSubtitle}>Powered by specialists reports & NesturePlay data</p>
                </div>
              </div>

              <button 
                onClick={handleReset} 
                style={styles.resetBtn}
                title="Reset Conversation"
              >
                <Trash2 size={16} /> Reset Chat
              </button>
            </div>

            {/* Messages */}
            <div style={styles.chatArea}>
              <AnimatePresence initial={false}>
                {messages.map((msg) => (
                  <motion.div 
                    key={msg.id}
                    initial={{ opacity: 0, y: 12 }}
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
              <div className="chat-suggestions-container">
                {SUGGESTIONS.map((sug, i) => (
                  <button key={i} onClick={() => handleSend(sug)} className="chat-suggestion-item">
                    {sug} <ChevronRight size={12} style={{ marginLeft: 4, opacity: 0.5, flexShrink: 0 }} />
                  </button>
                ))}
              </div>
            )}

            {/* Input */}
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
                <Send size={18} />
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const styles = {
  root: {
    background: '#F9FAFB',
    display: 'flex',
    minHeight: '100vh',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '24px',
    height: '100vh',
    overflow: 'hidden',
    boxSizing: 'border-box',
  },
  spinnerWrapper: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatContainer: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    background: '#fff',
    borderRadius: 24,
    border: '1px solid #E5E7EB',
    boxShadow: '0 4px 24px rgba(0,0,0,0.03)',
    overflow: 'hidden',
    height: '100%',
  },
  chatHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 32px',
    borderBottom: '1px solid #E5E7EB',
    background: '#F9FAFB',
  },
  aiIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 14,
    background: 'linear-gradient(135deg, #1A8FA0, #23BFDB)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 12px rgba(26,143,160,0.3)',
  },
  chatTitle: {
    fontFamily: 'Inter, sans-serif',
    fontSize: '1.4rem',
    fontWeight: 800,
    color: '#111827',
    margin: 0,
    letterSpacing: '-0.02em',
  },
  chatSubtitle: {
    fontSize: '0.82rem',
    color: '#6B7280',
    margin: '2px 0 0 0',
  },
  resetBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 16px',
    background: '#FFF5F5',
    color: '#E53E3E',
    border: '1px solid #FED7D7',
    borderRadius: 10,
    fontSize: '0.85rem',
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  chatArea: {
    flex: 1,
    padding: '32px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    background: '#fff',
  },
  msgAiRow: {
    display: 'flex',
    gap: 12,
    alignItems: 'flex-start',
    maxWidth: '80%',
  },
  msgUserRow: {
    display: 'flex',
    gap: 12,
    alignItems: 'flex-start',
    maxWidth: '80%',
    alignSelf: 'flex-end',
    flexDirection: 'row-reverse',
  },
  msgAvatarAi: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: '#EEF6F8',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    border: '1.5px solid #C8E8ED',
  },
  msgAvatarUser: {
    width: 32,
    height: 32,
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
    padding: '16px 20px',
    borderRadius: '4px 20px 20px 20px',
    fontSize: '0.98rem',
    lineHeight: 1.6,
    boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
  },
  msgUserBubble: {
    background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
    color: '#fff',
    padding: '16px 20px',
    borderRadius: '20px 4px 20px 20px',
    fontSize: '0.98rem',
    lineHeight: 1.6,
    boxShadow: '0 4px 12px rgba(13,94,107,0.15)',
  },
  typingIndicator: {
    background: '#F3F4F6',
    padding: '18px 24px',
    borderRadius: '4px 20px 20px 20px',
    display: 'flex',
    gap: 6,
    alignItems: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    background: '#9CA3AF',
    borderRadius: '50%',
    animation: 'pulse 1.4s infinite ease-in-out both',
  },
  suggestionsWrapper: {
    padding: '0 32px 16px',
    display: 'flex',
    gap: 10,
    overflowX: 'auto',
    paddingBottom: 16,
    scrollbarWidth: 'none',
  },
  suggestionBtn: {
    whiteSpace: 'nowrap',
    padding: '10px 18px',
    background: '#fff',
    border: '1.5px solid #E5E7EB',
    borderRadius: 24,
    fontSize: '0.85rem',
    color: '#4B5563',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    transition: 'all 0.2s',
    flexShrink: 0,
    fontWeight: 600,
  },
  inputArea: {
    padding: '20px 32px 28px',
    borderTop: '1px solid #E5E7EB',
    background: '#fff',
    display: 'flex',
    gap: 16,
  },
  input: {
    flex: 1,
    padding: '16px 24px',
    background: '#F9FAFB',
    border: '1.5px solid #E5E7EB',
    borderRadius: 28,
    fontSize: '1rem',
    color: '#1F2937',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  sendBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    background: '#0D5E6B',
    color: '#fff',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s',
    boxShadow: '0 4px 12px rgba(13,94,107,0.2)',
  }
};
