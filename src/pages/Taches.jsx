import { useEffect, useState } from 'react';
import { fetchTasks, createTask, updateTaskStatus, updateTaskSubs } from '../lib/tasks.js';
import { useCoreClose } from '../lib/coreTransition.js';
import './Taches.css';

const PRI = {
  p1: { label: 'P1 · CRITIQUE', col: '#ff5a6e', bord: 'rgba(255,90,110,.45)', badgeBg: 'rgba(255,90,110,.12)', glow: 'rgba(255,90,110,.16)' },
  p2: { label: 'P2 · HAUTE', col: '#ffc266', bord: 'rgba(255,194,102,.4)', badgeBg: 'rgba(255,194,102,.1)', glow: 'rgba(255,194,102,.13)' },
  p3: { label: 'P3 · NORMALE', col: '#4db8ff', bord: 'rgba(77,184,255,.4)', badgeBg: 'rgba(77,184,255,.1)', glow: 'rgba(77,184,255,.13)' },
};
const PRI_ORDER = { p1: 0, p2: 1, p3: 2 };
const DOW = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'];
const CIRC = 2 * Math.PI * 54;

function dueInfo(dueAt) {
  if (!dueAt) return { label: 'SANS ÉCHÉANCE', hot: false, tminus: '—' };
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return { label: 'SANS ÉCHÉANCE', hot: false, tminus: '—' };
  const now = new Date();
  const diffMs = d - now;
  const diffH = diffMs / 3600000;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  let label;
  if (sameDay) label = `AUJ · ${hh}:${mm}`;
  else if (isTomorrow) label = `DEM · ${hh}:${mm}`;
  else if (diffMs > 0 && diffMs < 7 * 86400000) label = `${DOW[d.getDay()]} · ${hh}:${mm}`;
  else label = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }).toUpperCase();
  const hot = diffMs > 0 && diffH <= 24;
  let tminus;
  if (diffMs <= 0) tminus = 'ÉCHU';
  else if (diffH < 24) tminus = `T-${Math.ceil(diffH)}H`;
  else tminus = `T-${Math.ceil(diffH / 24)}J`;
  return { label, hot, tminus };
}

function pct(task) {
  if (!task.subs || !task.subs.length) return task.status === 'clos' ? 100 : 0;
  return Math.round((100 * task.subs.filter((s) => s.done).length) / task.subs.length);
}

// Formulaire de création complet (priorité, catégorie, échéance, note) — replié par
// défaut derrière un bouton "+ NOUVELLE TÂCHE", pour rester discret dans les 3 endroits
// où il apparaît (état vide, colonne file d'attente desktop, liste mobile).
function TaskForm({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('p3');
  const [category, setCategory] = useState('');
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  function reset() {
    setTitle(''); setPriority('p3'); setCategory(''); setDue(''); setNote(''); setFormError(null); setOpen(false);
  }

  async function submit(e) {
    e.preventDefault();
    const t = title.trim();
    if (!t || saving) return;
    setSaving(true);
    setFormError(null);
    const { data, error } = await createTask({
      title: t,
      priority,
      category: category.trim() ? category.trim().toUpperCase() : null,
      dueAt: due ? new Date(due).toISOString() : null,
      note: note.trim() || null,
    });
    setSaving(false);
    if (data) { onCreated(data); reset(); } else { setFormError(error || 'Échec de la création'); }
  }

  if (!open) {
    return <button type="button" className="tk-quickadd-toggle" onClick={() => setOpen(true)}>+ NOUVELLE TÂCHE</button>;
  }

  return (
    <form onSubmit={submit} className="tk-taskform">
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Intitulé de la tâche" />
      <div className="tk-taskform-row">
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="p1">P1 · Critique</option>
          <option value="p2">P2 · Haute</option>
          <option value="p3">P3 · Normale</option>
        </select>
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Catégorie" />
      </div>
      <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note / synthèse (optionnel)" rows={2} />
      {formError && <div className="tk-taskform-error">{formError}</div>}
      <div className="tk-taskform-actions">
        <button type="button" className="tk-btn" onClick={reset}>ANNULER</button>
        <button type="submit" className="tk-btn good" disabled={saving}>{saving ? '…' : '+ AJOUTER'}</button>
      </div>
    </form>
  );
}

export default function Taches() {
  const { closing, goHome } = useCoreClose();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [curId, setCurId] = useState(null);
  const [sheetId, setSheetId] = useState(null);

  useEffect(() => {
    fetchTasks().then((data) => { setTasks(data); setLoading(false); });
  }, []);

  function patchTask(id, patch) {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function toggleSub(task, i) {
    const subs = task.subs.map((s, idx) => (idx === i ? { ...s, done: !s.done } : s));
    patchTask(task.id, { subs });
    updateTaskSubs(task.id, subs);
  }

  function closeTask(id) {
    const t = tasks.find((x) => x.id === id); if (!t) return;
    const subs = t.subs.map((s) => ({ ...s, done: true }));
    patchTask(id, { status: 'clos', subs });
    updateTaskStatus(id, 'clos'); updateTaskSubs(id, subs);
  }

  function onTaskCreated(created) {
    setTasks((ts) => [...ts, created]);
  }

  const active = [...tasks].filter((t) => t.status !== 'clos').sort((a, b) => {
    const p = PRI_ORDER[a.priority] - PRI_ORDER[b.priority];
    if (p) return p;
    return new Date(a.due_at || 8.64e15) - new Date(b.due_at || 8.64e15);
  });
  const done = tasks.filter((t) => t.status === 'clos');
  const cur = active.find((t) => t.id === curId) || active[0] || null;
  const queue = active.filter((t) => !cur || t.id !== cur.id);
  const nP1 = active.filter((t) => t.priority === 'p1').length;
  const nP2 = active.filter((t) => t.priority === 'p2').length;
  const nP3 = active.filter((t) => t.priority === 'p3').length;
  const sheetTask = sheetId ? active.find((t) => t.id === sheetId) : null;

  function SubRow({ task, s, i, big }) {
    return (
      <div className="tk-subrow" onClick={() => toggleSub(task, i)} style={{ padding: big ? '10px 11px' : '8px 10px', fontSize: big ? 12 : 10.5 }}>
        <span className="box" style={{ width: big ? 16 : 13, height: big ? 16 : 13, borderColor: s.done ? '#66e6a0' : 'rgba(120,190,255,.35)', background: s.done ? '#66e6a0' : 'transparent' }}>{s.done ? '✓' : ''}</span>
        <span style={{ color: s.done ? '#5a7893' : '#c3dbef', textDecoration: s.done ? 'line-through' : 'none' }}>{s.label}</span>
      </div>
    );
  }

  return (
    <div className={`tk-page${closing ? ' core-blur-out' : ''}`}>
      <div className="tk-topbar">
        <div className="tk-brand">
          <button className="tk-icon-btn" onClick={goHome}>‹</button>
          <span className="name hdg">TÂCHES</span>
        </div>
        <div className="tk-pills">
          <span className="tk-pill" style={{ color: PRI.p1.col, borderColor: PRI.p1.bord }}>▲ {nP1}</span>
          <span className="tk-pill" style={{ color: PRI.p2.col, borderColor: PRI.p2.bord }}>▲ {nP2}</span>
          <span className="tk-pill" style={{ color: PRI.p3.col, borderColor: PRI.p3.bord }}>◉ {nP3}</span>
        </div>
      </div>

      {!loading && tasks.length === 0 && (
        <div className="tk-empty">
          <div className="eyebrow">ORACLE // TÂCHES</div>
          <div className="msg">Aucune tâche enregistrée. Ajoute-en une ci-dessous ou dis « ajoute une tâche… » depuis la Home.</div>
          <div style={{ marginTop: 6 }}><TaskForm onCreated={onTaskCreated} /></div>
        </div>
      )}

      {tasks.length > 0 && (
        <>
          {/* ============ Desktop : objectif prioritaire (1B) ============ */}
          <div className="tk-desktop">
            <div className="tk-cur-col">
              {cur ? (
                <div key={cur.id} className="tk-cur-card" style={{ borderColor: PRI[cur.priority].bord, boxShadow: `0 0 60px ${PRI[cur.priority].glow}` }}>
                  <div className="tk-cur-top">
                    <div className="tk-ring">
                      <svg width="128" height="128" viewBox="0 0 128 128" style={{ transform: 'rotate(-90deg)' }}>
                        <circle cx="64" cy="64" r="54" fill="none" stroke="rgba(120,190,255,.12)" strokeWidth="5" />
                        <circle cx="64" cy="64" r="54" fill="none" stroke={PRI[cur.priority].col} strokeWidth="5" strokeLinecap="round"
                          strokeDasharray={`${(CIRC * pct(cur) / 100).toFixed(1)} ${CIRC.toFixed(1)}`} style={{ transition: 'stroke-dasharray .4s' }} />
                      </svg>
                      <div className="tk-ring-txt"><div className="n">{pct(cur)}<span>%</span></div><div className="l">PROGRESSION</div></div>
                    </div>
                    <div className="tk-cur-head">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="tk-badge" style={{ background: PRI[cur.priority].badgeBg, color: PRI[cur.priority].col, borderColor: PRI[cur.priority].bord }}>{PRI[cur.priority].label}</span>
                        {cur.category && <span className="tk-cat">{cur.category}</span>}
                      </div>
                      <div className="tk-cur-title hdg">{cur.title}</div>
                      <div className="tk-cur-due">
                        <span style={{ color: dueInfo(cur.due_at).hot ? '#ffc266' : '#7fa3c2' }}>{dueInfo(cur.due_at).label}</span>
                        <span className="dim">·</span><span className="dim">{dueInfo(cur.due_at).tminus}</span>
                      </div>
                    </div>
                  </div>

                  {cur.note && (
                    <div className="tk-note-box">
                      <div className="lbl">SYNTHÈSE</div>
                      <div className="txt">{cur.note}</div>
                    </div>
                  )}

                  {cur.subs?.length > 0 && (
                    <div className="tk-subs-col">
                      <div className="tk-subs-lbl">SOUS-ÉTAPES</div>
                      {cur.subs.map((s, i) => <SubRow key={i} task={cur} s={s} i={i} big />)}
                    </div>
                  )}

                  <div className="tk-cur-actions">
                    <button className="tk-btn good" onClick={() => closeTask(cur.id)}>✓ CLORE LA MISSION</button>
                    {queue.length > 0 && <button className="tk-btn" onClick={() => setCurId(queue[0].id)}>SUIVANTE ▸</button>}
                  </div>
                </div>
              ) : (
                <div className="tk-empty" style={{ position: 'static' }}>
                  <div className="msg">Toutes les tâches actives sont closes. RAS.</div>
                </div>
              )}
              <div className="tk-cur-foot">
                <span>{active.length} ACTIVES</span><span className="sep">|</span><span>{done.length} CLOSES</span>
              </div>
            </div>

            <div className="tk-queue-col">
              <TaskForm onCreated={onTaskCreated} />
              <div className="tk-queue-lbl">FILE D'ATTENTE</div>
              <div className="tk-queue-list">
                {queue.map((t, i) => (
                  <div key={t.id} className="tk-queue-item" onClick={() => setCurId(t.id)}>
                    <span className="idx hdg">{String(i + 1).padStart(2, '0')}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row">
                        <span className="dot" style={{ background: PRI[t.priority].col, boxShadow: `0 0 7px ${PRI[t.priority].col}` }} />
                        <span className="prilabel" style={{ color: PRI[t.priority].col }}>{PRI[t.priority].label}</span>
                        <span className="tminus">{dueInfo(t.due_at).tminus}</span>
                      </div>
                      <div className="title hdg">{t.title}</div>
                      <div className="meta">{t.category || '—'} · {dueInfo(t.due_at).label}</div>
                    </div>
                  </div>
                ))}
                {queue.length === 0 && <div className="tk-queue-empty">File vide.</div>}
                {done.length > 0 && (
                  <>
                    <div className="tk-queue-lbl" style={{ marginTop: 10 }}>CLOSES</div>
                    {done.map((t) => (
                      <div key={t.id} className="tk-queue-item done">
                        <span className="check">✓</span>
                        <div className="title hdg" style={{ textDecoration: 'line-through' }}>{t.title}</div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ============ Mobile : groupé par priorité + tiroir ============ */}
          <div className="tk-mobile">
            <div style={{ margin: '0 16px 14px' }}><TaskForm onCreated={onTaskCreated} /></div>
            <div className="tk-mobile-list">
              {['p1', 'p2', 'p3'].map((k) => {
                const items = active.filter((t) => t.priority === k);
                if (!items.length) return null;
                return (
                  <div key={k}>
                    <div className="tk-group-head">
                      <span className="dot" style={{ background: PRI[k].col, boxShadow: `0 0 8px ${PRI[k].col}` }} />
                      <span style={{ color: PRI[k].col }}>{PRI[k].label}</span>
                      <span className="line" />
                      <span className="n">{String(items.length).padStart(2, '0')}</span>
                    </div>
                    {items.map((t) => (
                      <div key={t.id} className="tk-mcard" onClick={() => setSheetId(t.id)}>
                        <div className="row">
                          <span className="cat">{t.category || '—'}</span>
                          <span className="due" style={{ color: dueInfo(t.due_at).hot ? '#ffc266' : '#5a7893' }}>{dueInfo(t.due_at).label}</span>
                        </div>
                        <div className="title hdg">{t.title}</div>
                        <div className="prog"><div className="track"><div style={{ width: `${pct(t)}%`, background: PRI[k].col }} /></div><span>{pct(t)} %</span></div>
                      </div>
                    ))}
                  </div>
                );
              })}
              {done.length > 0 && (
                <>
                  <div className="tk-group-head"><span style={{ color: '#3d5a75' }}>CLOSES</span><span className="line" /></div>
                  {done.map((t) => (
                    <div key={t.id} className="tk-mcard done"><span className="check">✓</span><div className="title hdg" style={{ textDecoration: 'line-through' }}>{t.title}</div></div>
                  ))}
                </>
              )}
            </div>

            {sheetTask && (
              <>
                <div className="tk-sheet-backdrop" onClick={() => setSheetId(null)} />
                <div className="tk-sheet">
                  <div className="tk-sheet-bar" style={{ background: `linear-gradient(90deg, ${PRI[sheetTask.priority].col}, transparent)` }} />
                  <div className="tk-sheet-body">
                    <div className="tk-sheet-grip" />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span className="tk-badge" style={{ background: PRI[sheetTask.priority].badgeBg, color: PRI[sheetTask.priority].col, borderColor: PRI[sheetTask.priority].bord }}>{PRI[sheetTask.priority].label}</span>
                      <span className="tk-cat">{sheetTask.category} · {dueInfo(sheetTask.due_at).tminus}</span>
                      <span className="tk-sheet-close" onClick={() => setSheetId(null)}>✕</span>
                    </div>
                    <div className="tk-cur-title hdg" style={{ marginTop: 10, fontSize: 19 }}>{sheetTask.title}</div>
                    <div className="tk-cur-due" style={{ marginTop: 5 }}><span style={{ color: dueInfo(sheetTask.due_at).hot ? '#ffc266' : '#7fa3c2' }}>{dueInfo(sheetTask.due_at).label}</span></div>
                    {sheetTask.note && <div className="tk-note-box" style={{ marginTop: 12 }}><div className="lbl">SYNTHÈSE</div><div className="txt">{sheetTask.note}</div></div>}
                    {sheetTask.subs?.length > 0 && (
                      <div className="tk-subs-col" style={{ marginTop: 12 }}>
                        {sheetTask.subs.map((s, i) => <SubRow key={i} task={sheetTask} s={s} i={i} big />)}
                      </div>
                    )}
                    <button className="tk-btn good" style={{ width: '100%', marginTop: 14 }} onClick={() => { closeTask(sheetTask.id); setSheetId(null); }}>✓ CLORE LA TÂCHE</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
