// Couche d'analyse des séances : e1RM estimé (formule d'Epley), volume, progression
// par exercice — rapprochée par NOM entre les séances (et non par position, pour rester
// juste quand les templates changent de forme) — records battus et agrégats hebdo.

export function epley1RM(weight, reps) {
  const w = Number(weight) || 0, r = Number(reps) || 0;
  if (!w || !r) return 0;
  return r === 1 ? w : w * (1 + r / 30);
}

export function normName(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function setStats(sets) {
  const done = (sets || []).filter((s) => s.checked && Number(s.reps) > 0);
  const volume = Math.round(done.reduce((a, s) => a + (Number(s.weight) || 0) * (Number(s.reps) || 0), 0));
  const topWeight = done.reduce((a, s) => Math.max(a, Number(s.weight) || 0), 0);
  const bestE1RM = Math.round(done.reduce((a, s) => Math.max(a, epley1RM(s.weight, s.reps)), 0));
  return { volume, topWeight, bestE1RM, nSets: done.length, sets: done };
}

// Index par exercice (clé = nom normalisé) ; entrées triées par date croissante.
export function exerciseIndex(history) {
  const map = new Map();
  const logs = [...history].sort((a, b) => (a.performed_on < b.performed_on ? -1 : 1));
  for (const log of logs) {
    for (const ex of log.data?.exercises || []) {
      const key = normName(ex.name);
      if (!key) continue;
      const st = setStats(ex.sets);
      if (!st.nSets) continue;
      if (!map.has(key)) map.set(key, { name: ex.name, entries: [] });
      const rec = map.get(key);
      rec.name = ex.name; // on garde la graphie la plus récente
      rec.entries.push({ date: log.performed_on, sessionKey: log.session_key, ...st });
    }
  }
  return map;
}

// Contexte de séance par exercice : poids par défaut, dernière perf, tendance e1RM, records.
export function buildExerciseContextByName(history, exercises) {
  const idx = exerciseIndex(history);
  return exercises.map((ex) => {
    const entries = idx.get(normName(ex.name))?.entries || [];
    const last = entries[entries.length - 1] || null;
    const prev = entries[entries.length - 2] || null;
    const defaultWeight = last ? last.topWeight : (ex.prev || 0);
    const delta = last && prev ? Math.round(last.bestE1RM - prev.bestE1RM) : 0;
    const spark = entries.slice(-6).map((e) => e.bestE1RM);
    while (spark.length < 2) spark.unshift(spark[0] ?? (ex.prev || 0));
    return {
      defaultWeight,
      prevWeight: defaultWeight,
      delta, // évolution du e1RM estimé vs séance précédente
      spark, // série des e1RM (6 dernières séances)
      lastSets: last ? last.sets : null,
      lastDate: last ? last.date : null,
      bestWeight: entries.reduce((a, e) => Math.max(a, e.topWeight), 0) || (ex.pr || 0),
      bestE1RM: entries.reduce((a, e) => Math.max(a, e.bestE1RM), 0) || null,
    };
  });
}

// Stats de chaque exercice d'un log + « record battu » vs l'historique antérieur à sa date.
export function recapStats(log, history) {
  const idx = exerciseIndex(history);
  return (log.data?.exercises || []).map((ex) => {
    const st = setStats(ex.sets);
    const prior = (idx.get(normName(ex.name))?.entries || []).filter((e) => e.date < log.performed_on);
    const priorBest = prior.reduce((a, e) => Math.max(a, e.bestE1RM), 0);
    return { ...st, isPR: st.bestE1RM > 0 && prior.length > 0 && st.bestE1RM > priorBest };
  });
}

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Vue d'ensemble : volume hebdo (8 dernières semaines), stats 30 jours, records récents.
export function overview(history) {
  const logs = [...history].sort((a, b) => (a.performed_on < b.performed_on ? -1 : 1));
  const now = new Date();

  const weeks = [];
  const start = mondayOf(isoDay(now));
  for (let i = 7; i >= 0; i--) {
    const d = new Date(start); d.setDate(d.getDate() - i * 7);
    weeks.push({ key: isoDay(d), label: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`, upper: 0, lower: 0, autres: 0, sessions: 0 });
  }
  const byKey = new Map(weeks.map((w) => [w.key, w]));
  const cutoff30 = new Date(now); cutoff30.setDate(cutoff30.getDate() - 30);
  let n30 = 0, vol30 = 0, up30 = 0, low30 = 0, lastDate = null;

  for (const log of logs) {
    const vol = (log.data?.exercises || []).reduce((a, ex) => a + setStats(ex.sets).volume, 0);
    const wk = byKey.get(isoDay(mondayOf(log.performed_on)));
    if (wk) {
      const bucket = log.session_key === 'upper' ? 'upper' : log.session_key === 'lower' ? 'lower' : 'autres';
      wk[bucket] += vol;
      wk.sessions += 1;
    }
    if (new Date(log.performed_on + 'T12:00:00') >= cutoff30) {
      n30 += 1; vol30 += vol;
      if (log.session_key === 'upper') up30 += 1; else if (log.session_key === 'lower') low30 += 1;
    }
    lastDate = log.performed_on;
  }

  const daysSince = lastDate ? Math.floor((now - new Date(lastDate + 'T12:00:00')) / 86400000) : null;

  // Records : toute entrée qui dépasse le meilleur e1RM antérieur du même exercice
  // (la toute première séance d'un exercice ne compte pas — c'est une base, pas un record).
  const prs = [];
  for (const [, rec] of exerciseIndex(history)) {
    let best = 0;
    rec.entries.forEach((e, i) => {
      if (i > 0 && e.bestE1RM > best) prs.push({ name: rec.name, date: e.date, e1rm: e.bestE1RM, weight: e.topWeight });
      best = Math.max(best, e.bestE1RM);
    });
  }
  prs.sort((a, b) => (a.date < b.date ? 1 : -1));

  return { weeks, n30, vol30: Math.round(vol30), up30, low30, daysSince, prs: prs.slice(0, 6) };
}
