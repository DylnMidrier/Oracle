// Utilitaires d'affichage du module Entraînement. La logique d'analyse (e1RM, volume,
// progression par exercice, records) vit dans src/lib/analysis.js.
export function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function sparkPoints(arr, w, h, pad) {
  const min = Math.min(...arr), max = Math.max(...arr), rng = max - min || 1;
  return arr.map((val, i) => {
    const x = arr.length === 1 ? w / 2 : (i / (arr.length - 1)) * (w - pad * 2) + pad;
    const y = h - pad - ((val - min) / rng) * (h - pad * 2);
    return { x: +x.toFixed(1), y: +y.toFixed(1) };
  });
}
