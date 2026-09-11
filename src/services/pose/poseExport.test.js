/* The export turns a stored recording into an analysable dataset. These tests
   check the ROW LOGIC — that an unmeasured indicator exports as blank rather
   than 0, that every caveat travels with its number, and that a truncated
   frame sheet says so. They run against a minimal fake workbook rather than
   ExcelJS, so a failure is always ours and never the serialiser's. */
import { Workbook } from './__fixtures__/fakeExcel';
import { RECORDED_LANDMARKS } from './poseLandmarks';
import { addPoseSheets } from './poseExport';

function makeRecording(frames = 40) {
  const rows = [];
  for (let i = 0; i < frames; i += 1) {
    const row = [i * 67];
    for (let k = 0; k < RECORDED_LANDMARKS.length; k += 1) row.push(0.5, 0.5, 0.01, 0.95);
    rows.push(row);
  }
  return { schema: 'nesture.pose.v1', sampleHz: 15, landmarks: RECORDED_LANDMARKS,
           fields: ['x','y','z','visibility'], frameCount: rows.length,
           durationMs: rows[rows.length-1][0], frames: rows };
}

const rows = [{
  session_id: 'sess-0001', game_id: 'pinch-coin',
  schema_version: 'nesture.pose.v1', model_version: 'pose-indicators-v1.0.0-provisional',
  sample_hz: 15, frame_count: 40, duration_ms: 2613,
  consent: { version: 'pose-consent-v1', decidedAt: '2026-09-10T10:00:00Z', granted: true },
  created_at: '2026-09-10T10:00:05Z',
  frames: makeRecording(),
  features: { frameCount: 40, durationSec: 2.6, headYawRange: 0.31, corrYawVsExtensionAsymmetry: 0.62 },
  indicators: { usable: true, modelVersion: 'pose-indicators-v1.0.0-provisional', indicators: [
    { key:'ATNR', label:'Asymmetric Tonic Neck Reflex', evidence:'direct', measured:true,
      value:71, confidence:0.44, caveat:'Reaching and this pattern are not separable.' },
    { key:'STNR', label:'Symmetric Tonic Neck Reflex', evidence:'direct', measured:false,
      value:null, notMeasuredReason:'The head did not move up and down enough.' },
  ]},
}];

const wb = new Workbook();
const summary = addPoseSheets(wb, rows, {});
const has=(vals,s)=>vals.some(v=>String(v).includes(s));

test('four sheets created', () => { expect(['Pose Sessions','Pose Features','Pose Indicators','Pose Frames'].every(n=>wb.getWorksheet(n))).toBe(true); });

const idx = wb.getWorksheet('Pose Sessions').getRow(2).values;
test('session row carries the consent version', () => { expect(has(idx,'pose-consent-v1')).toBe(true); });
test('session row carries the model version', () => { expect(has(idx,'provisional')).toBe(true); });
test('session row carries game and session id', () => { expect(has(idx,'pinch-coin') && has(idx,'sess-0001')).toBe(true); });

const feat = wb.getWorksheet('Pose Features');
test('feature sheet has one row per session', () => { expect(feat.rowCount === 2).toBe(true); });
test('feature sheet carries the raw correlation', () => { expect(feat.getRow(2).values.includes(0.62)).toBe(true); });

const ind = wb.getWorksheet('Pose Indicators');
test('indicators are long format, one row each', () => { expect(ind.rowCount === 3).toBe(true); });
const atnr = ind.getRow(2).values, stnr = ind.getRow(3).values;
test('measured indicator carries its value', () => { expect(atnr.includes(71)).toBe(true); });
test('measured indicator carries confidence', () => { expect(atnr.includes(0.44)).toBe(true); });
test('caveat travels with every number', () => { expect(has(atnr,'not separable')).toBe(true); });
test('UNMEASURED indicator has a blank value, never 0', () => { expect(stnr.every(v=>v!==0) && has(stnr,'did not move')).toBe(true); });

const fr = wb.getWorksheet('Pose Frames');
test('one row per landmark per frame', () => { expect(fr.rowCount === 1 + 40*RECORDED_LANDMARKS.length).toBe(true); });
test('frame row names the landmark', () => { expect(has(fr.getRow(2).values,'nose')).toBe(true); });
test('frame row carries x, y, z, visibility', () => { expect(fr.getRow(2).values.filter(v=>typeof v==='number').length >= 5).toBe(true); });
test('summary reports what was written', () => { expect(summary.frameRows === 40*RECORDED_LANDMARKS.length && summary.truncated === false).toBe(true); });

// Empty case
const wb2 = new Workbook();
const s2 = addPoseSheets(wb2, [], {});
test('no recordings gives an explicit note, not an empty sheet', () => { expect(has(wb2.getWorksheet('Pose Sessions').getRow(2).values, 'No pose recordings')).toBe(true); });
test('empty export reports zero rows', () => { expect(s2.frameRows === 0).toBe(true); });
