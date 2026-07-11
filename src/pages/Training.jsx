import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { SESSIONS } from '../data/sessions.js';
import { supabase, supabaseReady } from '../lib/supabase.js';
import { fmtTime, sparkPoints } from '../lib/trainingStats.js';
import { buildExerciseContextByName, exerciseIndex, recapStats, overview } from '../lib/analysis.js';
import { CATEGORIES, fetchExercisesByCategory } from '../lib/wger.js';
import { useCoreClose } from '../lib/coreTransition.js';
import './Training.css';

const DOW = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Nom affichable d'une séance : les logs peuvent porter une clé dynamique (séance créée
// par Oracle puis supprimée/renommée) absente des templates — on retombe sur la clé.
function sessionName(templates, key) {
  return templates[key]?.meta?.name || String(key).split('_')[0].toUpperCase();
}

export default function Training() {
  const { closing, goHome } = useCoreClose();
  const location = useLocation();
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(supabaseReady);
  const [templates, setTemplates] = useState(SESSIONS);

  // select | module | calendar | recap | confirmSwap — la carte AGENDA de la Home
  // navigue ici en demandant directement l'écran calendrier (même agenda, pas de doublon).
  const [screen, setScreen] = useState(location.state?.initialScreen || 'select');
  const [sessionKey, setSessionKey] = useState(null);
  const [checks, setChecks] = useState({});
  const [weights, setWeights] = useState({});
  const [repsOverride, setRepsOverride] = useState({});
  const [setIds, setSetIds] = useState({}); // { [exId]: [id, ...] } — ordre + identité stable des séries d'un exo (ajout/suppression en cours de séance)
  const nextSetId = useRef(100000);
  const [exIds, setExIds] = useState([]); // ordre + identité stable des exercices de la séance (ajout/suppression)
  const [addedExercises, setAddedExercises] = useState({}); // { [exId]: exercice } — exercices ajoutés cette séance (absents du modèle)
  const nextExId = useRef(500000);
  const [rpe, setRpe] = useState({});
  const [active, setActive] = useState(0);
  const [timer, setTimer] = useState(0);
  const [timerTotal, setTimerTotal] = useState(0);
  const [saving, setSaving] = useState(false);
  const [sessionDate, setSessionDate] = useState(todayISO()); // modifiable pour saisir une séance a posteriori
  const [swaps, setSwaps] = useState({}); // { [exId]: { name, note, wgerId } } — remplacements pour la séance en cours

  const [pickerMode, setPickerMode] = useState(null); // 'replace' | 'add' | null
  const [pickerExId, setPickerExId] = useState(null); // cible en mode 'replace'
  const [pickerCategory, setPickerCategory] = useState(null);
  const [pickerList, setPickerList] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState(null);

  const [calY, setCalY] = useState(() => new Date().getFullYear());
  const [calM, setCalM] = useState(() => new Date().getMonth());
  const [recapLog, setRecapLog] = useState(null);
  const [anOpen, setAnOpen] = useState(null); // exercice déplié dans l'écran d'analyse

  useEffect(() => {
    if (!supabaseReady) return;
    supabase.from('workout_logs').select('*').order('performed_on', { ascending: false }).then(({ data, error }) => {
      if (!error) setHistory(data || []);
      setLoadingHistory(false);
    });
    supabase.from('session_templates').select('*').then(({ data, error }) => {
      if (!error && data?.length) {
        const t = {};
        data.forEach((row) => { t[row.key] = { meta: row.meta, exercises: row.exercises }; });
        setTemplates(t);
      }
    });
  }, []);

  useEffect(() => {
    if (timer <= 0) return;
    const id = setInterval(() => setTimer((t) => Math.max(0, t - 1)), 1000);
    return () => clearInterval(id);
  }, [timer > 0]);

  const sess = sessionKey ? templates[sessionKey] : null;
  const exercises = useMemo(() => {
    if (!sess) return [];
    return exIds.map((id) => {
      const base = addedExercises[id] || sess.exercises[id];
      return swaps[id] ? { ...base, name: swaps[id].name, note: swaps[id].note, wgerId: swaps[id].wgerId } : base;
    });
  }, [sess, exIds, swaps, addedExercises]);
  const exCtx = useMemo(() => (sess ? buildExerciseContextByName(history, exercises) : []), [sess, history, exercises]);

  // Données de l'écran d'analyse : vue d'ensemble + progression par exercice (du plus récent au plus ancien).
  const ov = useMemo(() => overview(history), [history]);
  const anExercises = useMemo(
    () => Array.from(exerciseIndex(history).entries())
      .map(([key, rec]) => ({ key, ...rec }))
      .sort((a, b) => (a.entries[a.entries.length - 1].date < b.entries[b.entries.length - 1].date ? 1 : -1)),
    [history],
  );

  function selectSession(key) {
    const s = templates[key];
    const ctx = buildExerciseContextByName(history, s.exercises);
    const w = {}; const r = {}; const ids = {};
    s.exercises.forEach((ex, ei) => {
      ids[ei] = ex.reps.map((_, si) => si);
      ex.reps.forEach((baseReps, si) => { w[`${ei}_${si}`] = String(ctx[ei].defaultWeight); r[`${ei}_${si}`] = String(baseReps); });
    });
    setSessionKey(key); setWeights(w); setRepsOverride(r); setSetIds(ids);
    setExIds(s.exercises.map((_, ei) => ei)); setAddedExercises({});
    setChecks({}); setRpe({}); setActive(0); setTimer(0); setTimerTotal(0); setSwaps({});
    setSessionDate(todayISO());
    setScreen('module');
  }

  function addSet(exId) {
    const id = nextSetId.current++;
    const list = setIds[exId] || [];
    const lastKey = list.length ? `${exId}_${list[list.length - 1]}` : null;
    const w = (lastKey && weights[lastKey] != null) ? weights[lastKey] : String(exCtx[exIds.indexOf(exId)]?.defaultWeight ?? 0);
    const r = (lastKey && repsOverride[lastKey] != null) ? repsOverride[lastKey] : '10';
    const k = `${exId}_${id}`;
    setSetIds((m) => ({ ...m, [exId]: [...(m[exId] || []), id] }));
    setWeights((ws) => ({ ...ws, [k]: w }));
    setRepsOverride((rs) => ({ ...rs, [k]: r }));
  }

  function removeSet(exId, id) {
    setSetIds((m) => {
      const list = m[exId] || [];
      if (list.length <= 1) return m; // garder au moins une série
      return { ...m, [exId]: list.filter((x) => x !== id) };
    });
  }

  function addExercise(item) {
    const exId = nextExId.current++;
    const equip = item.equipment.length ? ` · ${item.equipment.join(', ')}` : '';
    const newEx = { name: item.name, note: `Ajouté via wger${equip}`, target: '3 × 10', prev: 0, pr: 0, rest: 90, reps: [10, 10, 10], wgerId: item.id };
    const ids = [0, 1, 2];
    setAddedExercises((m) => ({ ...m, [exId]: newEx }));
    setExIds((cur) => [...cur, exId]);
    setSetIds((m) => ({ ...m, [exId]: ids }));
    const w = {}; const r = {};
    ids.forEach((sid) => { w[`${exId}_${sid}`] = '0'; r[`${exId}_${sid}`] = '10'; });
    setWeights((ws) => ({ ...ws, ...w }));
    setRepsOverride((rs) => ({ ...rs, ...r }));
    setActive(exIds.length);
  }

  function removeExercise(exId) {
    if (exIds.length <= 1) return;
    const newLen = exIds.length - 1;
    setExIds((ids) => ids.filter((x) => x !== exId));
    setActive((a) => Math.max(0, Math.min(a, newLen - 1)));
  }

  function backToSelect() { setScreen('select'); setSessionKey(null); setTimer(0); setSwaps({}); }

  function openReplacePicker(exId) { setPickerMode('replace'); setPickerExId(exId); setPickerCategory(null); setPickerList([]); setPickerError(null); }
  function openAddPicker() { setPickerMode('add'); setPickerExId(null); setPickerCategory(null); setPickerList([]); setPickerError(null); }
  function closePicker() { setPickerMode(null); setPickerExId(null); setPickerCategory(null); setPickerList([]); }

  async function pickCategory(catId) {
    setPickerCategory(catId); setPickerLoading(true); setPickerError(null);
    try {
      const list = await fetchExercisesByCategory(catId);
      setPickerList(list);
    } catch {
      setPickerError("Impossible de joindre le catalogue wger. Réessaie plus tard.");
    } finally {
      setPickerLoading(false);
    }
  }

  function applyPicked(item) {
    if (pickerMode === 'add') {
      addExercise(item);
    } else if (pickerExId != null) {
      const equip = item.equipment.length ? ` · ${item.equipment.join(', ')}` : '';
      setSwaps((s) => ({ ...s, [pickerExId]: { name: item.name, note: `Remplacé via wger${equip}`, wgerId: item.id } }));
    }
    closePicker();
  }

  // Applique au modèle les remplacements, ajouts/suppressions d'exercices ET les
  // changements de nombre de séries faits pendant la séance (si choisi en fin de séance).
  async function applyTemplateChanges() {
    const updated = exIds.map((id) => {
      const base = addedExercises[id] || sess.exercises[id];
      const swapped = swaps[id] ? { ...base, name: swaps[id].name, note: swaps[id].note, wgerId: swaps[id].wgerId } : base;
      const ids = setIds[id] || swapped.reps.map((_, si) => si);
      if (ids.length === swapped.reps.length) return swapped;
      const reps = ids.map((sid) => parseInt(repsOverride[`${id}_${sid}`], 10) || swapped.reps[sid] || 10);
      const allSame = reps.every((r) => r === reps[0]);
      return { ...swapped, reps, target: allSame ? `${reps.length} × ${reps[0]}` : `${reps.length} séries` };
    });
    if (supabaseReady) {
      await supabase.from('session_templates').update({ exercises: updated, updated_at: new Date().toISOString() }).eq('key', sessionKey);
    }
    setTemplates((t) => ({ ...t, [sessionKey]: { ...t[sessionKey], exercises: updated } }));
  }

  function toggleSet(exId, si, rest) {
    const key = `${exId}_${si}`;
    setChecks((c) => {
      const now = !c[key];
      if (now) { setTimer(rest); setTimerTotal(rest); }
      return { ...c, [key]: now };
    });
  }
  function setWeight(key, val) { setWeights((w) => ({ ...w, [key]: val })); }
  function stepWeight(key, d) { setWeights((w) => ({ ...w, [key]: String(Math.max(0, (parseFloat(w[key]) || 0) + d)) })); }
  function setRepCount(key, val) { setRepsOverride((r) => ({ ...r, [key]: val })); }
  function stepRepCount(key, base, d) { setRepsOverride((r) => ({ ...r, [key]: String(Math.max(1, (parseInt(r[key], 10) || base) + d)) })); }
  function toggleRpe(exId, n) { setRpe((r) => ({ ...r, [exId]: r[exId] === n ? null : n })); }

  let doneSets = 0, totalSets = 0;
  if (sess) exIds.forEach((exId) => (setIds[exId] || []).forEach((id) => { totalSets++; if (checks[`${exId}_${id}`]) doneSets++; }));
  const pct = totalSets ? Math.round((doneSets / totalSets) * 100) : 0;

  // Séries ajoutées/supprimées par rapport au modèle d'origine, à proposer de garder en fin de séance.
  const setChanges = sess ? exIds
    .filter((id) => !addedExercises[id])
    .map((id) => ({ id, name: swaps[id]?.name || sess.exercises[id].name, before: sess.exercises[id].reps.length, after: (setIds[id] || []).length }))
    .filter((c) => c.before !== c.after) : [];
  const removedExerciseNames = sess ? sess.exercises.filter((_ex, id) => !exIds.includes(id)).map((ex) => ex.name) : [];
  const addedExerciseNames = exIds.filter((id) => addedExercises[id]).map((id) => addedExercises[id].name);
  const hasChanges = Object.keys(swaps).length > 0 || setChanges.length > 0 || removedExerciseNames.length > 0 || addedExerciseNames.length > 0;

  async function finishSession() {
    if (!sess) return;
    const rpeVals = Object.values(rpe).filter((v) => v != null);
    const overall = rpeVals.length ? Math.round(rpeVals.reduce((a, b) => a + b, 0) / rpeVals.length) : null;
    const data = {
      exercises: exercises.map((ex, pos) => {
        const exId = exIds[pos];
        return {
          name: ex.name, note: ex.note, target: ex.target, rpe: rpe[exId] || null,
          sets: (setIds[exId] || []).map((id) => {
            const k = `${exId}_${id}`;
            return { reps: parseInt(repsOverride[k], 10) || ex.reps[id] || 0, weight: Number(weights[k]) || 0, checked: !!checks[k] };
          }),
        };
      }),
    };
    if (supabaseReady) {
      setSaving(true);
      const { data: inserted, error } = await supabase.from('workout_logs')
        .insert({ session_key: sessionKey, performed_on: sessionDate || todayISO(), overall_rpe: overall, data })
        .select();
      setSaving(false);
      if (!error && inserted) setHistory((h) => [inserted[0], ...h]);
    }
    if (hasChanges) setScreen('confirmSwap');
    else backToSelect();
  }

  // ---- calendrier ----
  const historyByDate = useMemo(() => {
    const m = {};
    history.forEach((l) => { m[l.performed_on] = l; });
    return m;
  }, [history]);

  function openRecap(log) { setRecapLog(log); setScreen('recap'); }

  const first = new Date(calY, calM, 1);
  const startDow = (first.getDay() + 6) % 7;
  const dim = new Date(calY, calM + 1, 0).getDate();
  const monthLabel = first.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }).toUpperCase();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  let monthCount = 0;
  for (let d = 1; d <= dim; d++) {
    const key = `${calY}-${String(calM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const log = historyByDate[key];
    if (log) monthCount++;
    cells.push({ d, key, log });
  }

  return (
    <div className={`tr-page${closing ? ' core-blur-out' : ''}`}>
      <div className="tr-page-sweep" />
      <div className="tr-topbar">
        <div className="tr-brand">
          <button className="tr-icon-btn" onClick={goHome}>‹</button>
          <span className="name hdg">ENTRAÎNEMENT</span>
        </div>
        {screen !== 'calendar' && screen !== 'recap' && screen !== 'analyse' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="tr-icon-btn" title="Analyse" onClick={() => setScreen('analyse')}>∿</button>
            <button className="tr-icon-btn" title="Historique" onClick={() => setScreen('calendar')}>▦</button>
          </div>
        )}
        {(screen === 'calendar' || screen === 'recap' || screen === 'analyse') && (
          <button className="tr-icon-btn" onClick={() => setScreen('select')}>✕</button>
        )}
      </div>

      {!supabaseReady && (
        <div className="tr-note">Supabase n'est pas configuré (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY manquants) — les séances ne seront pas sauvegardées.</div>
      )}

      {screen === 'select' && (
        <div className="tr-select">
          <div className="eyebrow">ORACLE // ENTRAÎNEMENT</div>
          <h1 className="hdg">Sélection de séance</h1>
          <div className="tr-cards">
            {Object.entries(templates).map(([key, s]) => (
              <div key={key} className="scard" onClick={() => selectSession(key)}>
                <div className="glyph">{s.meta.glyph}</div>
                <div className="tag">{s.meta.tag}</div>
                <div className="name hdg">{s.meta.name}</div>
                <div className="sub">{s.meta.sub}</div>
                <div className="meta">
                  <span><b>{s.exercises.length}</b> exos</span>
                  <span><b>{s.meta.dur}</b></span>
                  <span><b>{s.exercises.reduce((a, e) => a + e.reps.length, 0)}</b> séries</span>
                </div>
                <div className="open">OUVRIR LE FICHIER ▸</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {screen === 'module' && sess && (
        <div className="tr-module">
          <div className="tr-progress-row">
            <div className="n hdg">{doneSets}<span>/{totalSets}</span></div>
            <div className="tr-bar"><div style={{ width: `${pct}%` }} /></div>
            <span style={{ fontSize: 11, color: '#5a7893' }}>{pct}%</span>
            <input type="date" className="tr-date-input" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} title="Date de la séance (modifiable pour une saisie a posteriori)" />
          </div>

          <div className="tr-strip">
            {exercises.map((_ex, pos) => {
              const exId = exIds[pos];
              const ids = setIds[exId] || [];
              const setCount = ids.length;
              const d = ids.filter((id) => checks[`${exId}_${id}`]).length;
              const complete = d === setCount;
              return (
                <div key={exId} className="tr-strip-item" onClick={() => setActive(pos)} style={{ background: active === pos ? 'rgba(77,184,255,.12)' : 'transparent', borderColor: active === pos ? 'rgba(120,190,255,.5)' : 'var(--line)' }}>
                  <span style={{ color: active === pos ? '#eaf5ff' : '#9fc0dc' }}>{String(pos + 1).padStart(2, '0')}</span>
                  <span className="dot" style={{ background: complete ? '#4ade80' : (d > 0 ? '#4db8ff' : '#2c4258') }} />
                </div>
              );
            })}
          </div>

          <div className="tr-body">
            <div className="tr-rail">
              {exercises.map((ex, pos) => {
                const exId = exIds[pos];
                const ids = setIds[exId] || [];
                const setCount = ids.length;
                const d = ids.filter((id) => checks[`${exId}_${id}`]).length;
                const complete = d === setCount;
                const delta = exCtx[pos].delta;
                const dCol = delta > 0 ? '#4ade80' : delta < 0 ? '#ff6b6b' : '#7fa3c2';
                const dArrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '=';
                return (
                  <div key={exId} className={`tr-rail-item${active === pos ? ' active' : ''}`} onClick={() => setActive(pos)}>
                    <div className="top"><span>{String(pos + 1).padStart(2, '0')}</span><span style={{ color: dCol }}>{dArrow} {delta ? `${delta > 0 ? '+' : ''}${delta} kg` : ''}</span></div>
                    <div className="nm">{ex.name}</div>
                    <div className="prog">
                      <div className="track"><div style={{ width: `${Math.round((d / setCount) * 100)}%`, background: complete ? 'linear-gradient(90deg,#4ade80,#5de1ff)' : 'linear-gradient(90deg,#3a7bff,#5de1ff)' }} /></div>
                      <span>{d}/{setCount}</span>
                    </div>
                  </div>
                );
              })}
              <button className="tr-set-add" style={{ marginTop: 4 }} onClick={openAddPicker}>+ AJOUTER UN EXERCICE</button>
            </div>

            <ExerciseDetail
              exId={exIds[active]} pos={active} ex={exercises[active]} ctx={exCtx[active]} setIds={setIds[exIds[active]] || []}
              checks={checks} weights={weights} repsOverride={repsOverride} rpeSel={rpe[exIds[active]]}
              onToggleSet={toggleSet} onSetWeight={setWeight} onStepWeight={stepWeight}
              onSetReps={setRepCount} onStepReps={stepRepCount} onSetRpe={(n) => toggleRpe(exIds[active], n)}
              onAddSet={addSet} onRemoveSet={removeSet}
              onRemoveExercise={() => removeExercise(exIds[active])} canRemoveExercise={exIds.length > 1}
              onAddExercise={openAddPicker}
              hasPrev={active > 0} hasNext={active < exercises.length - 1}
              onPrev={() => setActive((a) => Math.max(0, a - 1))} onNext={() => setActive((a) => Math.min(exercises.length - 1, a + 1))}
              onReplace={() => openReplacePicker(exIds[active])}
            />
          </div>

          <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 32px', width: '100%' }}>
            <button className="tr-finish" disabled={saving} onClick={finishSession}>{saving ? 'ENREGISTREMENT…' : 'TERMINER LA SÉANCE'}</button>
          </div>

          {timer > 0 && (
            <div className="tr-timer">
              <div className="tr-timer-row">
                <span className="dot" />
                <span className="lbl">REPOS</span>
                <span className="time hdg" style={{ marginLeft: 'auto' }}>{fmtTime(timer)}</span>
              </div>
              <div className="tr-timer-track"><div style={{ width: `${timerTotal ? Math.round((timer / timerTotal) * 100) : 0}%` }} /></div>
              <div className="tr-timer-actions">
                <button onClick={() => { setTimer((t) => t + 15); setTimerTotal((t) => t + 15); }}>+15 s</button>
                <button onClick={() => setTimer(0)}>PASSER</button>
              </div>
            </div>
          )}
        </div>
      )}

      {screen === 'confirmSwap' && (
        <div className="tr-select">
          <div className="eyebrow">MODÈLE DE SÉANCE</div>
          <h1 className="hdg">Mettre à jour {sess?.meta.name} ?</h1>
          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 560 }}>
            {Object.entries(swaps).map(([exId, s]) => (
              <div key={`swap-${exId}`} className="tr-recap-ex" style={{ margin: 0 }}>
                <span style={{ color: '#5a7893' }}>{(addedExercises[exId] || sess.exercises[exId])?.name}</span> → <span style={{ color: '#eaf5ff', fontWeight: 600 }}>{s.name}</span>
              </div>
            ))}
            {setChanges.map((c) => (
              <div key={`setchg-${c.id}`} className="tr-recap-ex" style={{ margin: 0 }}>
                <span style={{ color: '#5a7893' }}>{c.name}</span> · <span style={{ color: '#eaf5ff', fontWeight: 600 }}>{c.before} → {c.after} séries</span>
              </div>
            ))}
            {addedExerciseNames.map((name, i) => (
              <div key={`added-${i}`} className="tr-recap-ex" style={{ margin: 0 }}>
                <span style={{ color: '#4ade80' }}>+ {name}</span> <span style={{ color: '#7fa3c2' }}>ajouté</span>
              </div>
            ))}
            {removedExerciseNames.map((name, i) => (
              <div key={`removed-${i}`} className="tr-recap-ex" style={{ margin: 0 }}>
                <span style={{ color: '#ff6b6b' }}>− {name}</span> <span style={{ color: '#7fa3c2' }}>supprimé</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: '#7fa3c2', marginTop: 14, maxWidth: 560 }}>
            Cette séance a été enregistrée avec ces changements. Veux-tu aussi les garder comme modèle par défaut pour la prochaine fois ?
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 22, maxWidth: 560 }}>
            <button className="tr-finish" style={{ width: 'auto', flex: 1 }} onClick={async () => { await applyTemplateChanges(); backToSelect(); }}>OUI, METTRE À JOUR</button>
            <button className="tr-navbtn" style={{ flex: 1 }} onClick={backToSelect}>NON, JUSTE CETTE FOIS</button>
          </div>
        </div>
      )}

      {pickerMode != null && (
        <div className="tr-picker-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(2,6,12,.72)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={closePicker}>
          <div className="tr-recap tr-picker-modal" style={{ margin: 0, maxWidth: 560, width: '100%', maxHeight: '80vh', overflowY: 'auto', background: '#08111f', border: '1px solid var(--line)', borderRadius: 10, padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="hdg" style={{ fontSize: 18, color: '#eaf5ff' }}>{pickerMode === 'add' ? 'Ajouter un exercice' : 'Remplacer un exercice'}</div>
              <button className="tr-icon-btn" onClick={closePicker}>✕</button>
            </div>
            {!pickerCategory && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
                {CATEGORIES.map((c) => (
                  <button key={c.id} className="tr-navbtn" style={{ flex: '0 0 auto', padding: '0 16px' }} onClick={() => pickCategory(c.id)}>{c.label}</button>
                ))}
              </div>
            )}
            {pickerCategory && (
              <div style={{ marginTop: 16 }}>
                <button className="tr-navbtn" style={{ marginBottom: 12 }} onClick={() => { setPickerCategory(null); setPickerList([]); }}>‹ Groupes musculaires</button>
                {pickerLoading && <div style={{ fontSize: 12, color: '#5a7893' }}>Chargement…</div>}
                {pickerError && <div className="tr-note">{pickerError}</div>}
                {!pickerLoading && !pickerError && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {pickerList.map((item) => (
                      <div key={item.id} className="tr-setrow tr-picker-item" style={{ cursor: 'pointer' }} onClick={() => applyPicked(item)}>
                        <span style={{ color: '#eaf5ff', fontFamily: "'Chakra Petch',sans-serif" }}>{item.name}</span>
                        {item.equipment.length > 0 && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#7fa3c2' }}>{item.equipment.join(', ')}</span>}
                      </div>
                    ))}
                    {pickerList.length === 0 && <div style={{ fontSize: 12, color: '#5a7893' }}>Aucun exercice trouvé.</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {screen === 'analyse' && (
        <div className="tr-an-wrap">
          <div className="tr-cal-head">
            <div>
              <div className="eyebrow">ORACLE // ANALYSE D'ENTRAÎNEMENT</div>
              <h1 className="hdg">Suivi & progression</h1>
            </div>
          </div>

          {loadingHistory && <div style={{ marginTop: 20, fontSize: 12, color: '#5a7893' }}>Chargement de l'historique…</div>}
          {!loadingHistory && history.length === 0 && (
            <div style={{ marginTop: 20, fontSize: 12, color: '#7fa3c2', lineHeight: 1.7 }}>
              Aucune séance enregistrée pour le moment — termine une première séance pour alimenter l'analyse.
            </div>
          )}

          {history.length > 0 && (
            <>
              <div className="tr-an-stats">
                <div className="tr-meta-card"><div className="lbl">SÉANCES · 30 J</div><div className="val hdg">{ov.n30}</div></div>
                <div className="tr-meta-card"><div className="lbl">VOLUME · 30 J</div><div className="val hdg">{(ov.vol30 / 1000).toFixed(1)} t</div></div>
                <div className="tr-meta-card"><div className="lbl">ÉQUILIBRE U / L</div><div className="val hdg">{ov.up30} / {ov.low30}</div></div>
                <div className="tr-meta-card"><div className="lbl">DERNIÈRE SÉANCE</div><div className="val hdg">{ov.daysSince == null ? '—' : ov.daysSince === 0 ? "AUJOURD'HUI" : `IL Y A ${ov.daysSince} J`}</div></div>
              </div>

              <div className="tr-an-panel">
                <div className="lbl">VOLUME HEBDOMADAIRE · 8 SEMAINES</div>
                <div className="tr-an-bars">
                  {(() => {
                    const maxVol = Math.max(1, ...ov.weeks.map((w) => w.upper + w.lower + w.autres));
                    return ov.weeks.map((w) => {
                      const tot = w.upper + w.lower + w.autres;
                      return (
                        <div key={w.key} className="col">
                          <div className="vol">{tot ? `${(tot / 1000).toFixed(1)}t` : ''}</div>
                          <div className="stack">
                            {w.autres > 0 && <div style={{ height: `${(w.autres / maxVol) * 100}%`, background: '#9fc0dc' }} />}
                            {w.lower > 0 && <div style={{ height: `${(w.lower / maxVol) * 100}%`, background: '#5de1ff' }} />}
                            {w.upper > 0 && <div style={{ height: `${(w.upper / maxVol) * 100}%`, background: '#4db8ff' }} />}
                          </div>
                          <div className="wl">{w.label}</div>
                        </div>
                      );
                    });
                  })()}
                </div>
                <div className="tr-legend" style={{ marginTop: 14 }}>
                  <span><span className="sw" style={{ background: '#4db8ff' }} />UPPER</span>
                  <span><span className="sw" style={{ background: '#5de1ff' }} />LOWER</span>
                </div>
              </div>

              {ov.prs.length > 0 && (
                <div className="tr-an-panel">
                  <div className="lbl">RECORDS RÉCENTS · e1RM ESTIMÉ</div>
                  <div className="tr-an-prs">
                    {ov.prs.map((p, i) => (
                      <div key={i} className="pr">
                        <span className="star">★</span>
                        <span className="nm hdg">{p.name}</span>
                        <span className="val">{p.e1rm} kg e1RM</span>
                        <span className="dt">{new Date(p.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="tr-an-panel">
                <div className="lbl">PROGRESSION PAR EXERCICE · e1RM ESTIMÉ (EPLEY)</div>
                <div className="tr-an-list">
                  {anExercises.map((exr) => {
                    const es = exr.entries;
                    const last = es[es.length - 1];
                    const prev = es[es.length - 2];
                    const best = es.reduce((a, e) => Math.max(a, e.bestE1RM), 0);
                    const d = prev ? last.bestE1RM - prev.bestE1RM : 0;
                    const dCol = d > 0 ? '#4ade80' : d < 0 ? '#ff6b6b' : '#7fa3c2';
                    const spark = es.slice(-6).map((e) => e.bestE1RM);
                    const pts = spark.length > 1 ? sparkPoints(spark, 90, 26, 3) : null;
                    const open = anOpen === exr.key;
                    return (
                      <div key={exr.key} className="tr-an-ex" onClick={() => setAnOpen(open ? null : exr.key)}>
                        <div className="row">
                          <div className="nm hdg">{exr.name}</div>
                          {pts && (
                            <svg width="90" height="26" style={{ flex: '0 0 auto' }}>
                              <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#4db8ff" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
                              <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="2.5" fill="#5de1ff" />
                            </svg>
                          )}
                          <div className="e1rm hdg">{last.bestE1RM} <span>KG e1RM</span></div>
                          <div className="delta" style={{ color: dCol }}>{d > 0 ? `▲ +${d}` : d < 0 ? `▼ ${d}` : '='}</div>
                          <div className="star">{es.length > 1 && last.bestE1RM >= best ? '★' : ''}</div>
                        </div>
                        {open && (
                          <div className="hist">
                            {[...es].reverse().slice(0, 6).map((e, i) => (
                              <div key={i} className="hrow">
                                <span className="dt">{new Date(e.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</span>
                                <span className="sets">{e.sets.map((s) => `${s.weight}×${s.reps}`).join(' · ')}</span>
                                <span className="v">{e.bestE1RM} e1RM · {e.volume.toLocaleString('fr-FR')} kg vol</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {screen === 'calendar' && (
        <div className="tr-cal-wrap">
          <div className="tr-cal-head">
            <div>
              <div className="eyebrow">ORACLE // JOURNAL D'ENTRAÎNEMENT</div>
              <h1 className="hdg">{monthLabel}</h1>
            </div>
            <div className="tr-cal-stats">
              <div className="stat"><b>{monthCount}</b><span>SÉANCES</span></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="tr-icon-btn" onClick={() => { let m = calM - 1, y = calY; if (m < 0) { m = 11; y--; } setCalM(m); setCalY(y); }}>‹</button>
                <button className="tr-icon-btn" onClick={() => { let m = calM + 1, y = calY; if (m > 11) { m = 0; y++; } setCalM(m); setCalY(y); }}>›</button>
              </div>
            </div>
          </div>
          {loadingHistory && <div style={{ marginTop: 20, fontSize: 12, color: '#5a7893' }}>Chargement de l'historique…</div>}
          <div className="tr-cal-grid">
            {DOW.map((d) => <div key={d} className="tr-cal-dow">{d}</div>)}
            {cells.map((c, i) => {
              if (!c) return <div key={i} className="tr-cal-cell" />;
              const log = c.log;
              const up = log && log.session_key === 'upper';
              const col = up ? '#4db8ff' : '#5de1ff';
              return (
                <div key={i} className={`tr-cal-cell${log ? ' has' : ''}`}
                  style={{ background: log ? (up ? 'rgba(77,184,255,.14)' : 'rgba(93,225,255,.12)') : 'rgba(10,25,45,.22)', borderColor: log ? (up ? 'rgba(77,184,255,.5)' : 'rgba(93,225,255,.5)') : 'rgba(120,190,255,.07)' }}
                  onClick={() => log && openRecap(log)}>
                  <span className="day" style={{ color: log ? '#eaf5ff' : '#4a6478' }}>{c.d}</span>
                  {log && <><span className="tp" style={{ color: col }}>{sessionName(templates, log.session_key)}</span><span className="bar" style={{ background: col }} /></>}
                </div>
              );
            })}
          </div>
          <div className="tr-legend">
            <span><span className="sw" style={{ background: 'rgba(77,184,255,.4)', border: '1px solid #4db8ff' }} />UPPER</span>
            <span><span className="sw" style={{ background: 'rgba(93,225,255,.35)', border: '1px solid #5de1ff' }} />LOWER</span>
          </div>
        </div>
      )}

      {screen === 'recap' && recapLog && (
        <RecapView log={recapLog} templates={templates} history={history} onBack={() => setScreen('calendar')} />
      )}
    </div>
  );
}

function ExerciseDetail({ exId, pos, ex, ctx, setIds, checks, weights, repsOverride, rpeSel, onToggleSet, onSetWeight, onStepWeight, onSetReps, onStepReps, onSetRpe, onAddSet, onRemoveSet, onRemoveExercise, canRemoveExercise, onAddExercise, hasPrev, hasNext, onPrev, onNext, onReplace }) {
  const delta = ctx.delta;
  const dCol = delta > 0 ? '#4ade80' : delta < 0 ? '#ff6b6b' : '#7fa3c2';
  const dArrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '=';
  const dLabel = delta > 0 ? `+${delta} kg e1RM` : delta < 0 ? `${delta} kg e1RM` : 'stable';
  const spBig = sparkPoints(ctx.spark, 480, 90, 10);
  const last = spBig[spBig.length - 1];
  const area = spBig.map((p) => `${p.x},${p.y}`).join(' ') + ` ${last.x},90 ${spBig[0].x},90`;

  return (
    <div className="tr-detail">
      <div className="tr-detail-head">
        <div>
          <div className="num">{String(pos + 1).padStart(2, '0')} · EN COURS</div>
          <div className="exname hdg">{ex.name}</div>
          <div className="note">{ex.note}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="tr-navbtn" style={{ padding: '4px 12px', height: 30, display: 'inline-flex' }} onClick={onReplace}>⇄ Remplacer</button>
            <button className="tr-navbtn tr-navbtn-danger" style={{ padding: '4px 12px', height: 30, display: 'inline-flex' }} disabled={!canRemoveExercise} onClick={onRemoveExercise}>✕ Supprimer</button>
          </div>
        </div>
        <div className="tr-delta" style={{ color: dCol }}>{dArrow} {dLabel}</div>
      </div>

      <div className="tr-meta-grid">
        <div className="tr-meta-card"><div className="lbl">CIBLE</div><div className="val hdg">{ex.target}</div></div>
        <div className="tr-meta-card"><div className="lbl">PRÉCÉDENT</div><div className="val hdg">{ctx.prevWeight} kg</div></div>
        <div className="tr-meta-card"><div className="lbl">RECORD</div><div className="val hdg" style={{ color: '#5de1ff' }}>{ctx.bestWeight || ex.pr || 0} kg</div></div>
        <div className="tr-meta-card"><div className="lbl">REPOS</div><div className="val hdg">{fmtTime(ex.rest)}</div></div>
      </div>

      {ctx.lastSets && (
        <div className="tr-lastsets">
          <span className="lbl">DERNIÈRE FOIS · {new Date(ctx.lastDate + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</span>
          <span className="vals">{ctx.lastSets.map((s) => `${s.weight}×${s.reps}`).join(' · ')}</span>
          {ctx.bestE1RM && <span className="e1rm">e1RM max {ctx.bestE1RM} kg</span>}
        </div>
      )}

      <div className="tr-graph">
        <div className="lbl">PROGRESSION · e1RM ESTIMÉ</div>
        <svg viewBox="0 0 480 90" width="100%" height="80" preserveAspectRatio="none" style={{ marginTop: 8, overflow: 'hidden' }}>
          <polyline points={area} fill="rgba(77,184,255,.08)" stroke="none" />
          <polyline points={spBig.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#4db8ff" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={last.x} cy={last.y} r="4" fill="#5de1ff" />
        </svg>
      </div>

      <div className="tr-sets">
        {setIds.map((id, idx) => {
          const key = `${exId}_${id}`;
          const checked = !!checks[key];
          const weight = weights[key] != null ? weights[key] : String(ctx.defaultWeight);
          const baseReps = ex.reps[id] ?? 10;
          const repsVal = repsOverride[key] != null ? repsOverride[key] : String(baseReps);
          return (
            <div key={id} className={`tr-setrow${checked ? ' done' : ''}`}>
              <span className="lbl">SÉRIE {idx + 1}</span>
              <div className="tr-reps-ctl">
                <button onClick={() => onStepReps(key, baseReps, -1)}>−</button>
                <input value={repsVal} onChange={(e) => onSetReps(key, e.target.value)} />
                <button onClick={() => onStepReps(key, baseReps, 1)}>+</button>
                <span className="unit">rép</span>
              </div>
              <div className="tr-weight-ctl">
                <button onClick={() => onStepWeight(key, -2.5)}>−</button>
                <input value={weight} onChange={(e) => onSetWeight(key, e.target.value)} />
                <button onClick={() => onStepWeight(key, 2.5)}>+</button>
                <span className="kg">kg</span>
              </div>
              <button className={`tr-check${checked ? ' done' : ''}`} onClick={() => onToggleSet(exId, id, ex.rest)}>{checked ? '✓' : ''}</button>
              <button className="tr-set-remove" title="Supprimer cette série" disabled={setIds.length <= 1} onClick={() => onRemoveSet(exId, id)}>✕</button>
            </div>
          );
        })}
        <button className="tr-set-add" onClick={() => onAddSet(exId)}>+ AJOUTER UNE SÉRIE</button>
      </div>

      <div className="tr-rpe-row">
        <span className="lbl">RESSENTI · RPE</span>
        {[6, 7, 8, 9, 10].map((n) => (
          <button key={n} className={`tr-rpe-opt${rpeSel === n ? ' sel' : ''}`} onClick={() => onSetRpe(n)}>{n}</button>
        ))}
      </div>

      <div className="tr-navrow">
        <button className="tr-navbtn" disabled={!hasPrev} onClick={onPrev}>‹ PRÉC.</button>
        <button className="tr-navbtn" onClick={onAddExercise}>+ EXERCICE</button>
        <button className="tr-navbtn" disabled={!hasNext} onClick={onNext}>SUIV. ›</button>
      </div>
    </div>
  );
}

function RecapView({ log, templates, history, onBack }) {
  const meta = templates[log.session_key]?.meta || { name: sessionName(templates, log.session_key), sub: '' };
  const dd = new Date(log.performed_on);
  const dateLabel = dd.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
  const accent = log.session_key === 'upper' ? '#4db8ff' : '#5de1ff';
  const exercises = log.data?.exercises || [];
  const exStats = recapStats(log, history);
  const setCount = exercises.reduce((a, e) => a + (e.sets?.length || 0), 0);
  const vol = exercises.reduce((a, e) => a + (e.sets || []).reduce((aa, s) => aa + s.weight * s.reps, 0), 0);
  const nPRs = exStats.filter((s) => s.isPR).length;

  return (
    <div className="tr-recap">
      <div className="tr-recap-head">
        <div>
          <div className="dt" style={{ color: accent }}>{dateLabel}</div>
          <div className="nm hdg">{meta.name}{meta.sub && <span style={{ fontSize: 13, color: '#5a7893', fontWeight: 400 }}> · {meta.sub}</span>}</div>
        </div>
        <div className="tr-recap-stats">
          <div className="stat"><b>{exercises.length}</b><span>EXOS</span></div>
          <div className="stat"><b>{setCount}</b><span>SÉRIES</span></div>
          <div className="stat"><b style={{ color: '#5de1ff' }}>{vol.toLocaleString('fr-FR')} kg</b><span>VOLUME</span></div>
          {log.overall_rpe && <div className="stat"><b>{log.overall_rpe}</b><span>RPE</span></div>}
          {nPRs > 0 && <div className="stat"><b style={{ color: '#ffc266' }}>★ {nPRs}</b><span>RECORD{nPRs > 1 ? 'S' : ''}</span></div>}
        </div>
      </div>
      {exercises.map((ex, i) => (
        <div key={i} className="tr-recap-ex">
          <div className="top">
            <div className="nm">{String(i + 1).padStart(2, '0')} {ex.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {exStats[i]?.isPR && <span className="prbadge">★ RECORD</span>}
              {exStats[i]?.bestE1RM > 0 && <span className="e1rmv">{exStats[i].bestE1RM} kg e1RM</span>}
              {ex.rpe && <span style={{ fontSize: 11, color: accent }}>RPE {ex.rpe}</span>}
            </div>
          </div>
          <div className="sets">
            {(ex.sets || []).map((s, si) => (
              <div key={si} className="setpill"><span style={{ color: '#5a7893' }}>S{si + 1}</span><span style={{ fontFamily: "'Chakra Petch',sans-serif" }}>{s.weight} kg</span><span style={{ color: '#7fa3c2' }}>× {s.reps}</span></div>
            ))}
          </div>
        </div>
      ))}
      <button className="tr-navbtn" style={{ marginTop: 20 }} onClick={onBack}>‹ RETOUR AU CALENDRIER</button>
    </div>
  );
}
