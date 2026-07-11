// Barèmes de force — situe une performance (e1RM estimé) sur la population des PRATIQUANTS.
//
// Principe : la force se compare en multiple du poids de corps (ratio = e1RM / PdC).
// Pour chaque exercice on connaît, par sexe, les seuils de ratio marquant l'entrée dans
// 5 niveaux — alignés sur la logique des bases publiques type StrengthLevel/ExRx, où
// chaque niveau correspond à un centile parmi les gens qui s'entraînent ET enregistrent
// leurs charges (public déjà sélectionné, ≠ population générale — cf. l'UI qui le rappelle) :
//
//   Débutant ≈ 5e centile · Novice ≈ 20e · Intermédiaire ≈ 50e · Avancé ≈ 80e · Élite ≈ 95e
//
// Le centile affiché interpole linéairement le ratio entre ces ancres.
// ⚠️ Les seuils sont des estimations : fiables sur les gros mouvements barre, indicatifs
// sur les machines/isolation (charge très dépendante du matériel) — d'où le champ `conf`.

import { normName } from './analysis.js';

export const LEVELS = ['Débutant', 'Novice', 'Intermédiaire', 'Avancé', 'Élite'];
// Centile associé à l'entrée de chaque niveau (borne basse du niveau).
const P_ANCHORS = [5, 20, 50, 80, 95];

// Seuils de ratio (e1RM / poids de corps) par sexe : [Débutant, Novice, Intermédiaire, Avancé, Élite].
// unit: 'total' = charge totale (barre/machine) · 'db' = charge PAR haltère (déjà le cas de l'e1RM logué).
const STANDARDS = {
  bench:                { label: 'Développé couché',        unit: 'total', conf: 'high', M: [0.50, 0.75, 1.10, 1.55, 2.00], F: [0.25, 0.40, 0.60, 0.90, 1.20] },
  incline_bench:        { label: 'Développé incliné',       unit: 'total', conf: 'high', M: [0.40, 0.65, 0.95, 1.35, 1.75], F: [0.20, 0.35, 0.55, 0.80, 1.10] },
  squat:                { label: 'Squat',                   unit: 'total', conf: 'high', M: [0.75, 1.25, 1.55, 2.05, 2.65], F: [0.50, 0.75, 1.15, 1.60, 2.10] },
  deadlift:             { label: 'Soulevé de terre',        unit: 'total', conf: 'high', M: [1.00, 1.50, 2.00, 2.50, 3.05], F: [0.50, 0.90, 1.30, 1.80, 2.30] },
  romanian_deadlift:    { label: 'Soulevé de terre roumain', unit: 'total', conf: 'med', M: [0.75, 1.15, 1.55, 2.05, 2.55], F: [0.40, 0.70, 1.05, 1.45, 1.90] },
  ohp:                  { label: 'Développé militaire',     unit: 'total', conf: 'high', M: [0.35, 0.55, 0.80, 1.10, 1.45], F: [0.20, 0.35, 0.50, 0.75, 1.00] },
  db_shoulder_press:    { label: 'Développé épaules haltères', unit: 'db', conf: 'med', M: [0.15, 0.25, 0.40, 0.575, 0.75], F: [0.075, 0.15, 0.25, 0.375, 0.50] },
  barbell_row:          { label: 'Rowing barre',            unit: 'total', conf: 'high', M: [0.50, 0.75, 1.00, 1.35, 1.75], F: [0.30, 0.45, 0.65, 0.95, 1.25] },
  lat_pulldown:         { label: 'Tirage vertical',         unit: 'total', conf: 'high', M: [0.50, 0.75, 1.00, 1.30, 1.65], F: [0.35, 0.50, 0.70, 0.95, 1.25] },
  barbell_curl:         { label: 'Curl biceps barre',       unit: 'total', conf: 'high', M: [0.20, 0.40, 0.60, 0.85, 1.10], F: [0.10, 0.20, 0.35, 0.55, 0.75] },
  tricep_pushdown:      { label: 'Extension triceps poulie', unit: 'total', conf: 'low', M: [0.25, 0.40, 0.60, 0.85, 1.10], F: [0.15, 0.25, 0.40, 0.60, 0.80] },
  leg_press:            { label: 'Presse à cuisses',        unit: 'total', conf: 'low', M: [1.25, 2.00, 2.75, 3.75, 4.75], F: [0.75, 1.35, 2.00, 2.85, 3.75] },
  lying_leg_curl:       { label: 'Leg curl allongé',        unit: 'total', conf: 'med', M: [0.30, 0.50, 0.75, 1.05, 1.35], F: [0.20, 0.35, 0.55, 0.80, 1.05] },
  bulgarian_split_squat: { label: 'Fentes bulgares',        unit: 'db',    conf: 'med', M: [0.15, 0.30, 0.50, 0.75, 1.00], F: [0.10, 0.20, 0.35, 0.55, 0.75] },
};

// Correspondance nom d'exercice (appli, potentiellement wger) → clé de barème.
// Ordre du plus spécifique au plus générique : le premier test qui passe l'emporte.
const MATCHERS = [
  ['incline_bench',        (n) => n.includes('incline')],
  ['db_shoulder_press',    (n) => (n.includes('militaire') || n.includes('epaule')) && n.includes('haltere')],
  ['ohp',                  (n) => n.includes('militaire') || n.includes('overhead') || (n.includes('developpe') && n.includes('epaule'))],
  ['bench',                (n) => n.includes('bench') || (n.includes('developpe') && n.includes('couche'))],
  ['romanian_deadlift',    (n) => n.includes('roumain') || n.includes('romanian')],
  ['deadlift',             (n) => n.includes('souleve') || n.includes('deadlift') || n.includes('de terre')],
  ['bulgarian_split_squat', (n) => n.includes('bulgare') || n.includes('bulgarian') || n.includes('split')],
  ['squat',                (n) => n.includes('squat')],
  ['leg_press',            (n) => n.includes('presse') || n.includes('leg press')],
  ['lat_pulldown',         (n) => n.includes('pulldown') || (n.includes('tirage') && n.includes('vertical')) || (n.includes('traction') && n.includes('poulie'))],
  ['barbell_row',          (n) => n.includes('rowing') || n.includes('row') || (n.includes('tirage') && n.includes('horizontal'))],
  ['lying_leg_curl',       (n) => n.includes('leg curl') || (n.includes('curl') && (n.includes('ischio') || n.includes('jambe'))) || n.includes('ischio')],
  ['tricep_pushdown',      (n) => n.includes('triceps') && (n.includes('poulie') || n.includes('corde') || n.includes('pushdown') || n.includes('extension'))],
  ['barbell_curl',         (n) => n.includes('curl') && !n.includes('leg')],
];

export function matchStandardKey(exerciseName) {
  const n = normName(exerciseName);
  if (!n) return null;
  for (const [key, test] of MATCHERS) if (test(n)) return key;
  return null;
}

const sexKey = (sex) => (String(sex).toLowerCase().startsWith('f') ? 'F' : 'M');
const round1 = (x) => Math.round(x * 10) / 10;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Coefficient d'âge : la force plafonne ~20–33 ans puis décline. On abaisse les seuils
// pour les plus âgés (à performance égale, meilleur centile). ~1.0 en pleine force.
export function ageFactor(age) {
  const a = Number(age) || 0;
  if (a <= 33) return 1.0;
  if (a <= 40) return 1 - (a - 33) * 0.006; // ~0.958 à 40 ans
  if (a <= 50) return 0.958 - (a - 40) * 0.009; // ~0.868 à 50 ans
  if (a <= 60) return 0.868 - (a - 50) * 0.011; // ~0.758 à 60 ans
  return Math.max(0.5, 0.758 - (a - 60) * 0.013);
}

function percentileFromRatio(ratio, thr) {
  if (ratio <= 0) return 0;
  if (ratio <= thr[0]) return round1((ratio / thr[0]) * P_ANCHORS[0]); // 0 → 5e centile
  for (let i = 0; i < thr.length - 1; i++) {
    if (ratio <= thr[i + 1]) {
      const f = (ratio - thr[i]) / (thr[i + 1] - thr[i]);
      return round1(P_ANCHORS[i] + f * (P_ANCHORS[i + 1] - P_ANCHORS[i]));
    }
  }
  // Au-delà du seuil Élite : approche asymptotiquement le 99e centile.
  const over = clamp((ratio - thr[4]) / (thr[4] * 0.2), 0, 1);
  return round1(95 + over * 4);
}

// Situe une performance sur la population. Renvoie null si données insuffisantes.
export function assessStrength({ exerciseName, e1rm, sex, bodyweight, age }) {
  const w = Number(e1rm) || 0;
  const bw = Number(bodyweight) || 0;
  if (w <= 0 || bw <= 0) return null;
  const key = matchStandardKey(exerciseName);
  if (!key) return { matched: false, exerciseName };

  const std = STANDARDS[key];
  const base = std[sexKey(sex)];
  const af = ageFactor(age);
  const thr = base.map((t) => t * af); // seuils ajustés à l'âge
  const ratio = w / bw;

  const nPassed = thr.reduce((n, t) => n + (ratio >= t ? 1 : 0), 0); // 0..5
  const levelIndex = clamp(nPassed - 1, 0, 4); // index dans LEVELS
  const percentile = clamp(percentileFromRatio(ratio, thr), 0, 99);

  let nextLevel = null, kgToNext = null;
  if (nPassed < 5) {
    nextLevel = LEVELS[nPassed];
    kgToNext = Math.max(0, Math.round((thr[nPassed] * bw - w) * 10) / 10);
  }

  return {
    matched: true,
    key,
    label: std.label,
    unit: std.unit, // 'total' | 'db'
    conf: std.conf, // 'high' | 'med' | 'low'
    e1rm: Math.round(w),
    ratio: round1(ratio),
    ageFactor: af,
    levelIndex,
    level: LEVELS[levelIndex],
    percentile,
    nextLevel,
    kgToNext,
    thresholds: thr.map(round1),
  };
}

// Couleur par niveau, cohérente avec la palette Oracle.
export const LEVEL_COLORS = ['#7fa3c2', '#4db8ff', '#5de1ff', '#4ade80', '#ffc266'];
