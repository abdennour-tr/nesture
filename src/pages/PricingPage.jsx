import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import { supabase } from '../services/supabaseClient';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Shield, Star, Check, Users, User, Crown,
  Calendar, Lock, RefreshCcw, Heart, ShieldCheck, Loader2,
  Zap, BookOpen, BarChart3, LayoutDashboard, Brain, UserPlus
} from 'lucide-react';
import '../styles/PricingPage.css';

// ── Plan Definitions ──────────────────────────────────────────────────────────
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

// ── Comparison Features ───────────────────────────────────────────────────────
const COMPARISON_FEATURES = [
  { name: 'All Activities & Tools', icon: <Zap size={16} />, '7day_pass': true, premium: true, family: true, annual_family: true },
  { name: 'AI Recommendations', icon: <Brain size={16} />, '7day_pass': true, premium: true, family: true, annual_family: true },
  { name: 'Progress & tracking', icon: <BarChart3 size={16} />, '7day_pass': false, premium: true, family: true, annual_family: true },
  { name: 'Parent Dashboard', icon: <LayoutDashboard size={16} />, '7day_pass': false, premium: true, family: true, annual_family: true },
  { name: 'Personalized Weekly Plans', icon: <BookOpen size={16} />, '7day_pass': false, premium: true, family: true, annual_family: true },
  { name: 'Child Profiles', icon: <UserPlus size={16} />, '7day_pass': '1 Child', premium: '1 Child', family: 'Unlimited', annual_family: 'Unlimited' },
  { name: 'Cancel Anytime', icon: <RefreshCcw size={16} />, '7day_pass': true, premium: true, family: true, annual_family: true },
];

export default function PricingPage() {
  const navigate = useNavigate();
  const { user, profile } = useAuthStore();
  const [billingPeriod, setBillingPeriod] = useState('monthly');
  const [subscribingPlan, setSubscribingPlan] = useState(null);

  const currentPlans = PLANS[billingPeriod];

  const handleSubscribe = async (plan) => {
    if (!user || !profile) {
      toast.error('Please log in first to subscribe.');
      navigate('/login');
      return;
    }

    const parentId = profile.id;
    if (!parentId) {
      toast.error('Unable to identify your account.');
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
        toast.success('Redirecting to secure checkout...');
        window.location.href = data.url;
        return;
      }

      if (data?.error || data?.message) {
        const errMsg = data.message || data.error;
        console.error('Edge Function returned error:', data);
        toast.error(`Checkout error: ${errMsg}`, { duration: 6000 });
        return;
      }

      if (error) {
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

      toast.error('Could not create checkout session. Please try again.');
    } catch (err) {
      console.error('Subscription error:', err);
      toast.error(err.message || 'Unable to start checkout');
    } finally {
      setSubscribingPlan(null);
    }
  };

  return (
    <div className="pricing-page">
      {/* ── Back Button ────────────────────────────────────────────────── */}
      <button
        className="pricing-back-btn"
        onClick={() => navigate(-1)}
        aria-label="Go back"
      >
        <ArrowLeft size={18} />
        Back
      </button>

      {/* ── Hero Section ───────────────────────────────────────────────── */}
      <section className="pricing-hero">
        <div className="pricing-hero-content">
          <div className="secure-badge">
            <Shield size={16} />
            Secure & Encrypted — Your payment information is safe with us.
          </div>

          <h1>
            Choose the Right Plan <span>for Your Family</span>
          </h1>
          <p>Flexible plans for every family. Cancel anytime.</p>

          {/* ── Billing Toggle ───────────────────────────────────────── */}
          <div className="billing-toggle-wrapper">
            <div className="billing-toggle" role="tablist" aria-label="Billing period selector">
              <button
                role="tab"
                aria-selected={billingPeriod === 'weekly'}
                className={billingPeriod === 'weekly' ? 'active' : ''}
                onClick={() => setBillingPeriod('weekly')}
              >
                Weekly
                <span className="toggle-subtitle">Pay weekly</span>
              </button>
              <button
                role="tab"
                aria-selected={billingPeriod === 'monthly'}
                className={billingPeriod === 'monthly' ? 'active' : ''}
                onClick={() => setBillingPeriod('monthly')}
              >
                Monthly
                <span className="toggle-subtitle">Pay monthly</span>
              </button>
              <button
                role="tab"
                aria-selected={billingPeriod === 'yearly'}
                className={billingPeriod === 'yearly' ? 'active' : ''}
                onClick={() => setBillingPeriod('yearly')}
              >
                Yearly
                <span className="save-badge">Save up to 20%</span>
                <span className="toggle-subtitle">Pay yearly</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Plan Cards ─────────────────────────────────────────────────── */}
      <section className="pricing-plans-section">
        <div
          className="pricing-plans-grid"
          style={{
            gridTemplateColumns:
              currentPlans.length === 1
                ? '1fr'
                : currentPlans.length === 2
                ? 'repeat(2, 1fr)'
                : `repeat(${currentPlans.length}, 1fr)`,
            maxWidth: currentPlans.length <= 2 ? '700px' : '1200px',
            margin: currentPlans.length <= 2 ? '-50px auto 0' : '-50px auto 0',
          }}
        >
          {currentPlans.map((plan) => (
            <div
              key={plan.id}
              className={`plan-card ${plan.highlighted ? 'highlighted' : ''}`}
            >
              {plan.popular && (
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

              <button
                className={`plan-cta ${plan.ctaClass}`}
                onClick={() => handleSubscribe(plan)}
                disabled={subscribingPlan === plan.id}
              >
                {subscribingPlan === plan.id ? (
                  <>
                    <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                    Connecting...
                  </>
                ) : (
                  plan.ctaText
                )}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ── Promo Banner ───────────────────────────────────────────────── */}
      <div className="promo-banner">
        <p>
          <span>🎓</span>
          Have a promo code or scholarship? You'll be able to apply it at checkout.
        </p>
      </div>

      {/* ── Plan Comparison Table ──────────────────────────────────────── */}
      <section className="comparison-section">
        <div className="comparison-table-wrapper">
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Plan Comparison</th>
                <th>
                  7-Day Pass
                  <span className="table-plan-price">$9.99 / week</span>
                </th>
                <th>
                  Premium
                  <span className="table-plan-price">$29.99 / month</span>
                </th>
                <th>
                  Family
                  <span className="table-plan-price">$49.99 / month</span>
                </th>
                <th>
                  Annual Family
                  <span className="table-plan-price">$499 / year</span>
                  <span className="table-plan-save">Save up to 20%</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_FEATURES.map((feature, i) => (
                <tr key={i}>
                  <td>
                    {feature.icon}
                    {feature.name}
                  </td>
                  <td>
                    {typeof feature['7day_pass'] === 'boolean' ? (
                      feature['7day_pass'] ? (
                        <span className="comparison-check">✓</span>
                      ) : (
                        <span style={{ color: '#cbd5e1' }}>—</span>
                      )
                    ) : (
                      <span className="comparison-text">{feature['7day_pass']}</span>
                    )}
                  </td>
                  <td>
                    {typeof feature.premium === 'boolean' ? (
                      feature.premium ? (
                        <span className="comparison-check">✓</span>
                      ) : (
                        <span style={{ color: '#cbd5e1' }}>—</span>
                      )
                    ) : (
                      <span className="comparison-text">{feature.premium}</span>
                    )}
                  </td>
                  <td>
                    {typeof feature.family === 'boolean' ? (
                      feature.family ? (
                        <span className="comparison-check">✓</span>
                      ) : (
                        <span style={{ color: '#cbd5e1' }}>—</span>
                      )
                    ) : (
                      <span className="comparison-text">{feature.family}</span>
                    )}
                  </td>
                  <td>
                    {typeof feature.annual_family === 'boolean' ? (
                      feature.annual_family ? (
                        <span className="comparison-check">✓</span>
                      ) : (
                        <span style={{ color: '#cbd5e1' }}>—</span>
                      )
                    ) : (
                      <span className="comparison-text">{feature.annual_family}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Trust Badges ───────────────────────────────────────────────── */}
      <section className="trust-section">
        <div className="trust-badges">
          <div className="trust-badge">
            <div className="trust-badge-icon blue">
              <Calendar size={22} />
            </div>
            <div>
              <h4>14-Day Free Trial</h4>
              <p>Try any plan risk-free. Cancel anytime.</p>
            </div>
          </div>
          <div className="trust-badge">
            <div className="trust-badge-icon green">
              <RefreshCcw size={22} />
            </div>
            <div>
              <h4>Cancel Anytime</h4>
              <p>No commitments. Cancel anytime.</p>
            </div>
          </div>
          <div className="trust-badge">
            <div className="trust-badge-icon amber">
              <Lock size={22} />
            </div>
            <div>
              <h4>Secure Payments</h4>
              <p>Your data is encrypted and secure.</p>
            </div>
          </div>
          <div className="trust-badge">
            <div className="trust-badge-icon rose">
              <Heart size={22} />
            </div>
            <div>
              <h4>Loved by Families</h4>
              <p>Trusted by thousands of parents and caregivers.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Security Footer ────────────────────────────────────────────── */}
      <footer className="security-footer">
        <div className="security-footer-inner">
          <div className="security-item">
            <div className="security-icon">
              <Lock size={16} />
            </div>
            <span>Bank-level security<br />256-bit SSL encryption</span>
          </div>

          <div className="payment-methods">
            <span className="payment-chip visa">VISA</span>
            <span className="payment-chip mastercard">Mastercard</span>
            <span className="payment-chip amex">AMEX</span>
            <span className="payment-chip">Apple Pay</span>
            <span className="payment-chip">Google Pay</span>
          </div>

          <div className="privacy-item">
            <div className="privacy-icon">
              <ShieldCheck size={14} />
            </div>
            <span>Privacy First<br />We never share your data.</span>
          </div>
        </div>
      </footer>

      {/* ── Disclaimer ─────────────────────────────────────────────────── */}
      <div className="pricing-disclaimer">
        Subscriptions renew automatically. You can manage or cancel your subscription at any time in your account settings.
      </div>
    </div>
  );
}
