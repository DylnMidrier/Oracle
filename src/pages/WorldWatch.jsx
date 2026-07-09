import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseReady } from '../lib/supabase.js';
import { fetchArticles, refreshWorldWatch } from '../lib/worldWatch.js';
import { landDots, projectGlobe, jitterCoords } from '../lib/worldGeo.js';
import { useCoreClose } from '../lib/coreTransition.js';
import './WorldWatch.css';

const SEV = {
  crit: { label: 'CRITIQUE', col: '#ff5a6e', bord: 'rgba(255,90,110,.45)', badgeBg: 'rgba(255,90,110,.12)', glow: 'rgba(255,90,110,.2)' },
  ele: { label: 'ÉLEVÉ', col: '#ffc266', bord: 'rgba(255,194,102,.4)', badgeBg: 'rgba(255,194,102,.1)', glow: 'rgba(255,194,102,.16)' },
  surv: { label: 'SURVEILLANCE', col: '#4db8ff', bord: 'rgba(77,184,255,.4)', badgeBg: 'rgba(77,184,255,.1)', glow: 'rgba(77,184,255,.16)' },
};
const URGENCY_TO_SEV = { critical: 'crit', warning: 'ele', normal: 'surv' };
const SEV_ORDER = { crit: 0, ele: 1, surv: 2 };

function timeAgo(iso) {
  const diffMin = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} j`;
}

export default function WorldWatch() {
  const { closing, goHome } = useCoreClose();
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const rafRef = useRef(null);
  const rotRef = useRef(2.2);
  const hitsRef = useRef([]);
  const tRef = useRef(0);

  async function load() {
    const data = await fetchArticles();
    setArticles(data);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true); setRefreshError(null);
    const res = await refreshWorldWatch();
    if (res?.error) setRefreshError(res.error);
    await load();
    setRefreshing(false);
  }

  const markers = articles.slice(0, 80).map((a) => {
    const [lat, lon] = jitterCoords(a.region, a.id);
    return { ...a, sev: URGENCY_TO_SEV[a.urgency] || 'surv', lat, lon };
  });
  const nCrit = markers.filter((m) => m.sev === 'crit').length;
  const nEle = markers.filter((m) => m.sev === 'ele').length;
  const nSurv = markers.filter((m) => m.sev === 'surv').length;
  const feed = [...markers].sort((a, b) => (SEV_ORDER[a.sev] - SEV_ORDER[b.sev]) || (new Date(b.published_at) - new Date(a.published_at)));
  const selected = selectedId ? markers.find((m) => m.id === selectedId) : null;

  const select = useCallback((id) => setSelectedId((cur) => (cur === id ? null : id)), []);

  // ---- draw loop ----
  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    tRef.current += 0.016;
    const t = tRef.current;
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.38;

    if (selected) {
      const target = (-selected.lon * Math.PI) / 180;
      let d = (((target - rotRef.current + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      rotRef.current += d * 0.055;
    } else {
      rotRef.current += 0.0016;
    }
    const rot = rotRef.current;

    ctx.clearRect(0, 0, W, H);

    const halo = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 1.5);
    halo.addColorStop(0, 'rgba(58,123,255,.10)');
    halo.addColorStop(0.72, 'rgba(58,123,255,.045)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(cx - R * 1.6, cy - R * 1.6, R * 3.2, R * 3.2);

    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(120,190,255,.22)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R + 7, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(120,190,255,.07)'; ctx.lineWidth = 1; ctx.stroke();

    landDots().forEach((d) => {
      const p = projectGlobe(d.la, d.lo, rot, R);
      if (p.z <= 0.02) return;
      ctx.globalAlpha = 0.16 + 0.55 * p.z;
      ctx.fillStyle = '#7fc4ff';
      ctx.fillRect(cx + p.x - 0.7, cy + p.y - 0.7, 1.4, 1.4);
    });
    ctx.globalAlpha = 1;

    const hits = [];
    markers.forEach((m, i) => {
      const sv = SEV[m.sev];
      const la = (m.lat * Math.PI) / 180, lo = (m.lon * Math.PI) / 180;
      const p = projectGlobe(la, lo, rot, R);
      if (p.z <= 0.03) return;
      const sel = selectedId === m.id;
      const bx = cx + p.x, by = cy + p.y;
      const h = sel ? 0.3 : 0.16;
      const tip = projectGlobe(la, lo, rot, R * (1 + h));
      const tx = cx + tip.x, ty = cy + tip.y;
      const vis = 0.35 + 0.65 * p.z;

      const grad = ctx.createLinearGradient(bx, by, tx, ty);
      grad.addColorStop(0, `${sv.col}e6`);
      grad.addColorStop(1, `${sv.col}00`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = sel ? 2.4 : 1.3;
      ctx.globalAlpha = vis;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();

      const ringR = (t * 26 + i * 9) % 24;
      ctx.globalAlpha = vis * (1 - ringR / 24) * 0.8;
      ctx.beginPath(); ctx.arc(bx, by, 3 + ringR, 0, Math.PI * 2);
      ctx.strokeStyle = sv.col; ctx.lineWidth = 1; ctx.stroke();

      ctx.globalAlpha = vis;
      ctx.fillStyle = sv.col;
      ctx.beginPath(); ctx.arc(bx, by, sel ? 3.4 : 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(tx, ty, sel ? 3 : 1.8, 0, Math.PI * 2); ctx.fill();

      if (sel) {
        const s = 11;
        ctx.strokeStyle = sv.col; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(tx - s, ty - s + 5); ctx.lineTo(tx - s, ty - s); ctx.lineTo(tx - s + 5, ty - s);
        ctx.moveTo(tx + s - 5, ty - s); ctx.lineTo(tx + s, ty - s); ctx.lineTo(tx + s, ty - s + 5);
        ctx.moveTo(tx + s, ty + s - 5); ctx.lineTo(tx + s, ty + s); ctx.lineTo(tx + s - 5, ty + s);
        ctx.moveTo(tx - s + 5, ty + s); ctx.lineTo(tx - s, ty + s); ctx.lineTo(tx - s, ty + s - 5);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      hits.push({ id: m.id, x: tx, y: ty }, { id: m.id, x: bx, y: by });
    });
    hitsRef.current = hits;
  }, [markers, selected, selectedId]);

  useEffect(() => {
    let running = true;
    function loop() { if (!running) return; draw(); rafRef.current = requestAnimationFrame(loop); }
    rafRef.current = requestAnimationFrame(loop);
    return () => { running = false; if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) { canvas.width = entry.contentRect.width; canvas.height = entry.contentRect.height; }
    });
    observer.observe(canvas);
    canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight;
    return () => observer.disconnect();
  }, []);

  function handleCanvasClick(e) {
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    let best = null, bd = 30 * 30;
    hitsRef.current.forEach((h) => {
      const d = (h.x - x) * (h.x - x) + (h.y - y) * (h.y - y);
      if (d < bd) { bd = d; best = h.id; }
    });
    if (best) select(best); else setSelectedId(null);
  }

  return (
    <div className={`ww-page${closing ? ' core-blur-out' : ''}`}>
      <div className="ww-page-sweep" />
      <div className="ww-topbar">
        <div className="ww-brand">
          <button className="ww-icon-btn" onClick={goHome}>‹</button>
          <span className="name hdg">VEILLE MONDIALE</span>
        </div>
        <div className="ww-topbar-actions">
          <span className="ww-sevpill" style={{ color: SEV.crit.col, borderColor: SEV.crit.bord }}>▲ {nCrit}</span>
          <span className="ww-sevpill" style={{ color: SEV.ele.col, borderColor: SEV.ele.bord }}>▲ {nEle}</span>
          <span className="ww-sevpill" style={{ color: SEV.surv.col, borderColor: SEV.surv.bord }}>◉ {nSurv}</span>
          <button className="ww-refresh" disabled={refreshing || !supabaseReady} onClick={handleRefresh}>{refreshing ? 'ANALYSE…' : '↻ ACTUALISER'}</button>
        </div>
      </div>

      {!supabaseReady && <div className="ww-note">Supabase n'est pas configuré — impossible de charger ou d'actualiser la veille.</div>}
      {refreshError && <div className="ww-note">{refreshError}</div>}

      <div className="ww-body">
        <div className="ww-stage" ref={stageRef}>
          <canvas ref={canvasRef} className="ww-canvas" onClick={handleCanvasClick} />

          {!loading && articles.length === 0 && (
            <div className="ww-empty">
              <div className="eyebrow">ORACLE // VEILLE MONDIALE</div>
              <div className="msg">Aucun signal pour le moment. Lance une actualisation pour agréger les flux et faire classifier les signaux.</div>
              {refreshing && <div className="dot-row"><span /><span /><span /></div>}
            </div>
          )}

          {selected && (
            <div className="ww-intel" style={{ borderColor: SEV[selected.sev].bord, boxShadow: `0 0 50px ${SEV[selected.sev].glow}` }}>
              <div className="ww-intel-bar" style={{ background: `linear-gradient(90deg, ${SEV[selected.sev].col}, transparent)` }} />
              <div className="ww-intel-body">
                <div className="ww-intel-head">
                  <span className="ww-intel-badge" style={{ background: SEV[selected.sev].badgeBg, color: SEV[selected.sev].col, borderColor: SEV[selected.sev].bord }}>{SEV[selected.sev].label}</span>
                  <span className="ww-intel-cat">{selected.category}</span>
                  <span onClick={() => setSelectedId(null)} className="ww-intel-close">✕</span>
                </div>
                <div className="ww-intel-title hdg">{selected.title}</div>
                <div className="ww-intel-region">{selected.region || 'Mondial'}</div>
                <div className="ww-intel-summary-wrap">
                  <div className="ww-intel-summary-lbl">SYNTHÈSE IA</div>
                  <div className="ww-intel-summary">{selected.summary}</div>
                </div>
                <div className="ww-intel-foot">
                  <span>{selected.source} · {timeAgo(selected.published_at)}</span>
                  <a href={selected.url} target="_blank" rel="noopener noreferrer">Lire la source →</a>
                </div>
              </div>
            </div>
          )}
        </div>

        <aside className="ww-feed">
          <div className="ww-feed-head"><span className="lbl">FLUX D'ALERTES</span><span className="n">{feed.length}</span></div>
          {feed.map((m) => {
            const sv = SEV[m.sev];
            const sel = selectedId === m.id;
            return (
              <div key={m.id} className="ww-feed-ev" onClick={() => select(m.id)} style={{ background: sel ? sv.badgeBg : 'rgba(10,25,45,.42)', borderColor: sel ? sv.bord : 'var(--line)' }}>
                <div className="row">
                  <span className="dot" style={{ background: sv.col, boxShadow: `0 0 8px ${sv.col}` }} />
                  <span className="sevlabel" style={{ color: sv.col }}>{sv.label}</span>
                  <span className="meta">{m.category} · {timeAgo(m.published_at)}</span>
                </div>
                <div className="title hdg">{m.title}</div>
                <div className="region">{m.region || 'Mondial'}</div>
              </div>
            );
          })}
          {feed.length === 0 && !loading && <div className="ww-feed-empty">Aucun signal indexé.</div>}
        </aside>
      </div>
    </div>
  );
}
