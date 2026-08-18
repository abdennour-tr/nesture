import React, { useState, useRef, useEffect } from 'react';
import { Bell, TrendingUp, TrendingDown, Star, BrainCircuit, Activity, Shield, Check, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../services/supabaseClient';
import { useAuthStore } from '../../store';

export default function SmartNotifications({ notifications: propNotifs = [] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'unread' | 'read'
  const dropdownRef = useRef(null);
  const { user } = useAuthStore();

  // ── Read Status Tracking ──
  const [readIds, setReadIds] = useState(() => {
    try {
      const key = user?.id ? `nesture_read_notifs_${user.id}` : 'nesture_read_notifs';
      return JSON.parse(localStorage.getItem(key) || '[]');
    } catch {
      return [];
    }
  });

  // Load read status from Supabase on mount or when user changes
  useEffect(() => {
    async function loadReadStatusFromDB() {
      if (!user?.id) return;
      try {
        // 1. Try reading from Supabase Auth user_metadata
        const { data: authData } = await supabase.auth.getUser();
        const remoteReadIds = authData?.user?.user_metadata?.read_notifications;
        
        if (Array.isArray(remoteReadIds) && remoteReadIds.length > 0) {
          setReadIds(remoteReadIds);
          localStorage.setItem(`nesture_read_notifs_${user.id}`, JSON.stringify(remoteReadIds));
          return;
        }

        // 2. Try reading from public.users table read_notifications
        const { data: dbUser } = await supabase
          .from('users')
          .select('read_notifications')
          .eq('id', user.id)
          .maybeSingle();

        if (Array.isArray(dbUser?.read_notifications) && dbUser.read_notifications.length > 0) {
          setReadIds(dbUser.read_notifications);
          localStorage.setItem(`nesture_read_notifs_${user.id}`, JSON.stringify(dbUser.read_notifications));
          return;
        }

        // 3. Fallback to user-keyed localStorage
        const local = localStorage.getItem(`nesture_read_notifs_${user.id}`);
        if (local) {
          setReadIds(JSON.parse(local));
        }
      } catch (err) {
        console.warn('[Notifications] Could not load read status from DB:', err?.message || err);
      }
    }

    loadReadStatusFromDB();
  }, [user?.id]);

  const allNotifs = propNotifs.slice(0, 15);
  const unreadCount = allNotifs.filter(n => !readIds.includes(n.id)).length;

  const filteredNotifs = allNotifs.filter(n => {
    const isRead = readIds.includes(n.id);
    if (activeFilter === 'unread') return !isRead;
    if (activeFilter === 'read') return isRead;
    return true;
  });

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  const updateReadIds = async (newReadIds) => {
    setReadIds(newReadIds);
    if (user?.id) {
      localStorage.setItem(`nesture_read_notifs_${user.id}`, JSON.stringify(newReadIds));
      try {
        // Persist to Supabase Auth metadata server-side
        await supabase.auth.updateUser({
          data: { read_notifications: newReadIds }
        });
        // Also persist to public.users table read_notifications column if exists
        await supabase.from('users').update({
          read_notifications: newReadIds
        }).eq('id', user.id);
      } catch (err) {
        console.warn('[Notifications] Save to DB warning:', err?.message || err);
      }
    } else {
      localStorage.setItem('nesture_read_notifs', JSON.stringify(newReadIds));
    }
  };

  const toggleReadStatus = (id) => {
    let newReadIds;
    if (readIds.includes(id)) {
      newReadIds = readIds.filter(x => x !== id);
    } else {
      newReadIds = [...readIds, id];
    }
    updateReadIds(newReadIds);
  };

  const handleMarkAllRead = () => {
    const newReadIds = [...new Set([...readIds, ...allNotifs.map(n => n.id)])].slice(-100);
    updateReadIds(newReadIds);
  };

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const getIcon = (iconName, color) => {
    if (React.isValidElement(iconName)) return iconName;
    if (iconName === 'Star') return <Star size={16} color={color || "#E8841A"} />;
    if (iconName === 'Activity') return <Activity size={16} color={color || "#10B981"} />;
    if (iconName === 'TrendingDown') return <TrendingDown size={16} color={color || "#EF4444"} />;
    if (iconName === 'BrainCircuit') return <BrainCircuit size={16} color={color || "#0D5E6B"} />;
    if (iconName === 'Shield') return <Shield size={16} color={color || "#6B7280"} />;
    return <Bell size={16} color={color || "#4B5563"} />;
  };

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      {/* Bell Button */}
      <button 
        onClick={handleToggle}
        style={styles.bellBtn}
        aria-label="Toggle notifications menu"
      >
        <Bell size={20} color="#4B5563" />
        {unreadCount > 0 && (
          <motion.div 
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            style={styles.badge}
          >
            {unreadCount}
          </motion.div>
        )}
      </button>

      {/* Dropdown Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            style={styles.dropdown}
          >
            <div style={styles.header}>
              <div>
                <h3 style={styles.title}>Smart Notifications</h3>
                <span style={styles.subtitle}>Powered by NestureAI</span>
              </div>
              {unreadCount > 0 && (
                <button 
                  onClick={handleMarkAllRead}
                  style={styles.markAllBtn}
                  title="Mark all notifications as read"
                >
                  Mark all read
                </button>
              )}
            </div>

            {/* Filter Tabs */}
            <div style={styles.tabsRow}>
              {[
                { id: 'all', label: 'All' },
                { id: 'unread', label: `Unread (${unreadCount})` },
                { id: 'read', label: 'Read' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveFilter(tab.id)}
                  style={{
                    ...styles.tabBtn,
                    ...(activeFilter === tab.id ? styles.tabBtnActive : {})
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* List */}
            <div style={styles.list}>
              {filteredNotifs.length === 0 ? (
                <div style={styles.empty}>
                  {activeFilter === 'unread' 
                    ? 'No unread notifications' 
                    : activeFilter === 'read' 
                      ? 'No read notifications' 
                      : 'No notifications yet — start a session!'}
                </div>
              ) : (
                filteredNotifs.map((notif) => {
                  const isUnread = !readIds.includes(notif.id);
                  return (
                    <motion.div 
                      layout 
                      key={notif.id} 
                      style={{ 
                        ...styles.item, 
                        background: isUnread ? '#F0FAFB' : '#fff',
                        borderLeft: isUnread ? '4px solid #1A8FA0' : '4px solid transparent'
                      }}
                    >
                      <div style={{ ...styles.iconWrap, background: notif.bg }}>
                        {getIcon(notif.icon)}
                      </div>
                      <div style={{ flex: 1, paddingRight: 4 }}>
                        <div style={styles.itemHeader}>
                          <span style={styles.itemTitle}>
                            {notif.title}
                          </span>
                          <span style={styles.itemTime}>{notif.time}</span>
                        </div>
                        <p style={styles.itemMsg}>{notif.message}</p>
                      </div>

                      {/* Manual Read status toggle */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleReadStatus(notif.id);
                        }}
                        style={styles.toggleReadBtn}
                        title={isUnread ? "Mark as read" : "Mark as unread"}
                        aria-label={isUnread ? "Mark as read" : "Mark as unread"}
                      >
                        {isUnread ? (
                          <div style={styles.unreadCircle} />
                        ) : (
                          <Check size={14} color="#9CA3AF" />
                        )}
                      </button>
                    </motion.div>
                  );
                })
              )}
            </div>

            {allNotifs.length > 0 && (
              <div style={styles.footer}>
                <span style={styles.footerText}>Showing latest {allNotifs.length} notification{allNotifs.length > 1 ? 's' : ''}</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const styles = {
  bellBtn: {
    background: '#fff', border: '1px solid #E5E7EB', borderRadius: '50%',
    width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', position: 'relative', transition: 'all 0.2s',
    boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
  },
  badge: {
    position: 'absolute', top: -2, right: -2, background: '#EF4444', color: '#fff',
    fontSize: '0.65rem', fontWeight: 800, width: 18, height: 18, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff'
  },
  dropdown: {
    position: 'absolute', top: 48, right: 0, width: 380, background: '#fff',
    borderRadius: 16, boxShadow: '0 10px 40px rgba(0,0,0,0.12)', border: '1px solid #E5E7EB',
    zIndex: 100, overflow: 'hidden', display: 'flex', flexDirection: 'column'
  },
  header: {
    padding: '16px 20px', borderBottom: '1px solid #F3F4F6', background: '#F9FAFB',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
  },
  title: {
    margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#111827', fontFamily: 'Inter, sans-serif'
  },
  subtitle: {
    fontSize: '0.7rem', color: '#1A8FA0', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase'
  },
  markAllBtn: {
    background: 'none', border: 'none', color: '#1A8FA0', fontSize: '0.75rem', fontWeight: 700,
    cursor: 'pointer', padding: '4px 8px', borderRadius: 6, transition: 'all 0.2s',
    fontFamily: 'Inter, sans-serif'
  },
  tabsRow: {
    display: 'flex', borderBottom: '1px solid #F3F4F6', background: '#fff', padding: '6px 12px', gap: 4
  },
  tabBtn: {
    background: 'none', border: 'none', padding: '6px 10px', fontSize: '0.75rem', fontWeight: 600,
    color: '#6B7280', cursor: 'pointer', borderRadius: 8, transition: 'all 0.2s',
    fontFamily: 'Inter, sans-serif'
  },
  tabBtnActive: {
    background: '#EEF6F8', color: '#0D5E6B', fontWeight: 800
  },
  list: {
    maxHeight: 400, overflowY: 'auto', display: 'flex', flexDirection: 'column'
  },
  empty: {
    padding: 32, textAlign: 'center', color: '#9CA3AF', fontSize: '0.85rem'
  },
  item: {
    padding: '16px 20px', borderBottom: '1px solid #F3F4F6', display: 'flex', gap: 14,
    alignItems: 'flex-start', transition: 'background 0.2s', cursor: 'default',
    position: 'relative'
  },
  iconWrap: {
    width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
  },
  itemHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4
  },
  itemTitle: {
    fontSize: '0.85rem', fontWeight: 700, color: '#1F2937', display: 'flex', alignItems: 'center', gap: 6
  },
  itemTime: {
    fontSize: '0.7rem', color: '#9CA3AF'
  },
  itemMsg: {
    margin: 0, fontSize: '0.8rem', color: '#4B5563', lineHeight: 1.5
  },
  toggleReadBtn: {
    background: 'none', border: 'none', width: 24, height: 24, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    alignSelf: 'center', marginLeft: 8, padding: 0
  },
  unreadCircle: {
    width: 10, height: 10, borderRadius: '50%', background: '#1A8FA0',
    transition: 'all 0.2s'
  },
  footer: {
    padding: '12px 20px', background: '#F9FAFB', borderTop: '1px solid #F3F4F6', textAlign: 'center'
  },
  footerText: {
    fontSize: '0.75rem', color: '#9CA3AF', fontWeight: 600
  }
};
