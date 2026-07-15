// Indice de forme / récupération du jour, croisant les signaux santé (Apple Watch)
// avec la charge d'entraînement récente. C'est le croisement Santé × Entraînement
// qu'aucun module ne faisait seul : « pousse fort » vs « journée légère ».
//
// Pondération : VFC vs baseline (signal de récupération le plus fiable) > sommeil >
// fraîcheur (jours depuis la dernière séance). Chaque facteur ne compte que s'il est
// disponible ; l'indice se calcule sur les facteurs présents (champ `partial` sinon).

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function fmtSleep(hours) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h} h ${String(m).padStart(2, '0')}`;
}

function tier(score) {
  if (score >= 78) return { level: 'OPTIMALE', verdict: 'Pousse fort aujourd’hui.', tone: 'high', color: '#4ade80' };
  if (score >= 60) return { level: 'CORRECTE', verdict: 'Séance normale envisageable.', tone: 'mid', color: '#4db8ff' };
  if (score >= 45) return { level: 'MODÉRÉE', verdict: 'Allège la charge.', tone: 'low', color: '#ffc266' };
  return { level: 'BASSE', verdict: 'Récupération conseillée.', tone: 'crit', color: '#ff5a6e' };
}

export function computeReadiness(health, { daysSinceTraining } = {}) {
  if (!health) return null;
  const factors = [];
  let acc = 0, weight = 0;

  // VFC (HRV) vs baseline : +10 % ≈ +17 pts, -10 % ≈ -17 pts, centré sur 50 à l'équilibre.
  if (health.hrv != null && health.hrv_baseline) {
    const ratio = health.hrv / health.hrv_baseline;
    const s = clamp(50 + (ratio - 1) * 170, 0, 100);
    acc += s * 0.45; weight += 0.45;
    factors.push({ key: 'hrv', label: 'VFC', score: Math.round(s), detail: `${Math.round(health.hrv)} ms / base ${Math.round(health.hrv_baseline)}` });
  }

  // Sommeil : durée (8 h = 100) croisée avec la qualité AutoSleep (score /5) quand
  // elle est disponible — 60 % durée / 40 % qualité. Sinon, durée seule.
  if (health.sleep_hours != null) {
    const dur = clamp((health.sleep_hours / 8) * 100, 0, 100);
    const hasScore = health.sleep_score != null;
    const s = hasScore ? dur * 0.6 + clamp((health.sleep_score / 5) * 100, 0, 100) * 0.4 : dur;
    acc += s * 0.35; weight += 0.35;
    const detail = hasScore ? `${fmtSleep(health.sleep_hours)} · ${health.sleep_score.toFixed(1)}/5` : fmtSleep(health.sleep_hours);
    factors.push({ key: 'sleep', label: 'SOMMEIL', score: Math.round(s), detail });
  }

  // Fraîcheur : ≥ 2 j de repos = frais, la veille = correct, séance le jour même = fatigue.
  if (daysSinceTraining != null) {
    const s = daysSinceTraining >= 2 ? 100 : daysSinceTraining === 1 ? 72 : 42;
    acc += s * 0.20; weight += 0.20;
    const detail = daysSinceTraining === 0 ? 'séance aujourd’hui' : daysSinceTraining === 1 ? 'séance hier' : `${daysSinceTraining} j de repos`;
    factors.push({ key: 'load', label: 'FRAÎCHEUR', score: s, detail });
  }

  if (weight === 0) return null;
  const score = Math.round(acc / weight);
  return { score, ...tier(score), factors, partial: weight < 0.9 };
}
