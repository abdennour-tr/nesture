import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LogOut, Menu, X } from 'lucide-react';
import { useAuthStore } from '../../store';
import BetaBadge from './BetaBadge';
import toast from 'react-hot-toast';

export default function Sidebar({ navItems, activeId, onNavClick }) {
  const { user, profile, logout } = useAuthStore();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);

  const handleLogout = () => {
    logout();
    toast.success('Logged out');
    navigate('/login');
  };

  const toggleSidebar = () => setIsOpen(!isOpen);

  return (
    <>
      {/* Mobile Menu Button - Floating */}
      <button 
        className="mobile-menu-btn"
        onClick={toggleSidebar}
        style={styles.mobileMenuBtn}
      >
        {isOpen ? <X size={20} /> : <Menu size={20} />}
        <span>Menu</span>
      </button>

      {/* Sidebar Overlay */}
      {isOpen && (
        <div 
          className="sidebar-overlay" 
          onClick={() => setIsOpen(false)}
          style={styles.overlay}
        />
      )}

      <aside 
        style={{
          ...styles.sidebar,
          ...(isOpen ? styles.sidebarOpen : {})
        }} 
        className={`sidebar ${isOpen ? 'is-open' : ''}`}
      >
        {/* Decorative glow */}
        <div style={styles.glow} />

        {/* Logo */}
        <div style={styles.logo} className="sidebar-logo">
          <img src="/logo.png" alt="NestureAI Logo" style={{ width: 36, height: 36, objectFit: 'contain' }} />
          <div className="sidebar-logo-text">
            <div style={{...styles.logoName, whiteSpace: 'nowrap'}}>
              <span style={{ color: '#fff' }}>Nesture</span>
              <span style={{ color: '#F59E0B' }}>AI</span>
              <BetaBadge variant="light" size="small" />
            </div>
            <div style={styles.logoSub}>{profile?.role === 'parent' ? 'Family Portal' : 'NesturePlay'}</div>
          </div>
          {/* Close button inside sidebar for mobile */}
          <button className="sidebar-close-btn" onClick={() => setIsOpen(false)} style={styles.closeBtn}>
            <X size={20} />
          </button>
        </div>

        {/* User chip */}
        <div style={styles.userChip} className="sidebar-user">
          <div style={{
            ...styles.avatar,
            background: profile?.avatar_url ? 'transparent' : (profile?.role === 'parent' ? '#E8841A'
              : profile?.role === 'practitioner' ? '#5B8DB8'
              : '#1A8FA0'),
            overflow: 'hidden'
          }}>
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              profile?.first_name?.[0]?.toUpperCase() || '?'
            )}
          </div>
          <div>
            <div style={styles.userName}>{[profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || [user?.user_metadata?.first_name, user?.user_metadata?.last_name].filter(Boolean).join(' ') || user?.email?.split('@')[0] || 'User'}</div>
            <div style={styles.userRole}>
              {{ learner: 'Learner', parent: 'Parent', practitioner: 'Specialist', ot: 'Specialist' }[profile?.role]}
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={styles.nav} className="sidebar-nav">
          {navItems.map((item) => {
            /* ── Tab mode (Parent / OT) ── */
            if (item.id && onNavClick) {
              const isActive = activeId === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onNavClick(item.id);
                    setIsOpen(false);
                  }}
                  style={{
                    ...styles.navItem,
                    ...(isActive ? styles.navItemActive : {}),
                  }}
                  className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
                >
                  <span style={styles.navIcon}>{item.icon}</span>
                  {item.label}
                </button>
              );
            }

            /* ── Route mode (NavLink) ── */
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setIsOpen(false)}
                style={({ isActive }) => ({
                  ...styles.navItem,
                  ...(isActive ? styles.navItemActive : {}),
                })}
                className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
              >
                <span style={styles.navIcon}>{item.icon}</span>
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        {/* Logout */}
        <button onClick={handleLogout} style={styles.logoutBtn} className="sidebar-logout">
          <LogOut size={15} />
          Sign Out
        </button>
      </aside>
    </>
  );
}

const styles = {
  sidebar: {
    width: 250,
    minWidth: 250,
    height: '100dvh',
    background: '#0D3D47', // Deep teal
    display: 'flex',
    flexDirection: 'column',
    padding: '24px 16px',
    borderRight: '1px solid rgba(255,255,255,0.08)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
    transition: 'transform 0.3s ease, width 0.3s ease',
    overflowY: 'auto',
  },
  sidebarOpen: {
    transform: 'translateX(0)',
  },
  glow: {
    position: 'absolute',
    top: -100,
    left: -100,
    width: 300,
    height: 300,
    background: 'radial-gradient(circle, rgba(26,143,160,0.15) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 32,
    padding: '0 8px',
    position: 'relative',
  },
  logoIcon: {
    width: 36,
    height: 36,
    background: 'linear-gradient(135deg, #1A8FA0, #22D3EE)',
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontWeight: 900,
    fontSize: '1.2rem',
    boxShadow: '0 4px 12px rgba(26,143,160,0.3)',
  },
  logoName: {
    color: '#fff',
    fontWeight: 800,
    fontSize: '1.1rem',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  logoSub: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: '0.65rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginTop: 2,
  },
  closeBtn: {
    display: 'none', // Shown only on mobile via CSS
    position: 'absolute',
    right: 0,
    background: 'none',
    border: 'none',
    color: '#fff',
    cursor: 'pointer',
  },
  userChip: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: 'rgba(255,255,255,0.05)',
    padding: '12px',
    borderRadius: 14,
    marginBottom: 24,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontWeight: 800,
    fontSize: '1rem',
  },
  userName: {
    color: '#fff',
    fontWeight: 700,
    fontSize: '0.9rem',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 120,
  },
  userRole: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: '0.7rem',
    fontWeight: 600,
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 14px',
    borderRadius: 12,
    color: 'rgba(255,255,255,0.6)',
    textDecoration: 'none',
    fontSize: '0.9rem',
    fontWeight: 600,
    transition: 'all 0.2s ease',
    border: 'none',
    background: 'transparent',
    width: '100%',
    textAlign: 'left',
    cursor: 'pointer',
  },
  navItemActive: {
    background: 'rgba(255,255,255,0.1)',
    color: '#fff',
  },
  navIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.1rem',
  },
  logoutBtn: {
    marginTop: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 14px',
    color: 'rgba(255,255,255,0.5)',
    background: 'none',
    border: 'none',
    fontSize: '0.9rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'color 0.2s',
  },
  mobileMenuBtn: {
    display: 'none', // Shown only on mobile via CSS
    position: 'fixed',
    top: 15,
    left: 15,
    zIndex: 2000,
    background: 'rgba(13, 61, 71, 0.9)',
    backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '12px',
    color: '#fff',
    padding: '8px 14px',
    alignItems: 'center',
    gap: 8,
    fontWeight: 700,
    fontSize: '0.9rem',
    boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
    cursor: 'pointer',
  },
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    background: 'rgba(0,0,0,0.5)',
    backdropFilter: 'blur(4px)',
    zIndex: 99,
  }
};

