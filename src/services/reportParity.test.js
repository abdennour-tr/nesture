import { buildReflexSections, REPORT_DISCLAIMER, getGameProfile } from './reflexProfiles';
import { buildGameReportDoc } from './reportBuilder';

/* ═══════════════════════════════════════════════════════════════════════════
   The PDF must say what the screen says.

   These two used to be separate code paths that happened to describe the same
   session. The PDF drew its own reflex table, where a reflex with no score
   defaulted to 50 and the "status" column came from CONFIDENCE — so a settled
   reflex, observed well, printed "Action recommended". A parent could hold the
   screen and the print-out side by side and read two different findings.

   Both now render the model from buildReflexSections(). These tests read the
   strings back out of the FINISHED pdf, so they check what reaches the file
   rather than what the builder meant to draw.
   ═══════════════════════════════════════════════════════════════════════════ */

function textIn(doc) {
  const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  return [...raw.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)]
    .map((m) => m[1].replace(/\\([()\\])/g, '$1'));
}

const measurement = (key, name, score, label) => ({
  reflex_key: key, reflex_name: name, measured: true, score, label, confidence: 0.6,
});

const LETTERQUEST = {
  ATNR: measurement('ATNR', 'Asymmetric Tonic Neck Reflex', 72, 'strong'),
  'Palmar Grasp': measurement('Palmar Grasp', 'Palmar Grasp Reflex', 44, 'moderate'),
  STNR: measurement('STNR', 'Symmetric Tonic Neck Reflex', 18, 'none'),
  VOR: measurement('VOR', 'Vestibulo-Ocular Reflex', 22, 'weak'),
};

function letterQuestDoc() {
  const sections = buildReflexSections('letterquest', LETTERQUEST);
  return {
    sections,
    doc: buildGameReportDoc({
      gameId: 'letterquest',
      gameName: getGameProfile('letterquest').name,
      title: 'Great session!',
      headline: { value: 78, caption: 'LPI Score' },
      breakdown: [{ label: 'Letter accuracy', value: 86 }],
      metrics: [{ value: '86%', label: 'Accuracy' }],
      sections,
      notMeasuredReason: null,
    }, { learnerName: 'Maya', sessionId: 'abcd1234', date: '2026-09-10' }),
  };
}

test('every reflex on the screen is in the PDF, with the same status wording', () => {
  const { sections, doc } = letterQuestDoc();
  const text = textIn(doc).join('\n').toLowerCase();
  for (const section of sections) {
    expect(text).toContain(section.title.toLowerCase());
    for (const entry of section.entries) {
      expect(text).toContain(entry.key.toLowerCase());
      if (entry.measured) expect(text).toContain(entry.statusText.toLowerCase());
    }
  }
});

test('the two reflex groups stay apart in print', () => {
  const { doc } = letterQuestDoc();
  const text = textIn(doc).join('\n').toLowerCase();
  expect(text).toContain('primitive reflex patterns');
  expect(text).toContain('visual & vestibular function');
});

test('a lifelong reflex never prints retention wording', () => {
  const { doc } = letterQuestDoc();
  const text = textIn(doc).join('\n');
  // VOR scored 22 (weak retention) means the reflex is WORKING — it must not
  // print as "Mostly settled", which belongs to the primitive vocabulary.
  expect(text).toContain('Working well');
  expect(text).not.toContain('VOR: strong');
});

test('the headline and its caption both reach the page', () => {
  const { doc } = letterQuestDoc();
  const text = textIn(doc).join('\n').toLowerCase();
  expect(text).toContain('78');
  expect(text).toContain('lpi score');
});

test('the disclaimer is the same sentence the screen ends on', () => {
  const { doc } = letterQuestDoc();
  expect(textIn(doc).join(' ')).toContain(REPORT_DISCLAIMER.slice(0, 40));
});

test('a targeted but unmeasured reflex prints its reason and no score', () => {
  const sections = buildReflexSections('pinch-coin', null);
  const doc = buildGameReportDoc({
    gameId: 'pinch-coin',
    gameName: getGameProfile('pinch-coin').name,
    title: 'All coins banked!',
    headline: { value: 74, caption: 'OT Score' },
    breakdown: [{ label: 'Pinch stability', value: null, weight: '25%' }],
    metrics: [],
    sections,
  }, {});
  const text = textIn(doc).join('\n');
  expect(text).toContain('Palmar Grasp');
  expect(text).toContain('Closing the hand is the point of this game');
  // None of the primitive status words may appear for an unmeasured reflex.
  expect(text).not.toContain('Clearly active');
  expect(text).not.toContain('Partly active');
  expect(text).not.toContain('Mostly settled');
});

test('an unmeasured sub-score prints a dash rather than 0%', () => {
  const doc = buildGameReportDoc({
    gameId: 'pinch-coin',
    gameName: 'Pinch the Coin',
    title: 'Round finished',
    breakdown: [{ label: 'Pinch stability', value: null, weight: '25%' }],
    metrics: [],
    sections: [],
  }, {});
  const runs = textIn(doc);
  expect(runs).toContain('-');
  expect(runs.some((r) => r.trim() === '0%')).toBe(false);
});
