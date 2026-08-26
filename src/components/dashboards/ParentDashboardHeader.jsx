import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, CreditCard, Sparkles, ShieldCheck, Loader2, ExternalLink, Clock, Settings } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../services/supabaseClient';

const TIER_DETAILS = {
  '7day_pass': {
    name: '7-Day Pass',
    badge: '1 Child',
    description: 'Full access for 7 days. Cancel anytime.',
    color: '#2563EB',
  },
  premium: {
    name: 'Premium',
    badge: '1 Child',
    description: 'Everything you need to support your child.',
    color: '#0D9488',
  },
  family: {
    name: 'Family',
    badge: 'Unlimited Children',
    description: 'One plan for the whole family.',
    color: '#DB2777',
  },
  annual_family: {
    name: 'Annual Family',
    badge: 'Unlimited Children',
    description: 'Best value for families. Save up to 20%.',
    color: '#7C3AED',
  },
  // Backward compatibility
  starter: {
    name: 'Premium',
    badge: '1 Child',
    description: 'Everything you need to support your child.',
    color: '#0EA5E9',
  },
  growth: {
    name: 'Family',
    badge: 'Unlimited Children',
    description: 'Designed for growing learning groups and classes.',
    color: '#8B5CF6',
  },
  enterprise: {
    name: 'Annual Family',
    badge: 'Unlimited Children',
    description: 'Tailored plan with unlimited learners and dedicated support.',
    color: '#F59E0B',
  },
};

export default function ParentDashboardHeader({ parentId, children: childrenList = [], currentSubscription = null }) {
  const navigate = useNavigate();
  const [learnerCount, setLearnerCount] = useState(childrenList.length || 0);
  const [subscribing, setSubscribing] = useState(false);

  useEffect(() => {
    if (childrenList && Array.isArray(childrenList)) {
      setLearnerCount(childrenList.length);
    }
  }, [childrenList]);

  const getRecommendedTier = (count) => {
    if (count > 1) return 'family';
    return 'premium';
  };

  const recommendedTier = getRecommendedTier(learnerCount);
  const tierInfo = TIER_DETAILS[recommendedTier] || TIER_DETAILS.premium;

  const handleManageSubscription = async () => {
    if (!parentId) return;
    setSubscribing(true);
    try {
      toast.loading('Opening customer portal...', { id: 'portal-toast' });
      const { data, error } = await supabase.functions.invoke('create-portal-session', {
        body: { parentId },
      });

      if (data?.url) {
        toast.dismiss('portal-toast');
        window.location.href = data.url;
        return;
      }

      if (error || data?.error) {
        toast.dismiss('portal-toast');
        toast.error(data?.error || error?.message || 'Unable to open portal');
      }
    } catch (err) {
      toast.dismiss('portal-toast');
      console.error('Portal error:', err);
      toast.error('Unable to open Stripe customer portal');
    } finally {
      setSubscribing(false);
    }
  };

  const handleSubscribe = async () => {
    if (!parentId) {
      toast.error('Missing Parent ID');
      return;
    }

    setSubscribing(true);
    try {
      console.log(`Invoking create-checkout-session for parentId: ${parentId}, tier: ${recommendedTier}`);

      // Invoke deployed Supabase Edge Function
      const { data, error } = await supabase.functions.invoke('create-checkout-session', {
        body: { parentId, tier: recommendedTier },
      });

      if (data?.url) {
        toast.success('Redirecting to Stripe Checkout...');
        window.location.href = data.url;
        return;
      }

      // If Edge Function returned a specific error message (e.g., missing STRIPE_SECRET_KEY)
      if (data?.error || data?.message) {
        const errMsg = data.message || data.error;
        console.error('Edge Function returned error:', data);
        toast.error(`Stripe Error: ${errMsg}`, { duration: 6000 });
        return;
      }

      if (error) {
        // Try reading body error if FunctionsHttpError
        let customMsg = error.message;
        try {
          if (error.context) {
            const body = await error.context.json();
            if (body?.message || body?.error) {
              customMsg = body.message || body.error;
            }
          }
        } catch (e) {
          // ignore JSON parse error
        }

        console.error('Edge Function invocation error:', error);
        toast.error(`Checkout error: ${customMsg}`, { duration: 6000 });
        return;
      }

      toast.error('Could not create Stripe checkout session. Please check your Stripe keys in Supabase secrets.', { duration: 6000 });
    } catch (err) {
      console.error('Subscription checkout error:', err);
      toast.error(err.message || 'Unable to initialize checkout session');
    } finally {
      setSubscribing(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.headerContent}>
        {/* Left Side: Learner Count (Read Only Display) */}
        <div style={styles.leftCol}>
          <div style={styles.badgeRow}>
            <span style={styles.pillTag}>
              <Users size={14} style={{ marginRight: 6 }} />
              Parent Account Info
            </span>
            {currentSubscription && (
              <span style={{ ...styles.activeSubTag, backgroundColor: currentSubscription.status === 'trialing' ? '#D97706' : '#10B981', color: '#fff', fontWeight: 'bold', padding: '6px 12px', borderRadius: '16px', fontSize: '14px', display: 'flex', alignItems: 'center' }}>
                <ShieldCheck size={16} style={{ marginRight: 6 }} />
                {currentSubscription.status === 'trialing' ? 'Free Trial' : 'Active Plan'} ({currentSubscription.tier?.toUpperCase()})
              </span>
            )}
          </div>

          <h2 style={styles.title}>NestureAI Plan Management</h2>
          <p style={styles.subtitle}>
            Your plan automatically adjusts based on the actual number of active learners linked to your account.
          </p>

          <div style={styles.readOnlyFieldGroup}>
            <label htmlFor="learner-count-readonly" style={styles.label}>
              Active learners linked (read-only):
            </label>
            <div style={styles.inputWrapper}>
              <Users size={18} style={styles.inputIcon} />
              <input
                id="learner-count-readonly"
                type="text"
                readOnly
                value={`${learnerCount} active learner${learnerCount !== 1 ? 's' : ''}`}
                style={styles.readOnlyInput}
              />
            </div>
          </div>
        </div>

        {/* Right Side: Tier Recommendation & Checkout Action */}
        <div style={styles.rightCol}>
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <Sparkles size={18} color={currentSubscription ? (currentSubscription.status === 'trialing' ? "#D97706" : "#10B981") : "#F59E0B"} />
              <span style={styles.recommendLabel}>
                {currentSubscription ? "Current Plan" : "Recommended Plan"}
              </span>
            </div>

            <div style={styles.tierTitleRow}>
              <span style={styles.tierName}>
                {currentSubscription ? (TIER_DETAILS[currentSubscription.tier]?.name || currentSubscription.tier) : tierInfo.name}
              </span>
              <span style={{ 
                ...styles.tierBadge, 
                backgroundColor: currentSubscription 
                  ? (currentSubscription.status === 'trialing' 
                      ? "#D97706" 
                      : (currentSubscription.cancel_at_period_end ? "#EF4444" : "#10B981")) 
                  : tierInfo.color 
              }}>
                {currentSubscription 
                  ? (currentSubscription.status === 'trialing' 
                      ? "Trial" 
                      : (currentSubscription.cancel_at_period_end ? "Ending soon" : "Active")) 
                  : tierInfo.badge}
              </span>
            </div>

            <p style={styles.tierDesc}>
              {currentSubscription 
                ? (currentSubscription.status === 'trialing' 
                    ? `You are on a free trial! Your trial ends on ${currentSubscription.trial_end ? new Date(currentSubscription.trial_end).toLocaleDateString() : 'soon'}.`
                    : (currentSubscription.cancel_at_period_end
                        ? `You have canceled your subscription. It will remain active until ${currentSubscription.current_period_end ? new Date(currentSubscription.current_period_end).toLocaleDateString() : 'the end of the period'}.`
                        : "You have an active subscription. You can manage or cancel it at any time."))
                : tierInfo.description}
            </p>

            {currentSubscription ? (
              <button
                onClick={handleManageSubscription}
                disabled={subscribing}
                style={{
                  ...styles.subscribeBtn,
                  backgroundColor: '#0D5E6B',
                  opacity: subscribing ? 0.75 : 1,
                  cursor: subscribing ? 'not-allowed' : 'pointer',
                }}
              >
                {subscribing ? (
                  <>
                    <Loader2 size={18} className="animate-spin" style={{ marginRight: 8 }} />
                    Redirecting to portal...
                  </>
                ) : (
                  <>
                    <Settings size={18} style={{ marginRight: 8 }} />
                    Manage / Cancel my subscription
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={() => navigate('/pricing')}
                disabled={subscribing}
                style={{
                  ...styles.subscribeBtn,
                  backgroundColor: '#0f172a',
                  opacity: subscribing ? 0.75 : 1,
                  cursor: subscribing ? 'not-allowed' : 'pointer',
                }}
              >
                <CreditCard size={18} style={{ marginRight: 8 }} />
                Choose a plan ({tierInfo.name})
              </button>
            )}

            {/* View All Plans link */}
            <button
              onClick={() => navigate('/pricing')}
              style={styles.viewAllPlansBtn}
            >
              <ExternalLink size={14} style={{ marginRight: 6 }} />
              View all pricing & options
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    background: 'linear-gradient(135deg, #0D5E6B 0%, #164E63 100%)',
    borderRadius: 20,
    padding: '28px 32px',
    marginBottom: 28,
    color: '#FFFFFF',
    boxShadow: '0 12px 30px rgba(13, 94, 107, 0.25)',
  },
  headerContent: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 28,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leftCol: {
    flex: '1 1 420px',
    minWidth: 300,
  },
  rightCol: {
    flex: '0 1 360px',
    minWidth: 280,
  },
  badgeRow: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  pillTag: {
    display: 'inline-flex',
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.15)',
    backdropFilter: 'blur(8px)',
    padding: '4px 12px',
    borderRadius: 20,
    fontSize: '0.8rem',
    fontWeight: 600,
    color: '#E0F2FE',
  },
  activeSubTag: {
    display: 'inline-flex',
    alignItems: 'center',
    background: 'rgba(16, 185, 129, 0.25)',
    border: '1px solid rgba(52, 211, 153, 0.4)',
    padding: '4px 12px',
    borderRadius: 20,
    fontSize: '0.8rem',
    fontWeight: 700,
    color: '#A7F3D0',
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 800,
    margin: '0 0 6px 0',
    letterSpacing: '-0.02em',
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: '0.9rem',
    color: '#CBD5E1',
    margin: '0 0 18px 0',
    lineHeight: 1.45,
  },
  readOnlyFieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    maxWidth: 360,
  },
  label: {
    fontSize: '0.82rem',
    fontWeight: 600,
    color: '#E2E8F0',
  },
  inputWrapper: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  inputIcon: {
    position: 'absolute',
    left: 14,
    color: '#0D5E6B',
  },
  readOnlyInput: {
    width: '100%',
    padding: '10px 14px 10px 42px',
    borderRadius: 12,
    border: '1.5px solid rgba(255, 255, 255, 0.3)',
    background: '#F8FAFC',
    color: '#0F172A',
    fontWeight: 700,
    fontSize: '0.95rem',
    outline: 'none',
    cursor: 'default',
    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.04)',
  },
  card: {
    background: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 16,
    padding: 20,
    boxShadow: '0 10px 25px rgba(0, 0, 0, 0.15)',
    color: '#0F172A',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  recommendLabel: {
    fontSize: '0.78rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#D97706',
  },
  tierTitleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  tierName: {
    fontSize: '1.3rem',
    fontWeight: 800,
    color: '#0F172A',
  },
  tierBadge: {
    fontSize: '0.75rem',
    fontWeight: 700,
    color: '#FFFFFF',
    padding: '3px 10px',
    borderRadius: 12,
  },
  tierDesc: {
    fontSize: '0.82rem',
    color: '#64748B',
    marginBottom: 16,
    lineHeight: 1.4,
  },
  subscribeBtn: {
    width: '100%',
    padding: '12px 18px',
    borderRadius: 12,
    border: 'none',
    background: 'linear-gradient(135deg, #0D5E6B 0%, #1A8FA0 100%)',
    color: '#FFFFFF',
    fontWeight: 700,
    fontSize: '0.92rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
    boxShadow: '0 4px 14px rgba(13, 94, 107, 0.3)',
  },
  viewAllPlansBtn: {
    width: '100%',
    marginTop: 10,
    padding: '8px 14px',
    borderRadius: 10,
    border: '1.5px solid rgba(13, 94, 107, 0.3)',
    background: 'transparent',
    color: '#0D5E6B',
    fontWeight: 600,
    fontSize: '0.8rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
};
