import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { SESSIONS } from '../data/sessions.js';
import { supabase, supabaseReady } from '../lib/supabase.js';
import { fmtTime, buildExerciseContext, sparkPoints } from '../lib/trainingStats.js';
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
  const [rpe, setRpe] = useState({});
  const [active, setActive] = useState(0);
  const [timer, setTimer] = useState(0);
  const [timerTotal, setTimerTotal] = useState(0);
  const [saving, setSaving] = useState(false);
  const [sessionDate, setSessionDate] = useState(todayISO()); // modifiable pour saisir une séance a posteriori
  const [swaps, setSwaps] = useState({}); // { [ei]: { name, note, wgerId } } — remplacements pour la séance en cours

  const [pickerEi, setPickerEi] = useState(null);
  const [pickerCategory, setPickerCategory] = useState(null);
  const [pickerList, setPickerList] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState(null);

  const [calY, setCalY] = useState(() => new Date().getFullYear());
  const [calM, setCalM] = useState(() => new Date().getMonth());
  const [recapLog, setRecapLog] = useState(null);

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
  const exercises = useMemo(
    () => (sess ? sess.exercises.map((ex, ei) => (swaps[ei] ? { ...ex, name: swaps[ei].name, note: swaps[ei].note, wgerId: swaps[ei].wgerId } : ex)) : []),
    [sess, swaps],
  );
  const exCtx = useMemo(() => (sess ? buildExerciseContext(history, sessionKey, exercises) : []), [sess, sessionKey, history, exercises]);

  function selectSession(key) {
    const s = templates[key];
    const ctx = buildExerciseContext(history, key, s.exercises);
    const w = {}; const r = {};
    s.exercises.forEach((ex, ei) => ex.reps.forEach((baseReps, si) => { w[`${ei}_${si}`] = String(ctx[ei].defaultWeight); r[`${ei}_${si}`] = String(baseReps); }));
    setSessionKey(key); setWeights(w); setRepsOverride(r); setChecks({}); setRpe({}); setActive(0); setTimer(0); setTimerTotal(0); setSwaps({});
    setSessionDate(todayISO());
    setScreen('module');
  }

  function backToSelect() { setScreen('select'); setSessionKey(null); setTimer(0); setSwaps({}); }

  function openPicker(ei) { setPickerEi(ei); setPickerCategory(null); setPickerList([]); setPickerError(null); }
  function closePicker() { setPickerEi(null); setPickerCategory(null); setPickerList([]); }

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

  function applySwap(item) {
    const equip = item.equipment.length ? ` · ${item.equipment.join(', ')}` : '';
    setSwaps((s) => ({ ...s, [pickerEi]: { name: item.name, note: `Remplacé via wger${equip}`, wgerId: item.id } }));
    closePicker();
  }

  async function applyTemplateSwaps() {
    const updated = sess.exercises.map((ex, ei) => (swaps[ei] ? { ...ex, name: swaps[ei].name, note: swaps[ei].note, wgerId: swaps[ei].wgerId } : ex));
    if (supabaseReady) {
      await supabase.from('session_templates').update({ exercises: updated, updated_at: new Date().toISOString() }).eq('key', sessionKey);
    }
    setTemplates((t) => ({ ...t, [sessionKey]: { ...t[sessionKey], exercises: updated } }));
  }

  function toggleSet(ei, si, rest) {
    const key = `${ei}_${si}`;
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
  function toggleRpe(ei, n) { setRpe((r) => ({ ...r, [ei]: r[ei] === n ? null : n })); }

  let doneSets = 0, totalSets = 0;
  if (sess) exercises.forEach((ex, ei) => ex.reps.forEach((_, si) => { totalSets++; if (checks[`${ei}_${si}`]) doneSets++; }));
  const pct = totalSets ? Math.round((doneSets / totalSets) * 100) : 0;

  async function finishSession() {
    if (!sess) return;
    const rpeVals = Object.values(rpe).filter((v) => v != null);
    const overall = rpeVals.length ? Math.round(rpeVals.reduce((a, b) => a + b, 0) / rpeVals.length) : null;
    const data = {
      exercises: exercises.map((ex, ei) => ({
        name: ex.name, note: ex.note, target: ex.target, rpe: rpe[ei] || null,
        sets: ex.reps.map((baseReps, si) => {
          const k = `${ei}_${si}`;
          return { reps: parseInt(repsOverride[k], 10) || baseReps, weight: Number(weights[k]) || 0, checked: !!checks[k] };
        }),
      })),
    };
    if (supabaseReady) {
      setSaving(true);
      const { data: inserted, error } = await supabase.from('workout_logs')
        .insert({ session_key: sessionKey, performed_on: sessionDate || todayISO(), overall_rpe: overall, data })
        .select();
      setSaving(false);
      if (!error && inserted) setHistory((h) => [inserted[0], ...h]);
    }
    if (Object.keys(swaps).length > 0) setScreen('confirmSwap');
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
        {screen !== 'calendar' && screen !== 'recap' && (
          <button className="tr-icon-btn" title="Historique" onClick={() => setScreen('calendar')}>▦</button>
        )}
        {(screen === 'calendar' || screen === 'recap') && (
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
            {exercises.map((ex, ei) => {
              const setCount = ex.reps.length;
              const d = ex.reps.filter((_, si) => checks[`${ei}_${si}`]).length;
              const complete = d === setCount;
              return (
                <div key={ei} className="tr-strip-item" onClick={() => setActive(ei)} style={{ background: active === ei ? 'rgba(77,184,255,.12)' : 'transparent', borderColor: active === ei ? 'rgba(120,190,255,.5)' : 'var(--line)' }}>
                  <span style={{ color: active === ei ? '#eaf5ff' : '#9fc0dc' }}>{String(ei + 1).padStart(2, '0')}</span>
                  <span className="dot" style={{ background: complete ? '#4ade80' : (d > 0 ? '#4db8ff' : '#2c4258') }} />
                </div>
              );
            })}
          </div>

          <div className="tr-body">
            <div className="tr-rail">
              {exercises.map((ex, ei) => {
                const setCount = ex.reps.length;
                const d = ex.reps.filter((_, si) => checks[`${ei}_${si}`]).length;
                const complete = d === setCount;
                const delta = exCtx[ei].delta;
                const dCol = delta > 0 ? '#4ade80' : delta < 0 ? '#ff6b6b' : '#7fa3c2';
                const dArrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '=';
                return (
                  <div key={ei} className={`tr-rail-item${active === ei ? ' active' : ''}`} onClick={() => setActive(ei)}>
                    <div className="top"><span>{String(ei + 1).padStart(2, '0')}</span><span style={{ color: dCol }}>{dArrow} {delta ? `${delta > 0 ? '+' : ''}${delta} kg` : ''}</span></div>
                    <div className="nm">{ex.name}</div>
                    <div className="prog">
                      <div className="track"><div style={{ width: `${Math.round((d / setCount) * 100)}%`, background: complete ? 'linear-gradient(90deg,#4ade80,#5de1ff)' : 'linear-gradient(90deg,#3a7bff,#5de1ff)' }} /></div>
                      <span>{d}/{setCount}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <ExerciseDetail
              ei={active} ex={exercises[active]} ctx={exCtx[active]}
              checks={checks} weights={weights} repsOverride={repsOverride} rpeSel={rpe[active]}
              onToggleSet={toggleSet} onSetWeight={setWeight} onStepWeight={stepWeight}
              onSetReps={setRepCount} onStepReps={stepRepCount} onSetRpe={(n) => toggleRpe(active, n)}
              hasPrev={active > 0} hasNext={active < exercises.length - 1}
              onPrev={() => setActive((a) => Math.max(0, a - 1))} onNext={() => setActive((a) => Math.min(exercises.length - 1, a + 1))}
              onReplace={() => openPicker(active)}
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
            {Object.entries(swaps).map(([ei, s]) => (
              <div key={ei} className="tr-recap-ex" style={{ margin: 0 }}>
                <span style={{ color: '#5a7893' }}>{sess.exercises[ei].name}</span> → <span style={{ color: '#eaf5ff', fontWeight: 600 }}>{s.name}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: '#7fa3c2', marginTop: 14, maxWidth: 560 }}>
            Cette séance a été enregistrée avec ces remplacements. Veux-tu aussi les garder comme modèle par défaut pour la prochaine fois ?
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 22, maxWidth: 560 }}>
            <button className="tr-finish" style={{ width: 'auto', flex: 1 }} onClick={async () => { await applyTemplateSwaps(); backToSelect(); }}>OUI, METTRE À JOUR</button>
            <button className="tr-navbtn" style={{ flex: 1 }} onClick={backToSelect}>NON, JUSTE CETTE FOIS</button>
          </div>
        </div>
      )}

      {pickerEi != null && (
        <div className="tr-picker-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(2,6,12,.72)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={closePicker}>
          <div className="tr-recap tr-picker-modal" style={{ margin: 0, maxWidth: 560, width: '100%', maxHeight: '80vh', overflowY: 'auto', background: '#08111f', border: '1px solid var(--line)', borderRadius: 10, padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="hdg" style={{ fontSize: 18, color: '#eaf5ff' }}>Remplacer un exercice</div>
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
                      <div key={item.id} className="tr-setrow tr-picker-item" style={{ cursor: 'pointer' }} onClick={() => applySwap(item)}>
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
        <RecapView log={recapLog} templates={templates} onBack={() => setScreen('calendar')} />
      )}
    </div>
  );
}

function ExerciseDetail({ ei, ex, ctx, checks, weights, repsOverride, rpeSel, onToggleSet, onSetWeight, onStepWeight, onSetReps, onStepReps, onSetRpe, hasPrev, hasNext, onPrev, onNext, onReplace }) {
  const delta = ctx.delta;
  const dCol = delta > 0 ? '#4ade80' : delta < 0 ? '#ff6b6b' : '#7fa3c2';
  const dArrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '=';
  const dLabel = delta > 0 ? `+${delta} kg` : delta < 0 ? `${delta} kg` : 'stable';
  const spBig = sparkPoints(ctx.spark, 480, 90, 10);
  const last = spBig[spBig.length - 1];
  const area = spBig.map((p) => `${p.x},${p.y}`).join(' ') + ` ${last.x},90 ${spBig[0].x},90`;

  return (
    <div className="tr-detail">
      <div className="tr-detail-head">
        <div>
          <div className="num">{String(ei + 1).padStart(2, '0')} · EN COURS</div>
          <div className="exname hdg">{ex.name}</div>
          <div className="note">{ex.note}</div>
          <button className="tr-navbtn" style={{ marginTop: 10, padding: '4px 12px', height: 30, display: 'inline-flex' }} onClick={onReplace}>⇄ Remplacer</button>
        </div>
        <div className="tr-delta" style={{ color: dCol }}>{dArrow} {dLabel}</div>
      </div>

      <div className="tr-meta-grid">
        <div className="tr-meta-card"><div className="lbl">CIBLE</div><div className="val hdg">{ex.target}</div></div>
        <div className="tr-meta-card"><div className="lbl">PRÉCÉDENT</div><div className="val hdg">{ctx.prevWeight} kg</div></div>
        <div className="tr-meta-card"><div className="lbl">RECORD</div><div className="val hdg" style={{ color: '#5de1ff' }}>{ex.pr} kg</div></div>
        <div className="tr-meta-card"><div className="lbl">REPOS</div><div className="val hdg">{fmtTime(ex.rest)}</div></div>
      </div>

      <div className="tr-graph">
        <div className="lbl">PROGRESSION</div>
        <svg viewBox="0 0 480 90" width="100%" height="80" preserveAspectRatio="none" style={{ marginTop: 8, overflow: 'hidden' }}>
          <polyline points={area} fill="rgba(77,184,255,.08)" stroke="none" />
          <polyline points={spBig.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#4db8ff" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={last.x} cy={last.y} r="4" fill="#5de1ff" />
        </svg>
      </div>

      <div className="tr-sets">
        {ex.reps.map((baseReps, si) => {
          const key = `${ei}_${si}`;
          const checked = !!checks[key];
          const weight = weights[key] != null ? weights[key] : String(ctx.defaultWeight);
          const repsVal = repsOverride[key] != null ? repsOverride[key] : String(baseReps);
          return (
            <div key={si} className={`tr-setrow${checked ? ' done' : ''}`}>
              <span className="lbl">SÉRIE {si + 1}</span>
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
              <button className={`tr-check${checked ? ' done' : ''}`} onClick={() => onToggleSet(ei, si, ex.rest)}>{checked ? '✓' : ''}</button>
            </div>
          );
        })}
      </div>

      <div className="tr-rpe-row">
        <span className="lbl">RESSENTI · RPE</span>
        {[6, 7, 8, 9, 10].map((n) => (
          <button key={n} className={`tr-rpe-opt${rpeSel === n ? ' sel' : ''}`} onClick={() => onSetRpe(n)}>{n}</button>
        ))}
      </div>

      <div className="tr-navrow">
        <button className="tr-navbtn" disabled={!hasPrev} onClick={onPrev}>‹ PRÉC.</button>
        <button className="tr-navbtn" disabled={!hasNext} onClick={onNext}>SUIV. ›</button>
      </div>
    </div>
  );
}

function RecapView({ log, templates, onBack }) {
  const meta = templates[log.session_key]?.meta || { name: sessionName(templates, log.session_key), sub: '' };
  const dd = new Date(log.performed_on);
  const dateLabel = dd.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
  const accent = log.session_key === 'upper' ? '#4db8ff' : '#5de1ff';
  const exercises = log.data?.exercises || [];
  const setCount = exercises.reduce((a, e) => a + (e.sets?.length || 0), 0);
  const vol = exercises.reduce((a, e) => a + (e.sets || []).reduce((aa, s) => aa + s.weight * s.reps, 0), 0);

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
        </div>
      </div>
      {exercises.map((ex, i) => (
        <div key={i} className="tr-recap-ex">
          <div className="top">
            <div className="nm">{String(i + 1).padStart(2, '0')} {ex.name}</div>
            {ex.rpe && <span style={{ fontSize: 11, color: accent }}>RPE {ex.rpe}</span>}
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
