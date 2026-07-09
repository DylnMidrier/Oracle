// Dérive poids par défaut / historique / tendance à partir des séances enregistrées dans Supabase.
export function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function logsForSession(history, key) {
  return history
    .filter((l) => l.session_key === key)
    .sort((a, b) => (a.performed_on < b.performed_on ? 1 : -1));
}

// Poids "représentatif" d'un exercice dans un log = le plus lourd parmi ses séries.
function exerciseWeight(log, ei) {
  const ex = log.data?.exercises?.[ei];
  if (!ex || !ex.sets?.length) return null;
  return Math.max(...ex.sets.map((s) => Number(s.weight) || 0));
}

export function buildExerciseContext(history, key, exercises) {
  const logs = logsForSession(history, key); // desc (le plus récent en premier)
  return exercises.map((ex, ei) => {
    let last = null, prevToLast = null;
    for (const log of logs) {
      const w = exerciseWeight(log, ei);
      if (w == null) continue;
      if (last == null) { last = w; continue; }
      if (prevToLast == null) { prevToLast = w; break; }
    }
    const defaultWeight = last != null ? last : ex.prev;
    const prevWeight = last != null ? last : ex.prev;
    const delta = prevToLast != null ? +(last - prevToLast).toFixed(1) : 0;

    const spark = [];
    for (const log of logs) {
      const w = exerciseWeight(log, ei);
      if (w != null) spark.unshift(w);
      if (spark.length >= 5) break;
    }
    while (spark.length < 2) spark.unshift(ex.prev);

    return { defaultWeight, prevWeight, delta, spark };
  });
}

export function sparkPoints(arr, w, h, pad) {
  const min = Math.min(...arr), max = Math.max(...arr), rng = max - min || 1;
  return arr.map((val, i) => {
    const x = arr.length === 1 ? w / 2 : (i / (arr.length - 1)) * (w - pad * 2) + pad;
    const y = h - pad - ((val - min) / rng) * (h - pad * 2);
    return { x: +x.toFixed(1), y: +y.toFixed(1) };
  });
}
