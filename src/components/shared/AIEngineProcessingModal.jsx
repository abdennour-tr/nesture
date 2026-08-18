import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Target, Compass, Activity, Shield, UserCheck, CheckCircle, Brain, X } from 'lucide-react';

const AGENTS = [
  { id: 'doc', name: 'Document Intelligence', desc: 'Extracting key reports and metrics', icon: <FileText size={18} /> },
  { id: 'dev', name: 'Development Profile', desc: 'Mapping strengths & challenges', icon: <Target size={18} /> },
  { id: 'home', name: 'Home Strategy', desc: 'Formulating daily routines', icon: <Compass size={18} /> },
  { id: 'reflex', name: 'Primitive Motor Reflex', desc: 'Analyzing foundational patterns', icon: <Activity size={18} /> },
  { id: 'wellness', name: 'Functional Wellness', desc: 'Deriving systemic insights', icon: <Shield size={18} /> },
  { id: 'care', name: 'Care Navigator', desc: 'Synthesizing final profile', icon: <UserCheck size={18} /> }
];

export default function AIEngineProcessingModal({ isOpen, isDone, hasError, onClose }) {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setCurrentStep(0);
      return;
    }

    if (hasError) {
      return; // Stop progress if there's an error
    }

    if (isDone) {
      // Quickly finish remaining steps
      setCurrentStep(AGENTS.length);
      const timer = setTimeout(() => {
        onClose();
      }, 2000);
      return () => clearTimeout(timer);
    }

    // Simulate progress: advance one step every 2.5 seconds
    const interval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev < AGENTS.length - 1) {
          return prev + 1;
        }
        return prev; 
      });
    }, 2500);

    return () => clearInterval(interval);
  }, [isOpen, isDone, hasError]); // Removed onClose to prevent interval resets

  return (
    <AnimatePresence>
      {isOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 30, 34, 0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 10000,
          backdropFilter: 'blur(4px)',
        }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          style={{
            background: '#ffffff',
            borderRadius: '24px',
            padding: '28px 36px',
            width: '100%',
            maxWidth: '600px',
            boxShadow: '0 24px 60px rgba(0,0,0,0.2)',
            position: 'relative',
            maxHeight: '85vh',
            overflowY: 'auto'
          }}
        >
          {/* Close button shown only on complete or error */}
          {(isDone || hasError) && (
            <button 
              onClick={onClose} 
              style={{
                position: 'absolute', top: 16, right: 16, background: '#F3F4F6', border: 'none',
                borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: '#6B7280', cursor: 'pointer', zIndex: 10,
              }}
            >
              <X size={20} />
            </button>
          )}

          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16, background: '#EEF6F8', border: '2px solid #C8E8ED',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px',
              animation: isDone ? 'none' : 'spinPulse 2s infinite'
            }}>
              {isDone ? (
                <CheckCircle size={32} color="#10B981" />
              ) : (
                <Brain size={32} color="#0D5E6B" />
              )}
            </div>
            <h2 style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.5rem', fontWeight: 800, color: '#0D5E6B', margin: '0 0 6px 0' }}>
              {isDone ? 'Analysis Complete' : hasError ? 'Processing Failed' : 'AI Engine Processing'}
            </h2>
            <p style={{ color: '#6B7280', fontSize: '0.9rem', margin: 0 }}>
              {isDone ? 'Your updated Atlas Profile is ready.' : hasError ? 'An error occurred during report analysis.' : 'Our 6-agent cognitive pipeline is processing your new document...'}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {AGENTS.map((agent, index) => {
              const isCompleted = index < currentStep || isDone;
              const isCurrent = index === currentStep && !isDone && !hasError;
              const isPending = index > currentStep && !isDone;

              return (
                <motion.div 
                  key={agent.id}
                  animate={{ x: isCurrent ? 10 : 0 }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 16,
                    padding: '12px 16px',
                    borderRadius: '14px',
                    border: '1px solid transparent',
                    transition: 'all 0.3s ease',
                    opacity: isPending ? 0.4 : 1,
                    background: isCurrent ? '#EEF6F8' : 'transparent',
                    borderColor: isCurrent ? '#1A8FA0' : 'transparent'
                  }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.3s ease',
                    background: isCompleted ? '#10B981' : isCurrent ? '#1A8FA0' : '#E5E7EB',
                    color: isCompleted || isCurrent ? '#fff' : '#9CA3AF'
                  }}>
                    {isCompleted ? <CheckCircle size={16} /> : agent.icon}
                  </div>
                  
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <div style={{ fontWeight: 700, color: isCurrent ? '#0D5E6B' : '#374151', fontSize: '0.9rem' }}>
                      {agent.name}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#6B7280' }}>
                      {isCompleted ? 'Complete' : isCurrent ? 'Processing...' : agent.desc}
                    </div>
                  </div>

                  {isCurrent && (
                    <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2, borderColor: '#EEF6F8', borderTopColor: '#0D5E6B' }} />
                  )}
                </motion.div>
              );
            })}
          </div>
          
          {hasError && (
             <button onClick={onClose} style={{
                marginTop: 24, width: '100%', padding: '14px', background: '#EF4444', color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, cursor: 'pointer', fontSize: '0.95rem'
             }}>
                 Close
             </button>
          )}

          <style>{`
            @keyframes spinPulse {
              0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(13,94,107,0.2); }
              50% { transform: scale(1.05); box-shadow: 0 0 0 8px rgba(13,94,107,0.1); }
              100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(13,94,107,0); }
            }
          `}</style>
        </motion.div>
      </div>
      )}
    </AnimatePresence>
  );
}
