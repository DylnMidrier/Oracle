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

// Volume (kg) des séries réellement effectuées d'un log.
function logVolume(log) {
  return (log.data?.exercises || []).reduce(
    (a, ex) => a + (ex.sets || [])
      .filter((s) => s.checked && Number(s.reps) > 0)
      .reduce((aa, s) => aa + (Number(s.weight) || 0) * (Number(s.reps) || 0), 0),
    0,
  );
}

function daysBetween(isoA, isoB) {
  return Math.round((new Date(isoA + 'T12:00:00') - new Date(isoB + 'T12:00:00')) / 86400000);
}

// Débrief d'une séance pour l'agent Oracle (mode coach) : sélectionne la séance cible
// (la plus récente par défaut, ou par nom/date), et renvoie un résumé compact et chiffré —
// perf par exercice, e1RM estimé, records battus, évolution vs la fois précédente du même
// exercice, comparaison avec la séance de même type, et contexte de fréquence sur 30 j.
// nameFor(key) résout la clé de séance en nom lisible (via les templates), si fourni.
export function sessionAnalysis(history, { name, dateISO, nameFor } = {}) {
  const resolve = typeof nameFor === 'function' ? nameFor : (k) => k;
  const logs = [...history].sort((a, b) => (a.performed_on < b.performed_on ? 1 : -1)); // récent → ancien
  if (!logs.length) return { found: false };

  // Sélection de la cible : date exacte > nom/type de séance > dernière séance en date.
  let target = null;
  if (dateISO && /^\d{4}-\d{2}-\d{2}$/.test(dateISO)) target = logs.find((l) => l.performed_on === dateISO);
  if (!target && name) {
    const q = normName(name);
    if (q) target = logs.find((l) => {
      const key = normName(l.session_key), label = normName(resolve(l.session_key));
      return key === q || label === q || key.includes(q) || label.includes(q);
    });
  }
  if (!target) target = logs[0];

  const idx = exerciseIndex(history);
  const exercices = (target.data?.exercises || []).map((ex) => {
    const entries = idx.get(normName(ex.name))?.entries || [];
    // Entrée de CETTE séance (même date + même clé) et celle qui la précède, pour l'évolution.
    const pos = entries.findIndex((e) => e.date === target.performed_on && e.sessionKey === target.session_key);
    const cur = pos >= 0 ? entries[pos] : null;
    const prev = pos > 0 ? entries[pos - 1] : null;
    const prior = entries.filter((e) => e.date < target.performed_on);
    const priorBest = prior.reduce((a, e) => Math.max(a, e.bestE1RM), 0);
    const e1rm = cur ? cur.bestE1RM : 0;
    return {
      nom: ex.name,
      series: (cur ? cur.sets : []).map((s) => ({ poids: s.weight, reps: s.reps })),
      volume: cur ? cur.volume : 0,
      charge_max: cur ? cur.topWeight : 0,
      e1rm,
      evolution_e1rm: prev ? Math.round(e1rm - prev.bestE1RM) : null, // vs la dernière fois que l'exo a été fait
      derniere_fois: prev ? prev.date : null,
      record: e1rm > 0 && prior.length > 0 && e1rm > priorBest,
    };
  });

  const volumeTotal = Math.round(exercices.reduce((a, e) => a + e.volume, 0));
  const nbSeries = exercices.reduce((a, e) => a + e.series.length, 0);
  const records = exercices.filter((e) => e.record).map((e) => e.nom);

  const prevSame = logs.find((l) => l.session_key === target.session_key && l.performed_on < target.performed_on);
  const prevAny = logs.find((l) => l.performed_on < target.performed_on);
  const ov = overview(history);

  return {
    found: true,
    seance: resolve(target.session_key),
    date: target.performed_on,
    il_y_a_jours: daysBetween(isoDay(new Date()), target.performed_on),
    repos_avant_jours: prevAny ? daysBetween(target.performed_on, prevAny.performed_on) : null,
    rpe_global: target.overall_rpe ?? null,
    nb_exercices: exercices.length,
    nb_series: nbSeries,
    volume_total: volumeTotal,
    records,
    exercices,
    seance_precedente_meme_type: prevSame
      ? (() => {
          const v = Math.round(logVolume(prevSame));
          return { date: prevSame.performed_on, volume: v, evolution_volume: volumeTotal - v };
        })()
      : null,
    contexte_30j: { seances: ov.n30, volume: ov.vol30, upper: ov.up30, lower: ov.low30 },
  };
}
