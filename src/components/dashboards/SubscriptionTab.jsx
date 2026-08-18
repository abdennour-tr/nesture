import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../store';
import { supabase } from '../../services/supabaseClient';
import toast from 'react-hot-toast';
import {
  Shield, Star, Check, Users, Crown,
  Calendar, Lock, RefreshCcw, Heart, ShieldCheck, Loader2,
  Zap, BookOpen, BarChart3, LayoutDashboard, Brain, UserPlus, Settings
} from 'lucide-react';
import '../../styles/PricingPage.css';

const PLANS = {
  weekly: [
    {
      id: '7day_pass',
      name: '7-Day Pass',
      target: 'One child',
      price: 9.99,
      period: '/week',
      description: 'Full access for 7 days. Cancel anytime.',
      iconColor: 'blue',
      icon: <Calendar size={28} />,
      ctaClass: 'outline',
      ctaText: 'Start 7-Day Pass',
      trialText: '7-day full access',
      trialSubtext: 'Cancel anytime',
      childProfiles: '1 Child',
      features: [
        'All activities & tools',
        'AI recommendations',
        'Progress tracking',
        'Reports & insights',
        'Parent dashboard',
        'One child profile',
      ],
      highlighted: false,
      popular: false,
    },
  ],
  monthly: [
    {
      id: '7day_pass',
      name: '7-Day Pass',
      target: 'One child',
      price: 9.99,
      period: '/week',
      description: 'Full access for 7 days. Cancel anytime.',
      iconColor: 'blue',
      icon: <Calendar size={28} />,
      ctaClass: 'outline',
      ctaText: 'Start 7-Day Pass',
      trialText: '7-day full access',
      trialSubtext: 'Cancel anytime',
      childProfiles: '1 Child',
      features: [
        'All activities & tools',
        'AI recommendations',
        'Progress tracking',
        'Reports & insights',
        'Parent dashboard',
        'One child profile',
      ],
      highlighted: false,
      popular: false,
    },
    {
      id: 'premium',
      name: 'Premium',
      target: 'One child',
      price: 29.99,
      period: '/month',
      description: 'Everything you need to support your child.',
      iconColor: 'teal',
      icon: <Star size={28} />,
      ctaClass: 'filled-teal',
      ctaText: 'Start Free Trial',
      trialText: '14-day free trial',
      trialSubtext: 'Then $29.99 / month',
      childProfiles: '1 Child',
      features: [
        'All activities & tools',
        'AI recommendations',
        'Progress tracking',
        'Reports & insights',
        'Parent dashboard',
        'Personalized weekly plans',
        'One child profile',
      ],
      highlighted: true,
      popular: true,
    },
    {
      id: 'family',
      name: 'Family',
      target: 'All children',
      price: 49.99,
      period: '/month',
      description: 'One plan for the whole family.',
      iconColor: 'rose',
      icon: <Users size={28} />,
      ctaClass: 'filled-rose',
      ctaText: 'Start Free Trial',
      trialText: '14-day free trial',
      trialSubtext: 'Then $49.99 / month',
      childProfiles: 'Unlimited',
      features: [
        'All activities & tools',
        'AI recommendations',
        'Progress tracking',
        'Reports & insights',
        'Parent dashboard',
        'Personalized weekly plans',
        'Unlimited child profiles',
      ],
      highlighted: false,
      popular: false,
    },
    {
      id: 'annual_family',
      name: 'Annual Family',
      target: 'All children',
      price: 499,
      period: '/year',
      description: 'Best value for families. Save up to 20%.',
      iconColor: 'purple',
      icon: <Crown size={28} />,
      ctaClass: 'filled-purple',
      ctaText: 'Start Free Trial',
      trialText: '14-day free trial',
      trialSubtext: 'Then $499 / year',
      childProfiles: 'Unlimited',
      features: [
        'All activities & tools',
        'AI recommendations',
        'Progress tracking',
        'Reports & insights',
        'Parent dashboard',
        'Personalized weekly plans',
        'Unlimited child profiles',
      ],
      highlighted: false,
      popular: false,
    },
  ],
  yearly: [
    {
      id: 'premium',
      name: 'Premium',
      target: 'One child',
      price: 287.88,
      originalPrice: 359.88,
      period: '/year',
      description: 'Everything you need to support your child. Save 20%!',
      iconColor: 'teal',
      icon: <Star size={28} />,
      ctaClass: 'filled-teal',
      ctaText: 'Start Free Trial',
      trialText: '14-day free trial',
      trialSubtext: 'Then $287.88 / year',
      childProfiles: '1 Child',
      features: [
        'All activities & tools',
        'AI recommendations',
        'Progress tracking',
        'Reports & insights',
        'Parent dashboard',
        'Personalized weekly plans',
        'One child profile',
      ],
      highlighted: true,
      popular: true,
    },
    {
      id: 'annual_family',
      name: 'Annual Family',
      target: 'All children',
      price: 499,
      originalPrice: 599.88,
      period: '/year',
      description: 'Best value for families. Save up to 20%.',
      iconColor: 'purple',
      icon: <Crown size={28} />,
      ctaClass: 'filled-purple',
      ctaText: 'Start Free Trial',
      trialText: '14-day free trial',
      trialSubtext: 'Then $499 / year',
      childProfiles: 'Unlimited',
      features: [
        'All activities & tools',
        'AI recommendations',
        'Progress tracking',
        'Reports & insights',
        'Parent dashboard',
        'Personalized weekly plans',
        'Unlimited child profiles',
      ],
      highlighted: false,
      popular: false,
    },
  ],
};

const COMPARISON_FEATURES = [
  { name: 'All Activities & Tools', icon: <Zap size={16} />, '7day_pass': true, premium: true, family: true, annual_family: true },
  { name: 'AI Recommendations', icon: <Brain size={16} />, '7day_pass': true, premium: true, family: true, annual_family: true },
  { name: 'Progress & tracking', icon: <BarChart3 size={16} />, '7day_pass': false, premium: true, family: true, annual_family: true },
  { name: 'Parent Dashboard', icon: <LayoutDashboard size={16} />, '7day_pass': false, premium: true, family: true, annual_family: true },
  { name: 'Personalized Weekly Plans', icon: <BookOpen size={16} />, '7day_pass': false, premium: true, family: true, annual_family: true },
  { name: 'Child Profiles', icon: <UserPlus size={16} />, '7day_pass': '1 Child', premium: '1 Child', family: 'Unlimited', annual_family: 'Unlimited' },
  { name: 'Cancel Anytime', icon: <RefreshCcw size={16} />, '7day_pass': true, premium: true, family: true, annual_family: true },
];

export default function SubscriptionTab({ parentId }) {
  const { user, profile } = useAuthStore();
  const [billingPeriod, setBillingPeriod] = useState('monthly');
  const [subscribingPlan, setSubscribingPlan] = useState(null);
  const [currentSub, setCurrentSub] = useState(null);
  const [loadingPortal, setLoadingPortal] = useState(false);

  const currentPlans = PLANS[billingPeriod];

  useEffect(() => {
    if (parentId) {
      fetchSubscription();
    }
  }, [parentId]);

  const fetchSubscription = async () => {
    try {
      const { data } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('parent_id', parentId)
        .in('status', ['active', 'trialing'])
        .order('created_at', { ascending: false })
        .limit(1);
      if (data && data.length > 0) {
        setCurrentSub(data[0]);
      }
    } catch (e) {
      console.error('Error fetching subscription:', e);
    }
  };

  const handleOpenPortal = async () => {
    setLoadingPortal(true);
    try {
      toast.loading('Opening Stripe portal...', { id: 'portal-session' });
      const { data, error } = await supabase.functions.invoke('create-portal-session', {
        body: { parentId },
      });

      if (data?.url) {
        toast.dismiss('portal-session');
        window.location.href = data.url;
        return;
      }

      toast.dismiss('portal-session');
      toast.error(data?.error || error?.message || 'Unable to open portal');
    } catch (err) {
      toast.dismiss('portal-session');
      toast.error('Failed to open billing portal');
    } finally {
      setLoadingPortal(false);
    }
  };

  const handleSubscribe = async (plan) => {
    if (!parentId) {
      toast.error('Missing parent identifier.');
      return;
    }

    setSubscribingPlan(plan.id);
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout-session', {
        body: {
          parentId,
          tier: plan.id,
          billingPeriod,
        },
      });

      if (data?.url) {
        toast.success('Redirecting to Stripe...');
        window.location.href = data.url;
        return;
      }

      toast.error(data?.error || error?.message || 'Unable to create checkout session');
    } catch (err) {
      toast.error(err.message || 'Checkout error');
    } finally {
      setSubscribingPlan(null);
    }
  };

  return (
    <div style={{ padding: '4px 0 40px' }}>
      {/* Current Subscription Status Card if active */}
      {currentSub && (
        <div style={{
          background: currentSub.status === 'trialing' ? 'linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)' : 'linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%)',
          border: currentSub.status === 'trialing' ? '1.5px solid #F59E0B' : '1.5px solid #86EFAC',
          borderRadius: 20,
          padding: '24px 28px',
          marginBottom: 32,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 20,
          boxShadow: '0 4px 16px rgba(0,0,0,0.06)'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{
                background: currentSub.status === 'trialing' ? '#D97706' : '#10B981',
                color: '#fff',
                fontWeight: 700,
                fontSize: '0.75rem',
                padding: '4px 12px',
                borderRadius: 20,
                textTransform: 'uppercase'
              }}>
                {currentSub.status === 'trialing' ? 'Essai Gratuit Actif' : 'Abonnement Actif'}
              </span>
              <span style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0F172A' }}>
                Plan {currentSub.tier?.toUpperCase()}
              </span>
            </div>
            <p style={{ fontSize: '0.85rem', color: '#475569', margin: 0 }}>
              {currentSub.status === 'trialing'
                ? `Période d'essai en cours jusqu'au ${currentSub.trial_end ? new Date(currentSub.trial_end).toLocaleDateString() : 'bientôt'}. Vous pouvez annuler à tout moment.`
                : `Votre abonnement est actif et se renouvelle automatiquement. Gérer ou résilier en 1 clic ci-dessous.`}
            </p>
          </div>

          <button
            onClick={handleOpenPortal}
            disabled={loadingPortal}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 22px',
              borderRadius: 12,
              background: '#0D5E6B',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '0.9rem',
              border: 'none',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(13,94,107,0.3)',
              transition: 'all 0.2s'
            }}
          >
            {loadingPortal ? <Loader2 size={16} className="animate-spin" /> : <Settings size={16} />}
            Gérer / Résilier mon abonnement
          </button>
        </div>
      )}

      {/* Header & Toggle Section */}
      <div style={{
        background: 'linear-gradient(135deg, #0D5E6B 0%, #0a3d47 100%)',
        borderRadius: 24,
        padding: '36px 28px',
        textAlign: 'center',
        color: '#fff',
        marginBottom: 32,
        boxShadow: '0 10px 30px rgba(13,94,107,0.2)'
      }}>
        <h2 style={{ fontSize: '1.9rem', fontWeight: 800, margin: '0 0 8px 0', color: '#fff' }}>
          Choisissez le forfait adapté à votre famille
        </h2>
        <p style={{ fontSize: '0.95rem', color: '#94a3b8', margin: '0 0 24px 0' }}>
          Des forfaits flexibles pour chaque foyer. Résiliable à tout moment en 1 clic.
        </p>

        {/* Toggle */}
        <div className="billing-toggle" style={{ margin: '0 auto' }}>
          <button
            className={billingPeriod === 'weekly' ? 'active' : ''}
            onClick={() => setBillingPeriod('weekly')}
          >
            Weekly
            <span className="toggle-subtitle">Pay weekly</span>
          </button>
          <button
            className={billingPeriod === 'monthly' ? 'active' : ''}
            onClick={() => setBillingPeriod('monthly')}
          >
            Monthly
            <span className="toggle-subtitle">Pay monthly</span>
          </button>
          <button
            className={billingPeriod === 'yearly' ? 'active' : ''}
            onClick={() => setBillingPeriod('yearly')}
          >
            Yearly
            <span className="save-badge">Save up to 20%</span>
            <span className="toggle-subtitle">Pay yearly</span>
          </button>
        </div>
      </div>

      {/* Plans Cards Grid */}
      <div
        className="pricing-plans-grid"
        style={{
          gridTemplateColumns: currentPlans.length === 1 ? '1fr' : currentPlans.length === 2 ? 'repeat(2, 1fr)' : `repeat(${currentPlans.length}, 1fr)`,
          maxWidth: currentPlans.length <= 2 ? '700px' : '100%',
          margin: '0 auto 40px',
        }}
      >
        {currentPlans.map((plan) => {
          const isCurrentPlan = currentSub?.tier === plan.id;
          return (
            <div
              key={plan.id}
              className={`plan-card ${plan.highlighted ? 'highlighted' : ''}`}
              style={{
                border: isCurrentPlan ? '2.5px solid #10B981' : undefined,
                boxShadow: isCurrentPlan ? '0 0 0 4px rgba(16,185,129,0.15)' : undefined
              }}
            >
              {isCurrentPlan ? (
                <div className="popular-badge" style={{ background: '#10B981' }}>
                  <ShieldCheck size={12} />
                  Plan Actuel
                </div>
              ) : plan.popular && (
                <div className="popular-badge">
                  <Star size={12} fill="currentColor" />
                  Most Popular
                </div>
              )}

              <div className={`plan-icon ${plan.iconColor}`}>{plan.icon}</div>
              <div className="plan-name">{plan.name}</div>
              <div className="plan-target">{plan.target}</div>

              <div className="plan-price-block">
                <div className="plan-price">
                  <span className="currency">$</span>
                  {plan.price % 1 === 0 ? plan.price : plan.price.toFixed(2)}
                  <span className="period"> {plan.period}</span>
                </div>
                <div className="plan-price-desc">{plan.description}</div>
              </div>

              <ul className="plan-features">
                {plan.features.map((feature, i) => (
                  <li key={i}>
                    <span className={`feature-icon ${plan.iconColor}`}>
                      <Check size={12} strokeWidth={3} />
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>

              <hr className="plan-divider" />

              <div className="trial-info">
                <div className="trial-text">{plan.trialText}</div>
                <span className="trial-subtext">{plan.trialSubtext}</span>
              </div>

              {isCurrentPlan ? (
                <button
                  className="plan-cta outline"
                  onClick={handleOpenPortal}
                  style={{ borderColor: '#10B981', color: '#10B981' }}
                >
                  <Settings size={16} />
                  Gérer ce plan
                </button>
              ) : (
                <button
                  className={`plan-cta ${plan.ctaClass}`}
                  onClick={() => handleSubscribe(plan)}
                  disabled={subscribingPlan === plan.id}
                >
                  {subscribingPlan === plan.id ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Connexion...
                    </>
                  ) : (
                    plan.ctaText
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Comparison Table */}
      <div className="comparison-table-wrapper" style={{ marginTop: 24 }}>
        <table className="comparison-table">
          <thead>
            <tr>
              <th>Plan Comparison</th>
              <th>7-Day Pass<span className="table-plan-price">$9.99 / wk</span></th>
              <th>Premium<span className="table-plan-price">$29.99 / mo</span></th>
              <th>Family<span className="table-plan-price">$49.99 / mo</span></th>
              <th>Annual Family<span className="table-plan-price">$499 / yr</span></th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON_FEATURES.map((feature, i) => (
              <tr key={i}>
                <td>{feature.icon}{feature.name}</td>
                <td>{typeof feature['7day_pass'] === 'boolean' ? (feature['7day_pass'] ? '✓' : '—') : feature['7day_pass']}</td>
                <td>{typeof feature.premium === 'boolean' ? (feature.premium ? '✓' : '—') : feature.premium}</td>
                <td>{typeof feature.family === 'boolean' ? (feature.family ? '✓' : '—') : feature.family}</td>
                <td>{typeof feature.annual_family === 'boolean' ? (feature.annual_family ? '✓' : '—') : feature.annual_family}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
