import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Loader2 } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import toast from 'react-hot-toast';

const DOMAIN_NAMES = [
  "Developmental Profile",
  "Social & Communication",
  "Academics & Learning",
  "Behaviour & Regulation",
  "Sensory",
  "Functional Wellness",
  "Motor Reflexes",
  "Brain Development",
  "Daily Living",
  "Genetics",
  "Environment"
];

const DOMAIN_DESCRIPTIONS = [
  "Tell us a bit about [name] — their strengths and how they communicate.",
  "How [name] connects with others and expresses themselves. No right answers.",
  "How [name] approaches new information and learning activities.",
  "How [name] manages emotions, focus, and everyday challenges.",
  "How [name] takes in sounds, textures, light, and movement. There are no right answers — just what you usually see.",
  "A quick look at [name]'s sleep and eating routine.",
  "Everyday movement observations — no medical knowledge needed.",
  "Simple milestone observations about [name]'s early development.",
  "How [name] manages everyday activities and routines.",
  "Optional background context — completely confidential.",
  "Where [name] spends their time and what helps them thrive."
];

const LIKERT_OPTIONS = ["Rarely", "Sometimes", "Often", "Almost always"];

const D1_STRENGTH_OPTIONS = [
  "Curious", "Good memory", "Strong with numbers or patterns", 
  "Visual learner", "Auditory learner", "Musical", 
  "Affectionate", "Caring", "Determined", 
  "Good humour", "Enjoys community activities", "Strong family support"
];

const D11_CALM_OPTIONS = [
  "Routine", "Quiet", "Visual supports", 
  "Movement breaks", "Clear instructions", "Encouragement"
];

const packResponses = (cleanResponses, childId, status, lastCompletedStep) => {
  const payload = {
    child_id: childId,
    status: status,
    last_completed_step: lastCompletedStep || 0,
    d1_communication_mode: cleanResponses.d1_communication_mode,
    d1_strengths_checklist: cleanResponses.d1_strengths_checklist,
    d1_who_is: cleanResponses.d1_who_is,
    d1_enjoys: cleanResponses.d1_enjoys,
    d1_what_helps: cleanResponses.d1_what_helps,
    d10_family_differences: cleanResponses.d10_family_differences,
    d10_genetic_notes: cleanResponses.d10_genetic_notes,
    d11_location: cleanResponses.d11_location,
    d11_calm_space: cleanResponses.d11_calm_space,
    d11_what_helps: cleanResponses.d11_what_helps
  };

  for (let i = 2; i <= 9; i++) {
    const domainResponses = {};
    Object.entries(cleanResponses).forEach(([key, val]) => {
      if (key.startsWith(`d${i}_`)) {
        const fieldName = key.substring(3);
        domainResponses[fieldName] = val;
      }
    });
    payload[`d${i}_responses`] = domainResponses;
  }

  return payload;
};

export default function Atlas360Questionnaire({ isOpen, onClose, childId, childName = "Child", onComplete, initialStep }) {
  const [currentStep, setCurrentStep] = useState(initialStep || 1);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Core state matching DB columns
  const [responses, setResponses] = useState({
    d1_communication_mode: '',
    d1_strengths_checklist: [],
    d1_who_is: '',
    d1_enjoys: '',
    d1_what_helps: '',

    d2_understands: 'Not sure',
    d2_communicates: 'Not sure',
    d2_initiates: 'Not sure',
    d2_reliable_way: 'Not sure',
    d2_follows_instructions: 'Not sure',
    d2_enjoys_familiar: 'Not sure',
    d2_joins_group: 'Not sure',
    d2_shares_interest: 'Not sure',
    d2_shares_attention: 'Not sure',
    d2_gets_along: 'Not sure',

    d3_curious: 'Not sure',
    d3_steady_pace: 'Not sure',
    d3_remembers: 'Not sure',
    d3_engages: 'Not sure',
    d3_frustrated: 'Not sure',

    d4_calms_down: 'Not sure',
    d4_copes_routine: 'Not sure',
    d4_emotional_swings: 'Not sure',
    d4_frustrated_easily: 'Not sure',
    d4_anxious: 'Not sure',
    d4_stays_focused: 'Not sure',
    d4_follows_multistep: 'Not sure',
    d4_acts_before_thinking: 'Not sure',
    d4_distracted: 'Not sure',

    d5_copes_sights: 'Not sure',
    d5_overwhelmed_busy: 'Not sure',
    d5_clothing_tags: 'Not sure',
    d5_sensitive_lights: 'Not sure',
    d5_reactions_textures: 'Not sure',

    d6_falls_asleep: 'Not sure',
    d6_sleeps_night: 'Not sure',
    d6_sleep_routine: 'Not sure',
    d6_wakes_often: 'Not sure',
    d6_eats_range: 'Not sure',

    d7_sit_still: 'Not sure',
    d7_pencil_grip: 'Not sure',
    d7_easily_startled: 'Not sure',
    d7_late_crawl: 'Not sure',
    d7_poor_balance: 'Not sure',

    d8_movement_milestones: 'Not sure',
    d8_speech_milestones: 'Not sure',
    d8_developmental_stages: 'Not sure',
    d8_lost_skills: 'Not sure',

    d9_personal_care: 'Not sure',
    d9_everyday_tasks: 'Not sure',
    d9_daily_routines: 'Not sure',
    d9_changes_situations: 'Not sure',
    d9_needs_support: 'Not sure',

    d10_family_differences: '',
    d10_genetic_notes: '',

    d11_location: '',
    d11_calm_space: '',
    d11_what_helps: []
  });

  const firstName = (childName || 'Child').split(' ')[0];
  const formatText = (text) => {
    if (!text) return '';
    // Replace any occurrence of [name] or childName (full name) or lowercase name with firstName
    let formatted = text.replaceAll('[name]', firstName);
    if (childName && childName !== firstName) {
      formatted = formatted.replaceAll(childName, firstName);
    }
    return formatted;
  };

  // Load existing answers on mount/open
  useEffect(() => {
    if (isOpen && childId) {
      const loadData = async () => {
        setLoadingInitial(true);
        try {
          const { data, error } = await supabase
            .from('atlas_questionnaire_responses')
            .select('*')
            .eq('child_id', childId)
            .maybeSingle();

          if (error) throw error;
          if (data) {
            // Merge defaults and DB row
            setResponses(prev => {
              const unpacked = { ...prev, ...data };
              for (let i = 2; i <= 9; i++) {
                const domainResponses = data[`d${i}_responses`] || {};
                Object.entries(domainResponses).forEach(([key, val]) => {
                  unpacked[`d${i}_${key}`] = val;
                });
              }
              unpacked.d1_strengths_checklist = data.d1_strengths_checklist || [];
              unpacked.d11_what_helps = data.d11_what_helps || [];
              return unpacked;
            });

            // Resume at the saved step (initialStep prop takes priority)
            if (initialStep) {
              setCurrentStep(initialStep);
            } else if (data.last_completed_step && data.status === 'in_progress') {
              // Jump to the step AFTER the last completed one
              setCurrentStep(Math.min(data.last_completed_step + 1, 11));
            }
          }
        } catch (err) {
          console.error("Failed to load questionnaire responses:", err);
        } finally {
          setLoadingInitial(false);
        }
      };
      loadData();
    } else if (!isOpen) {
      // Reset step when modal closes (so re-opening starts fresh or from saved)
      setCurrentStep(initialStep || 1);
    }
  }, [isOpen, childId]);

  if (!isOpen) return null;

  const handleCheckboxChange = (field, item) => {
    setResponses(prev => {
      const currentList = prev[field] || [];
      const updatedList = currentList.includes(item)
        ? currentList.filter(i => i !== item)
        : [...currentList, item];
      return { ...prev, [field]: updatedList };
    });
  };

  const handleValueChange = (field, val) => {
    setResponses(prev => ({ ...prev, [field]: val }));
  };

  const handleNext = async () => {
    if (currentStep === 1) {
      if (!responses.d1_communication_mode) {
        toast.error("Please select a Communication Mode to proceed.");
        return;
      }
    }

    // Save progressively to DB with last_completed_step
    try {
      const { created_at, updated_at, ...cleanResponses } = responses;
      const payload = packResponses(cleanResponses, childId, 'in_progress', currentStep);
      console.log('[upsert progressive] payload:', payload);
      const { error } = await supabase
        .from('atlas_questionnaire_responses')
        .upsert(payload, { onConflict: 'child_id' });
      if (error) throw error;
    } catch (err) {
      console.warn("Intake progressive save failed:", err);
    }

    setCurrentStep(prev => prev + 1);
  };

  const handleBack = () => {
    setCurrentStep(prev => prev - 1);
  };

  const handleSaveAndContinueLater = async () => {
    try {
      const { created_at, updated_at, ...cleanResponses } = responses;
      const payload = packResponses(cleanResponses, childId, 'in_progress', currentStep - 1);
      console.log('[save and continue later] payload:', payload);
      toast.loading("Saving progress...", { id: 'save-progress' });
      const { error } = await supabase
        .from('atlas_questionnaire_responses')
        .upsert(payload, { onConflict: 'child_id' });
      if (error) throw error;
      toast.success("Progress saved! You can continue anytime.", { id: 'save-progress' });
      onClose();
    } catch (err) {
      console.error("Progress save failed:", err);
      toast.error("Failed to save progress", { id: 'save-progress' });
    }
  };

  // Perform Likert scale mapping & generate structured strength/challenge lists
  const calculateAndSaveScores = async () => {
    setSubmitting(true);
    try {
      // 1. Save completed responses row
      const { created_at, updated_at, ...cleanResponses } = responses;
      const payload = packResponses(cleanResponses, childId, 'completed', 11);
      console.log('[upsert final] payload:', payload);
      const { error: dbErr } = await supabase
        .from('atlas_questionnaire_responses')
        .upsert(payload, { onConflict: 'child_id' });

      if (dbErr) throw dbErr;

      // 2. Invoke profile calculation Edge Function
      const { data: funcData, error: funcErr } = await supabase.functions.invoke('calculate-atlas-profile', {
        body: { childId }
      });

      if (funcErr || (funcData && funcData.error)) {
        throw new Error(funcData?.error || funcErr?.message || 'Failed to calculate profile scores');
      }

      toast.success("Atlas 360° Profile generated successfully!");
      if (onComplete) onComplete();
      onClose();
    } catch (err) {
      console.error("Failed to compile final questionnaire responses:", err);
      toast.error("Submitting answers failed: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const renderScoredDomain = (domainKey, questions, valueFields, strengthKeys) => {
    return (
      <div style={styles.formSection}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 10 }}>
          {questions.map((q, idx) => {
            const field = valueFields[idx];
            const currentValue = responses[field] || 'Not sure';
            return (
              <div key={field} style={styles.questionCard}>
                <label style={styles.questionStatement}>{formatText(q)}</label>
                <div style={styles.horizontalOptionsRow}>
                  {LIKERT_OPTIONS.map(opt => {
                    const isSelected = currentValue === opt;
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => handleValueChange(field, opt)}
                        style={{
                          ...styles.optionTapBtn,
                          backgroundColor: isSelected ? '#2D7D6F' : '#ffffff',
                          color: isSelected ? '#ffffff' : '#475569',
                          borderColor: isSelected ? '#2D7D6F' : '#D1D5DB',
                          fontWeight: isSelected ? '700' : '500',
                        }}
                      >
                        {isSelected && <span style={{ marginRight: 6 }}>✓</span>}
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div style={styles.overlay}>
      <motion.div
        style={styles.modal}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
      >
        <div style={styles.headerRow}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={styles.iconWrap}><Brain size={24} color="#2D7D6F" /></div>
            <span style={{ fontWeight: 700, color: '#1E293B', fontSize: '1rem', fontFamily: 'Inter, sans-serif' }}>Atlas 360° Questionnaire</span>
          </div>
          <button onClick={onClose} style={styles.closeBtn} disabled={submitting}>✕</button>
        </div>

        {/* Segmented Progress Bar */}
        <div style={styles.progressContainer}>
          <div style={styles.segmentsRow}>
            {Array.from({ length: 11 }).map((_, idx) => {
              const stepNum = idx + 1;
              const isCompleted = stepNum < currentStep;
              const isActive = stepNum === currentStep;
              return (
                <div 
                  key={stepNum} 
                  style={{
                    ...styles.progressSegment,
                    backgroundColor: isCompleted || isActive ? '#2D7D6F' : '#E2E8F0',
                    opacity: isActive ? 1 : isCompleted ? 0.85 : 0.4
                  }} 
                />
              );
            })}
          </div>
          <span style={styles.stepIndicatorRight}>Step {currentStep} of 11</span>
        </div>

        <div style={styles.contentScroll}>
          {loadingInitial ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 60 }}>
              <Loader2 size={32} className="animate-spin" color="#2D7D6F" />
            </div>
          ) : (
            <div style={styles.scrollInnerCard}>
              <div style={styles.stepHeaderCard}>
                <h1 style={styles.stepTitleHeading}>{DOMAIN_NAMES[currentStep - 1]}</h1>
                <p style={styles.stepDescription}>{formatText(DOMAIN_DESCRIPTIONS[currentStep - 1])}</p>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={currentStep}
                  initial={{ opacity: 0, x: 15 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -15 }}
                  transition={{ duration: 0.2 }}
                >
                {/* ── STEP 1: DEVELOPMENTAL PROFILE ── */}
                {currentStep === 1 && (
                  <div style={styles.formSection}>
                    <div style={styles.inputGroup}>
                      <label style={styles.label}>Communication Mode *</label>
                      <select 
                        value={responses.d1_communication_mode} 
                        onChange={e => handleValueChange('d1_communication_mode', e.target.value)} 
                        style={styles.select}
                      >
                        <option value="">Select communication mode...</option>
                        <option value="Speaking">Speaking</option>
                        <option value="Typing">Typing</option>
                        <option value="Picture or symbol board">Picture or symbol board</option>
                        <option value="Signs">Signs</option>
                        <option value="Gestures">Gestures</option>
                        <option value="A mix">A mix</option>
                      </select>
                    </div>

                    <div style={styles.inputGroup}>
                      <label style={styles.label}>{firstName}'s Strengths (Select all that apply)</label>
                      <div style={styles.checkboxGrid}>
                        {D1_STRENGTH_OPTIONS.map(opt => {
                          const isChecked = (responses.d1_strengths_checklist || []).includes(opt);
                          return (
                            <label key={opt} style={styles.checkboxLabel}>
                              <input 
                                type="checkbox" 
                                checked={isChecked} 
                                onChange={() => handleCheckboxChange('d1_strengths_checklist', opt)} 
                                style={styles.checkboxInput}
                              />
                              {opt}
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <div style={styles.inputGroup}>
                      <label style={styles.label}>Who {firstName} is</label>
                      <textarea 
                        value={responses.d1_who_is} 
                        onChange={e => handleValueChange('d1_who_is', e.target.value)} 
                        placeholder="Describe your child's personality, character, strengths..." 
                        style={styles.textarea} 
                      />
                    </div>

                    <div style={styles.inputGroup}>
                      <label style={styles.label}>What {firstName} enjoys</label>
                      <textarea 
                        value={responses.d1_enjoys} 
                        onChange={e => handleValueChange('d1_enjoys', e.target.value)} 
                        placeholder="Interests, games, activities, books, things that spark joy..." 
                        style={styles.textarea} 
                      />
                    </div>

                    <div style={styles.inputGroup}>
                      <label style={styles.label}>What would help {firstName} most</label>
                      <textarea 
                        value={responses.d1_what_helps} 
                        onChange={e => handleValueChange('d1_what_helps', e.target.value)} 
                        placeholder="Supports, routines, tools, or adaptations that make the most impact..." 
                        style={styles.textarea} 
                      />
                    </div>
                  </div>
                )}

                {/* ── STEP 2: SOCIAL & COMMUNICATION ── */}
                {currentStep === 2 && renderScoredDomain(
                  2,
                  [
                    `${firstName} understands what is said to them`,
                    `${firstName} lets you know what they want or need`,
                    `${firstName} starts an interaction or conversation on their own`,
                    `${firstName} has a reliable way to communicate`,
                    `${firstName} follows simple instructions`,
                    `${firstName} enjoys being around familiar people`,
                    `${firstName} joins in group or shared activities`,
                    `${firstName} shows interest in others or wants friends`,
                    `${firstName} shares attention (follows where you point, shows you things)`,
                    `${firstName} gets along with peers without conflict`
                  ],
                  [
                    'd2_understands', 'd2_communicates', 'd2_initiates', 'd2_reliable_way',
                    'd2_follows_instructions', 'd2_enjoys_familiar', 'd2_joins_group',
                    'd2_shares_interest', 'd2_shares_attention', 'd2_gets_along'
                  ],
                  Array(10).fill(true)
                )}

                {/* ── STEP 3: ACADEMICS & LEARNING ── */}
                {currentStep === 3 && renderScoredDomain(
                  3,
                  [
                    `${firstName} is curious and eager to learn`,
                    `${firstName} picks up new skills or information at a steady pace`,
                    `${firstName} remembers and recalls things well`,
                    `${firstName} engages with learning activities (books, numbers, games)`,
                    `${firstName} finds learning tasks frustrating or avoids them`
                  ],
                  ['d3_curious', 'd3_steady_pace', 'd3_remembers', 'd3_engages', 'd3_frustrated'],
                  [true, true, true, true, false]
                )}

                {/* ── STEP 4: BEHAVIOUR & REGULATION ── */}
                {currentStep === 4 && renderScoredDomain(
                  4,
                  [
                    `${firstName} calms down within a reasonable time after getting upset`,
                    `${firstName} copes with changes to routine without distress`,
                    `${firstName} has big emotional swings during the day`,
                    `${firstName} gets frustrated or angry easily`,
                    `${firstName} seems anxious or worried`,
                    `${firstName} stays focused on a task for a reasonable time`,
                    `${firstName} follows multi-step directions`,
                    `${firstName} acts before thinking or struggles to wait`,
                    `${firstName} is easily distracted`
                  ],
                  [
                    'd4_calms_down', 'd4_copes_routine', 'd4_emotional_swings',
                    'd4_frustrated_easily', 'd4_anxious', 'd4_stays_focused',
                    'd4_follows_multistep', 'd4_acts_before_thinking', 'd4_distracted'
                  ],
                  [true, true, false, false, false, true, true, false, false]
                )}

                {/* ── STEP 5: SENSORY ── */}
                {currentStep === 5 && renderScoredDomain(
                  5,
                  [
                    `${firstName} copes well with everyday sights, sounds, and textures`,
                    `${firstName} gets overwhelmed in loud or busy environments`,
                    `Clothing tags, seams, or textures bother ${firstName}`,
                    `${firstName} is sensitive to bright lights or certain sounds`,
                    `${firstName} has strong reactions to food textures or smells`
                  ],
                  ['d5_copes_sights', 'd5_overwhelmed_busy', 'd5_clothing_tags', 'd5_sensitive_lights', 'd5_reactions_textures'],
                  [true, false, false, false, false]
                )}

                {/* ── STEP 6: FUNCTIONAL WELLNESS ── */}
                {currentStep === 6 && renderScoredDomain(
                  6,
                  [
                    `${firstName} falls asleep easily`,
                    `${firstName} sleeps through the night`,
                    `${firstName} has a regular sleep routine`,
                    `${firstName} wakes often or has restless sleep`,
                    `${firstName} eats a reasonable range of foods`
                  ],
                  ['d6_falls_asleep', 'd6_sleeps_night', 'd6_sleep_routine', 'd6_wakes_often', 'd6_eats_range'],
                  [true, true, true, false, true]
                )}

                {/* ── STEP 7: PRIMITIVE MOTOR REFLEXES ── */}
                {currentStep === 7 && renderScoredDomain(
                  7,
                  [
                    `${firstName} finds it hard to sit still (fidgets, wriggles, slumps)`,
                    `${firstName} has an awkward pencil grip or messy/tiring handwriting`,
                    `${firstName} is easily startled by sudden sounds or movement`,
                    `${firstName} was late to crawl, skipped crawling, or had an unusual crawl`,
                    `${firstName} has poor balance or gets car-sick / dislikes spinning`
                  ],
                  ['d7_sit_still', 'd7_pencil_grip', 'd7_easily_startled', 'd7_late_crawl', 'd7_poor_balance'],
                  Array(5).fill(false)
                )}

                {/* ── STEP 8: BRAIN DEVELOPMENT ── */}
                {currentStep === 8 && renderScoredDomain(
                  8,
                  [
                    `${firstName} reached early movement milestones around the expected time`,
                    `${firstName} reached early speech milestones around the expected time`,
                    `${firstName} is steadily reaching new developmental stages`,
                    `${firstName} has had a period where they lost skills they previously had`
                  ],
                  ['d8_movement_milestones', 'd8_speech_milestones', 'd8_developmental_stages', 'd8_lost_skills'],
                  [true, true, true, false]
                )}

                {/* ── STEP 9: DAILY LIVING SKILLS ── */}
                {currentStep === 9 && renderScoredDomain(
                  9,
                  [
                    `${firstName} manages personal care for their level (dressing, eating, hygiene)`,
                    `${firstName} helps with simple everyday tasks`,
                    `${firstName} follows daily routines`,
                    `${firstName} copes with everyday changes and new situations`,
                    `${firstName} needs a lot of support to get through daily activities`
                  ],
                  ['d9_personal_care', 'd9_everyday_tasks', 'd9_daily_routines', 'd9_changes_situations', 'd9_needs_support'],
                  [true, true, true, true, false]
                )}

                {/* ── STEP 10: GENETICS ── */}
                {currentStep === 10 && (
                  <div style={styles.formSection}>
                    <div style={styles.inputGroup}>
                      <label style={styles.label}>Do other family members have similar communication, learning, or developmental differences?</label>
                      <select 
                        value={responses.d10_family_differences} 
                        onChange={e => handleValueChange('d10_family_differences', e.target.value)} 
                        style={styles.select}
                      >
                        <option value="">Select option...</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                        <option value="Prefer not to say">Prefer not to say</option>
                      </select>
                    </div>
                    <div style={styles.inputGroup}>
                      <label style={styles.label}>Genetic/Developmental Assessment Notes (optional)</label>
                      <textarea 
                        value={responses.d10_genetic_notes} 
                        onChange={e => handleValueChange('d10_genetic_notes', e.target.value)} 
                        placeholder="Specify any diagnoses, genetic test results, clinical reports..." 
                        style={styles.textarea} 
                      />
                    </div>
                  </div>
                )}

                {/* ── STEP 11: ENVIRONMENT ── */}
                {currentStep === 11 && (
                  <div style={styles.formSection}>
                    <div style={styles.inputGroup}>
                      <label style={styles.label}>Where is {firstName} during the day?</label>
                      <select 
                        value={responses.d11_location} 
                        onChange={e => handleValueChange('d11_location', e.target.value)} 
                        style={styles.select}
                      >
                        <option value="">Select option...</option>
                        <option value="Home">Home</option>
                        <option value="Mainstream school">Mainstream school</option>
                        <option value="Special-ed class">Special-ed class</option>
                        <option value="Daycare">Daycare</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>

                    <div style={styles.inputGroup}>
                      <label style={styles.label}>Does {firstName} have a calm, predictable space to learn at home?</label>
                      <select 
                        value={responses.d11_calm_space} 
                        onChange={e => handleValueChange('d11_calm_space', e.target.value)} 
                        style={styles.select}
                      >
                        <option value="">Select option...</option>
                        <option value="Yes">Yes</option>
                        <option value="Somewhat">Somewhat</option>
                        <option value="No">No</option>
                      </select>
                    </div>

                    <div style={styles.inputGroup}>
                      <label style={styles.label}>What helps {firstName} feel calm and focused? (Select all that apply)</label>
                      <div style={styles.checkboxGrid}>
                        {D11_CALM_OPTIONS.map(opt => {
                          const isChecked = (responses.d11_what_helps || []).includes(opt);
                          return (
                            <label key={opt} style={styles.checkboxLabel}>
                              <input 
                                type="checkbox" 
                                checked={isChecked} 
                                onChange={() => handleCheckboxChange('d11_what_helps', opt)} 
                                style={styles.checkboxInput}
                              />
                              {opt}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            <div style={styles.reassuranceFooter}>
              ✦ Your answers build {firstName}'s Atlas 360° profile — no reports to upload.
            </div>
          </div>
          )}
        </div>

        <div style={styles.footerRow}>
          <button 
            type="button" 
            onClick={handleSaveAndContinueLater} 
            style={styles.saveLaterLink}
            disabled={submitting}
          >
            Save and continue later
          </button>

          <div style={styles.navRightGroup}>
            {currentStep > 1 && (
              <button onClick={handleBack} style={styles.backBtn} disabled={submitting}>
                ← Back
              </button>
            )}

            {currentStep < 11 ? (
              <button onClick={handleNext} style={styles.nextBtn} disabled={loadingInitial}>
                Next →
              </button>
            ) : (
              <button onClick={calculateAndSaveScores} style={styles.submitBtn} disabled={submitting}>
                {submitting ? (
                  <><Loader2 size={16} className="animate-spin" /> Compiling Profile...</>
                ) : (
                  <>Complete & Submit →</>
                )}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
    backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center',
    alignItems: 'center', zIndex: 1000, padding: 16
  },
  modal: {
    background: '#ffffff', borderRadius: 24, width: '100%', maxWidth: 720,
    height: '92vh', maxHeight: 720, display: 'flex', flexDirection: 'column',
    boxShadow: '0 20px 25px -5px rgba(0,0,0,0.05), 0 10px 10px -5px rgba(0,0,0,0.02)',
    border: '1px solid #F1F5F9', overflow: 'hidden',
    fontFamily: 'Inter, sans-serif'
  },
  headerRow: {
    padding: '20px 32px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    borderBottom: '1px solid #F1F5F9'
  },
  iconWrap: {
    width: 40, height: 40, borderRadius: 12, background: '#EEF6F8',
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  },
  closeBtn: {
    background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '1.1rem',
    padding: 6, borderRadius: '50%', transition: 'background 0.2s', ':hover': { background: '#F1F5F9' }
  },
  progressContainer: {
    padding: '16px 32px 8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    borderBottom: '1px solid #F1F5F9'
  },
  segmentsRow: {
    display: 'flex',
    flex: 1,
    gap: 4
  },
  progressSegment: {
    height: 6,
    flex: 1,
    borderRadius: 3,
    transition: 'background-color 0.3s ease-in-out, opacity 0.3s ease'
  },
  stepIndicatorRight: {
    fontSize: '0.78rem',
    fontWeight: 700,
    color: '#2D7D6F',
    whiteSpace: 'nowrap'
  },
  contentScroll: { padding: '24px 32px', flex: 1, overflowY: 'auto' },
  scrollInnerCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
    minHeight: '100%'
  },
  stepHeaderCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    borderBottom: '1px solid #F1F5F9',
    paddingBottom: 16
  },
  stepTitleHeading: {
    fontSize: '1.4rem',
    fontWeight: 800,
    color: '#1E293B',
    margin: 0
  },
  stepDescription: {
    fontSize: '0.88rem',
    color: '#64748B',
    lineHeight: 1.5,
    margin: 0
  },
  formSection: { display: 'flex', flexDirection: 'column', gap: 24 },
  questionCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    paddingBottom: 20,
    borderBottom: '1px solid #F1F5F9'
  },
  questionStatement: {
    fontSize: '0.94rem',
    fontWeight: 700,
    color: '#1E293B',
    lineHeight: 1.4
  },
  horizontalOptionsRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap'
  },
  optionTapBtn: {
    flex: '1 1 auto',
    padding: '10px 16px',
    border: '1.5px solid',
    borderRadius: 12,
    fontSize: '0.82rem',
    cursor: 'pointer',
    transition: 'all 0.15s ease-in-out',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 100
  },
  reassuranceFooter: {
    marginTop: 'auto',
    paddingTop: 24,
    textAlign: 'center',
    fontSize: '0.78rem',
    color: '#64748B',
    fontWeight: 500,
    borderTop: '1px solid #F1F5F9'
  },
  footerRow: {
    padding: '20px 32px', borderTop: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', background: '#F8FAFB', gap: 16
  },
  saveLaterLink: {
    background: 'none',
    border: 'none',
    color: '#64748B',
    fontSize: '0.88rem',
    fontWeight: 600,
    cursor: 'pointer',
    textDecoration: 'underline',
    padding: 0
  },
  navRightGroup: {
    display: 'flex',
    gap: 12,
    alignItems: 'center'
  },
  nextBtn: {
    padding: '10px 20px', background: '#2D7D6F',
    color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: '0.88rem',
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
    transition: 'opacity 0.2s'
  },
  backBtn: {
    padding: '10px 18px', background: '#ffffff', color: '#475569', border: '1px solid #D1D5DB',
    borderRadius: 12, fontWeight: 600, fontSize: '0.88rem', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 8,
    transition: 'background 0.2s'
  },
  submitBtn: {
    padding: '10px 22px', background: '#2D7D6F',
    color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: '0.88rem',
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
    transition: 'opacity 0.2s'
  },
  inputGroup: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: '0.85rem', fontWeight: 700, color: '#334155' },
  select: {
    width: '100%', padding: '12px 14px', border: '1.5px solid #D1D5DB', borderRadius: 12,
    fontSize: '0.88rem', color: '#1F2937', outline: 'none', background: '#ffffff', cursor: 'pointer',
    transition: 'border-color 0.2s'
  },
  textarea: {
    width: '100%', padding: '12px 14px', border: '1.5px solid #D1D5DB', borderRadius: 12,
    fontSize: '0.88rem', color: '#1F2937', outline: 'none', minHeight: 80, resize: 'vertical',
    fontFamily: 'Inter, sans-serif',
    transition: 'border-color 0.2s'
  },
  checkboxGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 },
  checkboxLabel: {
    display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.82rem', color: '#334155',
    cursor: 'pointer', background: '#F8FAFB', padding: '10px 14px', borderRadius: 10,
    border: '1.5px solid #E2E8F0', transition: 'all 0.2s', ':hover': { background: '#F1F5F9' }
  },
  checkboxInput: { width: 16, height: 16, accentColor: '#2D7D6F', cursor: 'pointer' }
};
