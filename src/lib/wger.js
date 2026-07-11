// Client léger pour l'API publique wger (https://wger.de/api/v2) — catalogue d'exercices.
const BASE = 'https://wger.de/api/v2';
const FR = 12, EN = 2;

export const CATEGORIES = [
  { id: 11, label: 'Pectoraux' },
  { id: 12, label: 'Dos' },
  { id: 13, label: 'Épaules' },
  { id: 8, label: 'Bras' },
  { id: 9, label: 'Jambes' },
  { id: 14, label: 'Mollets' },
  { id: 10, label: 'Abdos' },
  { id: 15, label: 'Cardio' },
];

const EQUIPMENT_FR = {
  Barbell: 'Barre',
  Bench: 'Banc',
  Dumbbell: 'Haltères',
  'Gym mat': 'Tapis de sol',
  'Incline bench': 'Banc incliné',
  Kettlebell: 'Kettlebell',
  'Pull-up bar': 'Barre de traction',
  'Resistance band': 'Élastique',
  'SZ-Bar': 'Barre EZ',
  'Swiss Ball': 'Swiss ball',
  'none (bodyweight exercise)': 'Poids du corps',
};

function pickTranslation(translations) {
  return translations.find((t) => t.language === FR) || translations.find((t) => t.language === EN) || translations[0];
}

const cache = new Map();

export async function fetchExercisesByCategory(categoryId) {
  if (cache.has(categoryId)) return cache.get(categoryId);
  // Certaines catégories dépassent largement 100 exercices (ex: Jambes = 192) : il faut
  // suivre la pagination de l'API, sinon des exercices bien réels (ex: "Leg curl (allongé)")
  // restent invisibles simplement parce qu'ils sont sur une page suivante.
  let url = `${BASE}/exerciseinfo/?category=${categoryId}&limit=100`;
  const results = [];
  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`wger: HTTP ${res.status}`);
    const json = await res.json();
    results.push(...json.results);
    url = json.next;
  }
  const list = results
    .map((r) => {
      const t = pickTranslation(r.translations || []);
      if (!t?.name) return null;
      return {
        id: r.id,
        name: t.name,
        equipment: (r.equipment || []).map((e) => EQUIPMENT_FR[e.name] || e.name),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  cache.set(categoryId, list);
  return list;
}
