import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

export default function VideoModal({ isOpen, onClose, videoUrl, title = 'Exercise Video' }) {
  if (!isOpen || !videoUrl) return null;

  return (
    <AnimatePresence>
      <div 
        style={{ 
          position: 'fixed', inset: 0, zIndex: 9999, 
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '20px'
        }}
      >
        <motion.div 
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }} 
          exit={{ opacity: 0 }}
          style={{ 
            position: 'absolute', inset: 0, 
            background: 'rgba(0, 0, 0, 0.85)', backdropFilter: 'blur(4px)' 
          }}
          onClick={onClose}
        />
        
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 20 }} 
          animate={{ opacity: 1, scale: 1, y: 0 }} 
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          style={{ 
            position: 'relative', width: '100%', maxWidth: 800, 
            background: '#000', borderRadius: 16, overflow: 'hidden',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }}
        >
          {/* Header */}
          <div style={{ 
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
            padding: '16px 20px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), rgba(0,0,0,0))',
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10
          }}>
            <h3 style={{ margin: 0, color: '#fff', fontSize: '1.1rem', fontWeight: 600, textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>
              {title}
            </h3>
            <button 
              onClick={onClose}
              style={{ 
                background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '50%',
                width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', cursor: 'pointer', backdropFilter: 'blur(4px)'
              }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Video Player */}
          <video 
            src={videoUrl} 
            controls 
            autoPlay 
            style={{ width: '100%', height: 'auto', maxHeight: '80vh', display: 'block' }}
          >
            Your browser does not support the video tag.
          </video>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
