import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('Nesture AI error boundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={styles.root}>
          <div style={styles.card}>
            <div style={styles.icon}>⚠️</div>
            <h2 style={styles.title}>Something went wrong</h2>
            <p style={styles.msg}>
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              style={styles.btn}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const styles = {
  root: {
    minHeight: '100vh', background: '#EEF6F8',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 24,
  },
  card: {
    background: '#fff', borderRadius: 20, padding: '40px 48px',
    textAlign: 'center', maxWidth: 420,
    boxShadow: '0 8px 32px rgba(13,94,107,0.1)',
  },
  icon: { fontSize: '3rem', marginBottom: 16 },
  title: {
    fontFamily: 'Inter, sans-serif',
    fontWeight: 800, fontSize: '1.4rem', color: '#0D5E6B', marginBottom: 12,
  },
  msg: { fontSize: '0.875rem', color: '#6B7280', lineHeight: 1.6, marginBottom: 24 },
  btn: {
    padding: '11px 24px',
    background: '#0D5E6B', color: '#fff',
    border: 'none', borderRadius: 10,
    fontFamily: 'Inter, sans-serif', fontWeight: 600, cursor: 'pointer',
  },
};
