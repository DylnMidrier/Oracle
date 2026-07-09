import { useEffect, useState } from 'react';
import { supabaseReady } from '../lib/supabase.js';
import { fetchHealth, fmtSleep, timeAgo } from '../lib/health.js';
import { useCoreClose } from '../lib/coreTransition.js';
import './Health.css';

const BODY_OPEN = 'M150 22 C163 22 172 31 173 46 C174 60 171 74 164 86 C161 92 158 97 157 102 C157 106 158 110 161 113 L161 120 C173 122 190 126 199 132 C206 137 209 145 209 154 C209 172 208 190 206 208 C205 216 205 222 204 228 C203 246 199 270 195 292 C194 300 193 308 193 314 C193 324 191 334 187 338 C183 341 179 338 179 331 C179 322 180 312 181 304 C182 288 184 264 185 244 C186 236 186 230 187 224 C188 204 189 184 190 168 C190 158 187 152 181 150 C178 162 177 176 176 190 C177 214 178 236 180 256 C183 270 185 284 186 298 C186 312 185 322 183 332 C182 356 181 384 179 412 C178 436 176 456 175 472 C175 484 175 494 176 504 C178 520 179 536 178 552 C176 580 172 605 169 620 C169 628 171 634 177 636 C181 638 186 640 187 644 L152 644 C153 636 154 630 155 624 L157 615 C159 590 160 566 159 548 C158 526 158 508 159 492 C160 460 161 420 158 380 C156 358 153 342 151 334 L150 330';
const BODY_CLOSED = `${BODY_OPEN} L150 22 Z`;

const MOVE_GOAL = 600, EX_GOAL = 30, STAND_GOAL = 12;
const RING_C = { move: 439.8, ex: 345.6, stand: 251.3 };

function ringOffset(value, goal, circumference) {
  const pct = Math.min(1, Math.max(0, (value || 0) / goal));
  return +(circumference * (1 - pct)).toFixed(1);
}

export default function Health() {
  const { closing, goHome } = useCoreClose();
  const [scanKey, setScanKey] = useState(0);
  const [latest, setLatest] = useState(null);
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const { latest: l, trend: t } = await fetchHealth();
    setLatest(l); setTrend(t); setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function rescan() {
    setScanKey((k) => k + 1);
    setLoading(true);
    load();
  }

  const sleep = latest?.sleep_hours != null ? fmtSleep(latest.sleep_hours) : null;
  const stepsPct = latest?.steps != null ? Math.min(100, (latest.steps / 10000) * 100) : 0;
  const trendMax = Math.max(1, ...trend.map((r) => r.steps || 0), 10000);

  return (
    <div className={`he-page${closing ? ' core-blur-out' : ''}`}>
      <div className="he-page-sweep" />
      <div className="he-topbar">
        <div className="he-brand">
          <button className="he-icon-btn" onClick={goHome}>‹</button>
          <span className="name hdg">SANTÉ</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ textAlign: 'right' }}>
            <div className="he-status">{latest ? `✓ ${(latest.sleep_evaluation || 'SUIVI ACTIF').toUpperCase()}` : '— AUCUNE DONNÉE'}</div>
            <div className="he-status-score">{latest ? `SYNC ${timeAgo(latest.recorded_at).toUpperCase()}` : ''}</div>
          </div>
          <button className="he-scan" onClick={rescan}>↻ RE-SCAN</button>
        </div>
      </div>

      {!supabaseReady && <div className="he-note">Supabase n'est pas configuré — impossible de charger les données santé.</div>}

      <div key={scanKey} className="he-body-anim">
        <div className="he-hero">
          <div className="eyebrow">ORACLE // BIO-MONITEUR</div>
          <h1 className="hdg">État physiologique</h1>
          <div className="sync">{latest ? `Sync Apple Watch · ${timeAgo(latest.recorded_at)}` : 'En attente de la première synchronisation'}</div>
        </div>

        {!loading && !latest && (
          <div className="he-empty">
            <div className="msg">Aucune donnée de santé pour le moment. Connecte l'automatisation iOS (Raccourcis) pour commencer :</div>
            <ol>
              <li>Ouvre l'app <b>Raccourcis</b> sur iPhone, crée une automatisation personnelle (déclenchée par ex. chaque matin).</li>
              <li>Ajoute les actions pour lire tes données santé (sommeil, fréquence cardiaque, pas, calories actives, minutes d'exercice, heures debout).</li>
              <li>Ajoute une action <b>« Obtenir le contenu de l'URL »</b> en POST vers :<br /><code>https://vevxbnuyxzqkkicepjgv.supabase.co/functions/v1/health-ingest</code></li>
              <li>Header <code>Authorization: Bearer &lt;ton HEALTH_API_TOKEN&gt;</code>, corps JSON avec les champs lus.</li>
            </ol>
          </div>
        )}

        {latest && (
        <div className="he-grid">
          <div className="he-col-left">
            <div className="he-card" style={{ borderColor: 'rgba(255,110,130,.3)', animationDelay: '.15s' }}>
              <div className="top"><span style={{ color: '#ff8a98' }}>FRÉQUENCE CARDIAQUE</span><span style={{ color: '#5a7893' }}>{latest.heart_rate_day != null ? 'JOUR' : 'REPOS'}</span></div>
              <div className="he-bpm"><span className="n">{latest.heart_rate_day ?? latest.heart_rate_resting ?? '—'}</span><span style={{ fontSize: 13, color: '#9fc0dc' }}>bpm</span></div>
              <div className="he-ecg">
                <div className="he-ecg-track">
                  <svg viewBox="0 0 480 34" width="100%" height="34" preserveAspectRatio="none">
                    <polyline points="0,17 40,17 52,17 58,6 64,28 70,12 76,17 120,17 160,17 172,17 178,6 184,28 190,12 196,17 240,17 280,17 292,17 298,6 304,28 310,12 316,17 360,17 400,17 412,17 418,6 424,28 430,12 436,17 480,17" fill="none" stroke="#ff5a6e" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
                  </svg>
                </div>
              </div>
              <div className="foot-line">
                Repos <b style={{ color: '#eaf5ff' }}>{latest.heart_rate_resting ?? '—'}</b> · Max <b style={{ color: '#eaf5ff' }}>{latest.heart_rate_max ?? '—'}</b>
                {latest.hrv != null && <> · VFC <b style={{ color: '#eaf5ff' }}>{Math.round(latest.hrv)}</b></>}
              </div>
            </div>

            <div className="he-card" style={{ borderColor: 'rgba(124,157,255,.3)', animationDelay: '.25s' }}>
              <div className="top" style={{ color: '#a9b8ff' }}>SOMMEIL</div>
              {sleep ? (
                <>
                  <div className="he-sleep-n">{sleep.h}<span style={{ fontSize: 20 }}>h</span>{String(sleep.m).padStart(2, '0')}</div>
                  <div className="foot-line" style={{ marginTop: 10 }}>
                    {latest.sleep_start && latest.sleep_end ? <>{latest.sleep_start} → {latest.sleep_end}</> : null}
                    {latest.sleep_score != null && <> · Score <b style={{ color: '#eaf5ff' }}>{latest.sleep_score.toFixed(1)}</b>/5</>}
                  </div>
                </>
              ) : <div className="he-sleep-n" style={{ fontSize: 20, color: '#3d5a75' }}>—</div>}
            </div>
          </div>

          <div className="he-body-wrap">
            <div className="he-body-stage">
              <div className="he-body-ring"><div className="r1" /><div className="r2" /></div>
              <div className="he-body-halo" />
              <svg viewBox="0 0 300 660" width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
                <defs>
                  <radialGradient id="bodyfill" cx="47%" cy="28%" r="62%">
                    <stop offset="0" stopColor="rgba(120,215,255,.32)" />
                    <stop offset="52%" stopColor="rgba(58,123,255,.11)" />
                    <stop offset="100%" stopColor="rgba(58,123,255,.02)" />
                  </radialGradient>
                </defs>
                <path d={BODY_CLOSED} fill="url(#bodyfill)" />
                <path d={BODY_CLOSED} fill="url(#bodyfill)" transform="matrix(-1 0 0 1 300 0)" />
                <path d={BODY_OPEN} fill="none" stroke="rgba(165,222,255,.8)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
                <path d={BODY_OPEN} fill="none" stroke="rgba(165,222,255,.8)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" transform="matrix(-1 0 0 1 300 0)" />
                <g className="he-heart">
                  <circle cx="140" cy="172" r="23" fill="rgba(255,90,110,.15)" stroke="rgba(255,110,130,.5)" strokeWidth="1" />
                  <circle cx="140" cy="172" r="8" fill="#ff5a6e" />
                </g>
              </svg>
              <div className="he-scanbeam" />
            </div>
          </div>

          <div className="he-col-right">
            <div className="he-card" style={{ animationDelay: '.2s' }}>
              <div className="top" style={{ color: '#7fc4ff' }}>ANNEAUX D'ACTIVITÉ</div>
              <div className="he-rings-row">
                <svg viewBox="0 0 180 180" width="90" height="90" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="90" cy="90" r="70" fill="none" stroke="rgba(255,90,110,.14)" strokeWidth="12" />
                  <circle cx="90" cy="90" r="55" fill="none" stroke="rgba(93,225,255,.14)" strokeWidth="12" />
                  <circle cx="90" cy="90" r="40" fill="none" stroke="rgba(124,157,255,.14)" strokeWidth="12" />
                  <circle cx="90" cy="90" r="70" fill="none" stroke="#ff5a6e" strokeWidth="12" strokeLinecap="round" strokeDasharray={RING_C.move} strokeDashoffset={ringOffset(latest.active_calories, MOVE_GOAL, RING_C.move)} />
                  <circle cx="90" cy="90" r="55" fill="none" stroke="#5de1ff" strokeWidth="12" strokeLinecap="round" strokeDasharray={RING_C.ex} strokeDashoffset={ringOffset(latest.exercise_minutes, EX_GOAL, RING_C.ex)} />
                  <circle cx="90" cy="90" r="40" fill="none" stroke="#7c9dff" strokeWidth="12" strokeLinecap="round" strokeDasharray={RING_C.stand} strokeDashoffset={ringOffset(latest.stand_hours, STAND_GOAL, RING_C.stand)} />
                </svg>
                <div className="he-ring-legend">
                  <div><span className="lbl" style={{ color: '#ff8a98' }}>MOUVEMENT</span><div className="v">{latest.active_calories ?? '—'}<span style={{ fontSize: 11, color: '#5a7893' }}>/{MOVE_GOAL} kcal</span></div></div>
                  <div><span className="lbl" style={{ color: '#7fe0ff' }}>EXERCICE</span><div className="v">{latest.exercise_minutes ?? '—'}<span style={{ fontSize: 11, color: '#5a7893' }}>/{EX_GOAL} min</span></div></div>
                  <div><span className="lbl" style={{ color: '#a9b8ff' }}>DEBOUT</span><div className="v">{latest.stand_hours ?? '—'}<span style={{ fontSize: 11, color: '#5a7893' }}>/{STAND_GOAL} h</span></div></div>
                </div>
              </div>
            </div>

            <div className="he-card" style={{ animationDelay: '.3s' }}>
              <div className="top" style={{ color: '#7fc4ff' }}>PAS</div>
              <div className="he-steps-n">{latest.steps != null ? latest.steps.toLocaleString('fr-FR') : '—'}</div>
              <div className="he-steps-bar"><div style={{ width: `${stepsPct}%` }} /></div>
              <div className="foot-line">Objectif 10 000 · {Math.round(stepsPct)}%</div>
            </div>

            <div className="he-card" style={{ animationDelay: '.4s' }}>
              <div className="he-kcal-row">
                <div><div className="top" style={{ color: '#7fc4ff' }}>DÉPENSE ACTIVE</div><div style={{ fontFamily: "'Chakra Petch',sans-serif", fontSize: 26, color: '#eaf5ff', marginTop: 4 }}>{latest.active_calories ?? '—'} <span style={{ fontSize: 13, color: '#5a7893' }}>kcal</span></div></div>
                {(latest.spo2 != null || latest.hrv != null) && (
                  <div style={{ textAlign: 'right' }}>
                    <div className="top" style={{ color: '#5a7893' }}>{latest.spo2 != null ? 'SPO2' : 'VFC'}</div>
                    <div style={{ fontFamily: "'Chakra Petch',sans-serif", fontSize: 20, color: '#9fc0dc', marginTop: 4 }}>{latest.spo2 != null ? `${latest.spo2.toFixed(1)}%` : `${Math.round(latest.hrv)} ms`}</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="he-foot">
            <div className="he-trend">
              <span style={{ fontSize: 10, letterSpacing: '.22em', color: '#5a7893', flex: '0 0 auto' }}>TENDANCE · PAS</span>
              <div className="he-trend-bars">
                {trend.map((r, i) => (
                  <div key={r.date} style={{ height: `${Math.max(4, ((r.steps || 0) / trendMax) * 100)}%`, background: i === trend.length - 1 ? 'linear-gradient(180deg,#5de1ff,rgba(93,225,255,.3))' : 'linear-gradient(180deg,#3a7bff,rgba(58,123,255,.2))' }} />
                ))}
              </div>
              <span style={{ fontSize: 11, color: '#7fa3c2', flex: '0 0 auto' }}>Moy. <span style={{ color: '#eaf5ff' }}>{Math.round(trend.reduce((a, r) => a + (r.steps || 0), 0) / Math.max(1, trend.length)).toLocaleString('fr-FR')}</span></span>
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
