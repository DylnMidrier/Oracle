// Définitions statiques des séances : structure de l'entraînement.
// Les charges réellement soulevées sont enregistrées dans Supabase (table workout_logs).
export const SESSIONS = {
  upper: {
    meta: { name: 'UPPER', tag: 'PROTOCOLE // HAUT DU CORPS', sub: 'Pecs · Dos · Épaules · Bras', glyph: 'U', dur: '~55 min' },
    exercises: [
      { name: 'Développé incliné barre', note: 'Montée en gamme — top set + back-off', target: '4 × 8', prev: 85, pr: 87.5, rest: 150, reps: [10, 8, 8, 8] },
      { name: 'Tirage vertical prise large', note: 'Contrôle excentrique 3 s', target: '4 × 10', prev: 70, pr: 75, rest: 120, reps: [10, 10, 10, 10] },
      { name: 'Développé militaire haltères', note: 'Assis, dossier vertical', target: '3 × 10', prev: 26, pr: 28, rest: 120, reps: [10, 10, 10] },
      { name: 'Rowing barre buste penché', note: 'Prise pronation, tirage vers le nombril', target: '3 × 10', prev: 75, pr: 80, rest: 120, reps: [10, 10, 10] },
      { name: 'Élévations latérales', note: 'Tempo lent, pas d’élan', target: '3 × 15', prev: 12, pr: 14, rest: 75, reps: [15, 15, 15] },
      { name: 'Curl biceps barre EZ', note: 'Coudes fixes', target: '3 × 12', prev: 30, pr: 32.5, rest: 75, reps: [12, 12, 12] },
      { name: 'Extension triceps poulie', note: 'Corde, écartement en fin de course', target: '3 × 12', prev: 35, pr: 40, rest: 75, reps: [12, 12, 12] },
    ],
  },
  lower: {
    meta: { name: 'LOWER', tag: 'PROTOCOLE // BAS DU CORPS', sub: 'Quadris · Ischios · Fessiers · Mollets', glyph: 'L', dur: '~50 min' },
    exercises: [
      { name: 'Squat barre', note: 'Descente contrôlée, parallèle', target: '4 × 8', prev: 100, pr: 110, rest: 180, reps: [8, 8, 8, 8] },
      { name: 'Presse à cuisses', note: 'Amplitude complète', target: '3 × 12', prev: 180, pr: 200, rest: 150, reps: [12, 12, 12] },
      { name: 'Soulevé de terre roumain', note: 'Ischios sous tension, dos neutre', target: '3 × 10', prev: 90, pr: 95, rest: 150, reps: [10, 10, 10] },
      { name: 'Fentes bulgares', note: 'Haltères, pied arrière surélevé', target: '3 × 12', prev: 24, pr: 28, rest: 120, reps: [12, 12, 12] },
      { name: 'Leg curl allongé', note: 'Contraction 1 s en haut', target: '3 × 12', prev: 45, pr: 50, rest: 90, reps: [12, 12, 12] },
      { name: 'Extension mollets debout', note: 'Étirement complet en bas', target: '4 × 15', prev: 80, pr: 90, rest: 60, reps: [15, 15, 15, 15] },
    ],
  },
};
