import { Component, createRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { peekReturnFlag, clearReturnFlag } from '../lib/coreTransition.js';
import { askOracle } from '../lib/oracleChat.js';
import { supabase, supabaseReady } from '../lib/supabase.js';
import { SESSIONS } from '../data/sessions.js';
import { fetchTaskSummary, createTask } from '../lib/tasks.js';
import { synthesizeSpeech } from '../lib/tts.js';
import './Home.css';

// Clip audio silencieux (WAV valide, 0 échantillon) utilisé pour débloquer la lecture
// programmatique sur iOS/Safari : doit être joué une première fois dans la foulée d'un
// geste utilisateur pour que les lectures async ultérieures (réponse de Claude) marchent.
const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

function slugify(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '') || 'seance';
}

const USER_NAME = 'Dylan';
const ACCENT = '#4db8ff';

const STATUS_LINES = [
  'SANTÉ — énergie 82 %, sommeil 7 h 20, constantes stables.',
  'MÉTÉO — 14°, ciel dégagé, nuit claire à prévoir.',
  'ENTRAÎNEMENT — séance jambes programmée 18:00.',
  'AGENDA — 3 tâches prioritaires, 5 événements. RAS.',
];

class HomeCanvas extends Component {
  canvasRef = createRef();
  nucleusRef = createRef();
  rootRef = createRef();
  clockRef = createRef();
  openRef = createRef();
  santeRef = createRef();
  trainRef = createRef();
  veilleRef = createRef();
  tachesRef = createRef();
  agendaRef = createRef();
  _retHome = peekReturnFlag();
  _askSeq = 0;
  _rec = null;
  _lastRecEnd = 0; // horodatage de fin de la dernière écoute, pour espacer un redémarrage trop rapide
  _history = []; // 5 derniers échanges (10 messages) envoyés à Claude pour le contexte
  _sttOK = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  state = {
    value: '', phase: 'idle', response: '', listening: false, isMobile: false,
    booting: !this._retHome, bootStep: this._retHome ? 4 : 0,
    opening: null,
    asking: false, askQuestion: '', answer: null, askError: null,
    voiceReply: typeof localStorage !== 'undefined' && localStorage.getItem('oracleVoiceReply') === '1',
    taskSummary: { count: 0, top: null },
    nextSession: { groupe: 'Jambes', jour: '18:00' },
  };

  // Catalogue de commandes déclenchables par Oracle depuis la barre de commande.
  // Chaque tool porte son schéma (envoyé à Claude) et son exécution réelle (run),
  // qui agit directement sur l'état du composant pour que le HUD se mette à jour.
  TOOLS = [
    {
      name: 'ouvrir_module',
      description: "Ouvre un module de l'interface Oracle (santé, entraînement ou veille mondiale) et y navigue.",
      input_schema: {
        type: 'object',
        properties: { module: { type: 'string', enum: ['sante', 'entrainement', 'veille'], description: 'Module à ouvrir' } },
        required: ['module'],
      },
      run: (input) => {
        const map = {
          sante: [this.santeRef, 'SANTÉ', '/sante'],
          entrainement: [this.trainRef, 'ENTRAÎNEMENT', '/entrainement'],
          veille: [this.veilleRef, 'VEILLE MONDIALE', '/veille'],
        };
        const m = map[input?.module];
        if (m) this.openModule(...m);
        return { ok: !!m, module: input?.module };
      },
    },
    {
      name: 'ajouter_seance',
      description: "Planifie une séance d'entraînement (groupe musculaire + jour/heure), avec le détail des exercices " +
        "s'ils sont précisés (nom, poids, séries, répétitions). Met à jour le HUD et crée une vraie séance utilisable " +
        'dans le module Entraînement.',
      input_schema: {
        type: 'object',
        properties: {
          groupe: { type: 'string', description: 'Groupe musculaire ou nom de la séance, ex: jambes, upper, dos' },
          jour: { type: 'string', description: 'Jour et/ou heure prévue, ex: jeudi 18:00' },
          exercices: {
            type: 'array',
            description: 'Exercices mentionnés pour cette séance, si précisés',
            items: {
              type: 'object',
              properties: {
                nom: { type: 'string', description: "Nom de l'exercice, ex: développé couché barre" },
                poids: { type: 'number', description: 'Charge en kg' },
                series: { type: 'integer', description: 'Nombre de séries' },
                repetitions: { type: 'integer', description: 'Répétitions par série' },
              },
              required: ['nom'],
            },
          },
        },
        required: ['groupe', 'jour'],
      },
      run: async (input) => {
        const groupe = String(input?.groupe || '').trim() || 'Séance';
        const jour = String(input?.jour || '').trim() || 'à définir';
        const exercises = (Array.isArray(input?.exercices) ? input.exercices : []).map((e) => {
          const series = Number(e.series) > 0 ? Math.round(Number(e.series)) : 3;
          const reps = Number(e.repetitions) > 0 ? Math.round(Number(e.repetitions)) : 10;
          const poids = Number(e.poids) || 0;
          return { name: String(e.nom || 'Exercice').trim(), note: '', target: `${series} × ${reps}`, prev: poids, pr: poids, rest: 90, reps: Array(series).fill(reps) };
        });

        this.setState({ nextSession: { groupe, jour } });
        if (!supabaseReady) return { ok: true, groupe, jour, exercices: exercises.map((e) => e.name), saved: false };

        try {
          // dès qu'une ligne existe dans session_templates, le module Entraînement n'affiche
          // plus QUE les lignes en base : on doit d'abord y semer upper/lower par défaut.
          const { data: existing } = await supabase.from('session_templates').select('key');
          if (!existing || existing.length === 0) {
            await supabase.from('session_templates').insert(
              Object.entries(SESSIONS).map(([k, v]) => ({ key: k, meta: v.meta, exercises: v.exercises })),
            );
          }
          const key = `${slugify(groupe)}_${Date.now().toString(36)}`;
          const meta = { name: groupe.toUpperCase(), tag: 'SÉANCE // AJOUTÉE PAR ORACLE', sub: jour, glyph: groupe.trim().charAt(0).toUpperCase() || 'S', dur: '~45 min' };
          const { error } = await supabase.from('session_templates').insert({ key, meta, exercises });
          if (error) return { ok: false, groupe, jour, exercices: exercises.map((e) => e.name), saved: false, error: error.message };
          return { ok: true, groupe, jour, exercices: exercises.map((e) => e.name), saved: true };
        } catch (err) {
          return { ok: false, groupe, jour, exercices: exercises.map((e) => e.name), saved: false, error: String(err?.message || err) };
        }
      },
    },
    {
      name: 'ajouter_tache',
      description: 'Crée une vraie tâche dans le module Tâches (priorité, catégorie, échéance, note si précisées).',
      input_schema: {
        type: 'object',
        properties: {
          tache: { type: 'string', description: 'Intitulé de la tâche à ajouter' },
          priorite: { type: 'string', enum: ['p1', 'p2', 'p3'], description: 'p1 = critique, p2 = haute, p3 = normale (défaut si non précisé)' },
          categorie: { type: 'string', description: 'Catégorie courte, ex : DOSSIER, COMM, ADMIN, SÉCURITÉ' },
          echeance_iso: { type: 'string', description: "Date/heure d'échéance au format ISO 8601 si déductible de la commande (sinon, omettre ce champ)" },
          note: { type: 'string', description: 'Courte synthèse ou précision sur la tâche, si utile' },
        },
        required: ['tache'],
      },
      run: async (input) => {
        const tache = String(input?.tache || '').trim();
        if (!tache) return { ok: false, error: 'Intitulé manquant' };
        const { data, error } = await createTask({
          title: tache,
          category: input?.categorie ? String(input.categorie).toUpperCase() : null,
          priority: input?.priorite,
          dueAt: input?.echeance_iso || null,
          note: input?.note ? String(input.note) : null,
        });
        if (data) this._loadTaskSummary();
        return { ok: !!data, tache, saved: !!data, error: error || undefined };
      },
    },
    {
      name: 'statut_systeme',
      description: "Consulte l'état actuel du système (énergie, alertes, séance prévue, tâches) pour répondre aux questions de synthèse (ex : « résume ma journée »).",
      input_schema: { type: 'object', properties: {} },
      run: () => ({
        energie: '82 %',
        sommeil: '7 h 20',
        prochaine_seance: `${this.state.nextSession.groupe} · ${this.state.nextSession.jour}`,
        taches_en_cours: this.state.taskSummary.count,
        tache_prioritaire: this.state.taskSummary.top,
        prochain_evenement: 'Standup à 09:30, 5 événements',
      }),
    },
  ];

  componentDidMount() {
    this.setState({ isMobile: window.innerWidth < 900 });
    this._onResize = () => {
      const m = window.innerWidth < 900;
      if (m !== this.state.isMobile) this.setState({ isMobile: m });
      this._resizeCanvas();
    };
    window.addEventListener('resize', this._onResize);
    if (this._retHome) clearReturnFlag();
    else this._startBoot();
    this._initCanvas();
    this._loadTaskSummary();
  }

  _loadTaskSummary = async () => {
    const s = await fetchTaskSummary();
    this.setState({ taskSummary: s });
  };

  componentWillUnmount() {
    clearInterval(this._clockTimer);
    clearTimeout(this._t1); clearTimeout(this._t2); clearTimeout(this._bt); clearTimeout(this._navT); clearTimeout(this._silenceT); clearTimeout(this._recStartT); clearTimeout(this._finishT);
    if (this._raf) cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    this._recActive = false;
    try { this._rec?.abort(); } catch { /* noop */ }
    this._stopSpeech();
  }

  _startClock() {
    const tick = () => {
      if (this.clockRef.current)
        this.clockRef.current.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    tick();
    this._clockTimer = setInterval(tick, 1000);
  }

  _startBoot() {
    const total = 4;
    const advance = (k) => {
      if (k <= total) { this.setState({ bootStep: k }); this._bt = setTimeout(() => advance(k + 1), k === 0 ? 750 : 1000); }
      else this._bt = setTimeout(() => this.setState({ booting: false }), 1100);
    };
    advance(0);
  }

  _skipBoot() { clearTimeout(this._bt); this.setState({ booting: false, bootStep: 4 }); }

  _hexToRgb(h) {
    h = (h || ACCENT).replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }

  _makeSprite() {
    const { r, g, b } = this._hexToRgb(ACCENT);
    const s = document.createElement('canvas'); s.width = s.height = 48;
    const g2 = s.getContext('2d');
    const grd = g2.createRadialGradient(24, 24, 0, 24, 24, 24);
    grd.addColorStop(0, `rgba(${Math.min(r + 110, 255)},${Math.min(g + 90, 255)},${Math.min(b + 60, 255)},1)`);
    grd.addColorStop(0.25, `rgba(${r},${g},${b},0.9)`);
    grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    g2.fillStyle = grd; g2.fillRect(0, 0, 48, 48);
    this._sprite = s;
  }

  _resizeCanvas() {
    const cv = this.canvasRef.current; if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
    cv.width = w * dpr; cv.height = h * dpr;
    this._ctx = cv.getContext('2d');
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._W = w; this._H = h;
  }

  _polyR(th, sides, rot) {
    const a = ((th - rot) % (Math.PI * 2 / sides) + Math.PI * 2 / sides) % (Math.PI * 2 / sides) - Math.PI / sides;
    return Math.cos(Math.PI / sides) / Math.cos(a);
  }

  _proj(x, y, z, ax, ay, cx, cy, unit) {
    const ca = Math.cos(ax), sa = Math.sin(ax);
    let y1 = y * ca - z * sa, z1 = y * sa + z * ca;
    const cb = Math.cos(ay), sb = Math.sin(ay);
    let x2 = x * cb + z1 * sb, z2 = -x * sb + z1 * cb;
    const persp = 3.2;
    const k = persp / (persp - z2 / unit);
    return { x: cx + x2 * k, y: cy + y1 * k, k, z: z2 };
  }

  _edgePoint(sh, u, unit, cx, cy) {
    const seg = u * sh.sides;
    const i = Math.floor(seg), f = seg - i;
    const R = unit * sh.rho;
    const th0 = (i / sh.sides) * Math.PI * 2 + sh.spin;
    const th1 = ((i + 1) / sh.sides) * Math.PI * 2 + sh.spin;
    const x = (Math.cos(th0) + (Math.cos(th1) - Math.cos(th0)) * f) * R;
    const y = (Math.sin(th0) + (Math.sin(th1) - Math.sin(th0)) * f) * R;
    return this._proj(x, y, 0, sh.ax, sh.ay, cx, cy, unit);
  }

  _initCanvas() {
    this._makeSprite();
    this._resizeCanvas();
    this._startClock();

    const N = 460;
    this._soul = [];
    const SHELLS = [{ sides: 6, rho: 1.0 }, { sides: 6, rho: 0.91 }, { sides: 5, rho: 0.82 }, { sides: 6, rho: 0.73 }, { sides: 3, rho: 0.62 }, { sides: 4, rho: 0.53 }, { sides: 4, rho: 0.44 }, { sides: 3, rho: 0.36 }, { sides: 5, rho: 0.27 }, { sides: 3, rho: 0.19 }];
    for (let i = 0; i < N; i++) {
      const si = Math.floor(Math.random() * SHELLS.length);
      const sh = SHELLS[si];
      this._soul.push({
        th: Math.random() * Math.PI * 2, shell: si, sides: sh.sides,
        rho: sh.rho * (0.97 + Math.random() * 0.06), ph: Math.random() * Math.PI * 2,
        sz: Math.random() * 1.5 + 0.8, br: Math.random() * 0.4 + 0.3,
        drift: (Math.random() < 0.5 ? -1 : 1) * (Math.random() * 0.0022 + 0.0008),
      });
    }
    this._amb = [];
    for (let i = 0; i < 90; i++)
      this._amb.push({ x: Math.random(), y: Math.random(), vx: (Math.random() - 0.5) * 0.0002, vy: -Math.random() * 0.00028 - 0.00006, sz: Math.random() * 1.3 + 0.5, br: Math.random() * 0.12 + 0.03 });

    this._pulses = [];
    this._pulseT = 0;
    this._comets = [{ shell: 0, u: 0, v: 0.055, tail: [] }, { shell: 4, u: 0.5, v: -0.085, tail: [] }, { shell: 8, u: 0.2, v: 0.11, tail: [] }];

    this._burstE = 0;
    let t = 0, energy = 1, rot = 0;
    const base = 1;

    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      const ctx = this._ctx; if (!ctx) return;
      const W = this._W, H = this._H, sprite = this._sprite;

      let cx = W * 0.5, cy = H * 0.52, maxR = Math.min(W, H) * 0.3;
      const nz = this.nucleusRef.current, cv = this.canvasRef.current;
      if (nz && cv) {
        const cvRect = cv.getBoundingClientRect(), r = nz.getBoundingClientRect();
        cx = r.left - cvRect.left + r.width / 2;
        cy = r.top - cvRect.top + r.height / 2;
        maxR = Math.min(r.width, r.height) * 0.34;
      }

      const phase = this.state.phase;
      const targetE = (phase === 'thinking' || this.state.listening || this.state.booting) ? base * 1.55 : (phase === 'responding' ? base * 1.25 : base);
      energy += (targetE - energy) * 0.05;
      this._burstE *= 0.945;
      const displayE = energy + base * this._burstE * 1.5;
      const sf = displayE / base;
      t += 0.0075 * sf;
      rot += 0.0007 * sf;

      const beat = Math.pow(Math.max(0, Math.sin(t * 1.15)), 8) * 0.05 + Math.pow(Math.max(0, Math.sin(t * 1.15 + 0.5)), 12) * 0.035;
      const breath = 1 + 0.03 * Math.sin(t * 0.55) + beat;

      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(3,7,17,0.3)';
      ctx.fillRect(0, 0, W, H);

      ctx.globalCompositeOperation = 'lighter';
      const { r, g, b } = this._hexToRgb(ACCENT);
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 2.1 * breath);
      halo.addColorStop(0, `rgba(${r},${g},${b},${0.055 * sf})`);
      halo.addColorStop(0.5, `rgba(${r},${g},${b},${0.02 * sf})`);
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(cx - maxR * 2.4, cy - maxR * 2.4, maxR * 4.8, maxR * 4.8);

      this._pulseT += 0.0075 * sf;
      const interval = 4.4 / sf;
      if (this._pulseT > interval) { this._pulseT = 0; this._pulses.push({ r: 0.12, life: 1 }); }
      this._pulses = this._pulses.filter((pl) => pl.life > 0);
      this._pulses.forEach((pl) => {
        pl.r += 0.0055 * sf; pl.life -= 0.006 * sf;
        const RR = maxR * breath * (0.16 + pl.r * 2.2);
        ctx.beginPath();
        for (let i = 0; i <= 6; i++) {
          const th = (i / 6) * Math.PI * 2 + rot;
          const x = cx + Math.cos(th) * RR, y = cy + Math.sin(th) * RR;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.14 * pl.life * pl.life * sf})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      });

      this._amb.forEach((a) => {
        a.x += a.vx; a.y += a.vy;
        if (a.x < 0) a.x += 1; if (a.x > 1) a.x -= 1;
        if (a.y < 0) a.y += 1;
        ctx.globalAlpha = a.br;
        const s = a.sz * 3;
        ctx.drawImage(sprite, a.x * W - s / 2, a.y * H - s / 2, s, s);
      });

      const unit = maxR * breath;
      const shells = [
        { sides: 6, rho: 1.0, spin: rot, ax: t * 0.10, ay: t * 0.13, a: 0.30, lw: 1.1 },
        { sides: 6, rho: 0.91, spin: -rot * 1.1, ax: -t * 0.12 + 0.5, ay: t * 0.11 + 2.6, a: 0.14, lw: 0.7 },
        { sides: 5, rho: 0.82, spin: rot * 1.3, ax: t * 0.15 + 1.1, ay: -t * 0.10 + 0.6, a: 0.18, lw: 0.8 },
        { sides: 6, rho: 0.73, spin: -rot * 1.5, ax: -t * 0.09 + 3.3, ay: t * 0.14 + 4.4, a: 0.13, lw: 0.7 },
        { sides: 3, rho: 0.62, spin: rot * 1.8, ax: t * 0.17 + 2.4, ay: -t * 0.12 + 1.9, a: 0.22, lw: 0.9 },
        { sides: 4, rho: 0.53, spin: -rot * 2.0, ax: -t * 0.13 + 5.0, ay: -t * 0.09 + 2.1, a: 0.15, lw: 0.7 },
        { sides: 4, rho: 0.44, spin: -rot * 2.3, ax: -t * 0.11 + 0.7, ay: -t * 0.16 + 3.2, a: 0.18, lw: 0.8 },
        { sides: 3, rho: 0.36, spin: rot * 2.6, ax: t * 0.18 + 4.7, ay: t * 0.12 + 1.3, a: 0.20, lw: 0.8 },
        { sides: 5, rho: 0.27, spin: rot * 3.0, ax: t * 0.20 + 4.0, ay: t * 0.15 + 5.1, a: 0.26, lw: 0.9 },
        { sides: 3, rho: 0.19, spin: -rot * 3.4, ax: -t * 0.22 + 2.0, ay: -t * 0.18 + 3.8, a: 0.30, lw: 1.0 },
      ];
      shells.forEach((sh) => {
        ctx.beginPath();
        const R = unit * sh.rho;
        for (let i = 0; i <= sh.sides; i++) {
          const th = (i / sh.sides) * Math.PI * 2 + sh.spin;
          const p3 = this._proj(Math.cos(th) * R, Math.sin(th) * R, 0, sh.ax, sh.ay, cx, cy, unit);
          if (i === 0) ctx.moveTo(p3.x, p3.y); else ctx.lineTo(p3.x, p3.y);
        }
        ctx.strokeStyle = `rgba(${r},${g},${b},${sh.a * sf})`;
        ctx.lineWidth = sh.lw;
        ctx.stroke();
        for (let i = 0; i < sh.sides; i++) {
          const th = (i / sh.sides) * Math.PI * 2 + sh.spin;
          const p3 = this._proj(Math.cos(th) * R, Math.sin(th) * R, 0, sh.ax, sh.ay, cx, cy, unit);
          const s = (7 + 4 * (sf - 1)) * p3.k;
          ctx.globalAlpha = Math.min(1, 0.5 * sf * p3.k);
          ctx.drawImage(sprite, p3.x - s / 2, p3.y - s / 2, s, s);
        }
        ctx.globalAlpha = 1;
      });

      const outer = shells[0];
      for (let i = 0; i < 6; i++) {
        const th = (i / 6) * Math.PI * 2 + outer.spin;
        const R = unit * outer.rho;
        const pOut = this._proj(Math.cos(th) * R, Math.sin(th) * R, 0, outer.ax, outer.ay, cx, cy, unit);
        const pIn = this._proj(Math.cos(th) * R * 0.16, Math.sin(th) * R * 0.16, 0, outer.ax, outer.ay, cx, cy, unit);
        ctx.beginPath();
        ctx.moveTo(pIn.x, pIn.y);
        ctx.lineTo(pOut.x, pOut.y);
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.07 * sf})`;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }

      this._soul.forEach((p) => {
        p.th += p.drift * sf;
        const sh = shells[p.shell];
        const R = unit * p.rho * this._polyR(p.th, p.sides, 0);
        const p3 = this._proj(Math.cos(p.th + sh.spin) * R, Math.sin(p.th + sh.spin) * R, 0, sh.ax, sh.ay, cx, cy, unit);
        const s = p.sz * (2.2 + 1.4 * (sf - 1)) * p3.k;
        ctx.globalAlpha = Math.min(1, p.br * (0.75 + 0.5 * (sf - 1)) * (0.55 + 0.45 * p3.k));
        ctx.drawImage(sprite, p3.x - s / 2, p3.y - s / 2, s, s);
      });

      this._comets.forEach((cm) => {
        const sh = shells[cm.shell]; if (!sh) return;
        cm.u = (cm.u + cm.v * 0.01 * sf + 1) % 1;
        const pt = this._edgePoint(sh, cm.u, unit, cx, cy);
        cm.tail.unshift({ x: pt.x, y: pt.y, k: pt.k });
        if (cm.tail.length > 14) cm.tail.pop();
        cm.tail.forEach((tp, i) => {
          const fade = (1 - i / cm.tail.length);
          const s = (5.5 + 3 * (sf - 1)) * tp.k * fade;
          ctx.globalAlpha = Math.min(1, 0.85 * fade * fade * sf);
          ctx.drawImage(sprite, tp.x - s / 2, tp.y - s / 2, s, s);
        });
        ctx.globalAlpha = 1;
      });

      for (let k = 0; k < 5; k++) {
        const p = this._soul[(Math.floor(t * 60) * 7 + k * 91) % this._soul.length];
        const sh = shells[p.shell];
        const R = unit * p.rho * this._polyR(p.th, p.sides, 0);
        const p3 = this._proj(Math.cos(p.th + sh.spin) * R, Math.sin(p.th + sh.spin) * R, 0, sh.ax, sh.ay, cx, cy, unit);
        const fl = (Math.sin(t * 9 + k * 2.3) + 1) / 2;
        const s = 6 * p3.k * fl;
        ctx.globalAlpha = Math.min(1, 0.7 * fl * sf);
        ctx.drawImage(sprite, p3.x - s / 2, p3.y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;

      const Rc = maxR * 0.13 * breath * (1 + (sf - 1) * 0.5);
      const axc = -t * 0.22, ayc = t * 0.28;
      const vtx = [[Rc, 0, 0], [-Rc, 0, 0], [0, Rc, 0], [0, -Rc, 0], [0, 0, Rc], [0, 0, -Rc]].map((v) => this._proj(v[0], v[1], v[2], axc, ayc, cx, cy, unit));
      const edges = [[0, 2], [2, 1], [1, 3], [3, 0], [0, 4], [2, 4], [1, 4], [3, 4], [0, 5], [2, 5], [1, 5], [3, 5]];
      ctx.beginPath();
      edges.forEach((e) => { ctx.moveTo(vtx[e[0]].x, vtx[e[0]].y); ctx.lineTo(vtx[e[1]].x, vtx[e[1]].y); });
      ctx.strokeStyle = `rgba(${Math.min(r + 110, 255)},${Math.min(g + 90, 255)},${Math.min(b + 60, 255)},${0.7 * sf})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      const heart = maxR * 0.16 * breath * (1 + (sf - 1) * 0.6);
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, heart * 2.4);
      core.addColorStop(0, `rgba(${Math.min(r + 130, 255)},${Math.min(g + 110, 255)},${Math.min(b + 80, 255)},${0.5 * sf})`);
      core.addColorStop(0.4, `rgba(${r},${g},${b},${0.22 * sf})`);
      core.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = core;
      ctx.globalAlpha = 1;
      ctx.fillRect(cx - heart * 2.4, cy - heart * 2.4, heart * 4.8, heart * 4.8);

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };
    loop();
  }

  _burst() { this._burstE = 1; }

  featureTap(msg) {
    clearTimeout(this._t1); clearTimeout(this._t2);
    this._burst();
    this.setState({ phase: 'responding', response: msg, value: '', listening: false });
    this._t2 = setTimeout(() => this.setState({ phase: 'idle', response: '' }), 6500);
  }

  openModule(ref, label, path, navState) {
    if (this.state.opening) return;
    clearTimeout(this._t1); clearTimeout(this._t2);
    this._burst();
    const r = ref && ref.current ? ref.current.getBoundingClientRect() : null;
    this.setState({ opening: { label, path }, phase: 'idle', response: '', listening: false }, () => {
      const el = this.openRef.current;
      const start = r || { left: window.innerWidth / 2 - 150, top: window.innerHeight / 2 - 55, width: 300, height: 110 };
      if (el && el.animate) {
        el.animate([
          { left: `${start.left}px`, top: `${start.top}px`, width: `${start.width}px`, height: `${start.height}px` },
          { left: '0px', top: '0px', width: `${window.innerWidth}px`, height: `${window.innerHeight}px` },
        ], { duration: 680, easing: 'cubic-bezier(.72,0,.2,1)', fill: 'both', delay: 200 });
      }
      this._navT = setTimeout(() => this.props.navigate(path, navState ? { state: navState } : undefined), 1350);
    });
  }

  // Reconnaissance vocale (Web Speech API, fr-FR) : transcription live dans le champ.
  // La fin d'écoute est déclenchée par NOUS (silence de ~2,2 s ou re-clic sur le bouton)
  // plutôt que par l'événement `onend` du navigateur, qui n'est pas fiable partout
  // (sur Safari iOS notamment, la reconnaissance peut ne jamais s'arrêter seule).
  toggleListen = () => {
    if (this.state.listening) { this._finishListening(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    this._warmupSpeech();
    this.setState({ listening: true, phase: 'idle', response: '', value: '' });
    // La plupart des navigateurs (Chrome en tête) n'autorisent qu'UNE session de
    // reconnaissance active à la fois, même entre deux instances distinctes : si on
    // relance trop vite après la fin de la précédente, le démarrage échoue en silence.
    // On laisse un court délai de sécurité au navigateur pour bien libérer la session.
    const wait = Math.max(0, 400 - (Date.now() - this._lastRecEnd));
    this._recStartT = setTimeout(() => this._startRecognition(SR), wait);
  };

  _startRecognition(SR) {
    const rec = new SR();
    this._rec = rec;
    this._recActive = true;
    this._finalTranscript = '';
    this._recError = null;
    rec.lang = 'fr-FR';
    // Safari iOS gère très mal le mode continu (résultats jamais délivrés) : on le
    // désactive sur iOS, où la reconnaissance s'arrête d'elle-même en fin de phrase.
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
    rec.continuous = !isIOS;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) this._finalTranscript += t; else interim += t;
      }
      this.setState({ value: (this._finalTranscript + interim).trim() });
      if (!this._recActive) return; // résultat tardif pendant la clôture : on accumule sans relancer de minuteur
      clearTimeout(this._silenceT);
      this._silenceT = setTimeout(() => this._finishListening(), 2200);
    };
    rec.onerror = (e) => { this._recError = e.error; this._finishListening(); };
    rec.onend = () => this._finishListening();
    clearTimeout(this._silenceT);
    this._silenceT = setTimeout(() => this._finishListening(), 7000); // délai de grâce si aucun son n'est capté
    try {
      rec.start();
    } catch {
      this._recActive = false; this._rec = null;
      this.setState({ listening: false });
      this._showAnswer(null, 'liaison vocale indisponible — réessaie dans un instant');
    }
  }

  _finishListening = () => {
    clearTimeout(this._recStartT);
    if (!this._recActive) {
      // Annulation pendant le court délai de sécurité, avant même le démarrage réel.
      if (this.state.listening) this.setState({ listening: false });
      return;
    }
    this._recActive = false;
    clearTimeout(this._silenceT);
    const rec = this._rec;
    this._rec = null;
    let concluded = false;
    const conclude = () => {
      if (concluded) return;
      concluded = true;
      clearTimeout(this._finishT);
      this._lastRecEnd = Date.now();
      this.setState({ listening: false });
      const text = (this._finalTranscript || this.state.value || '').trim();
      const err = this._recError;
      if (text) { this.submit(text); return; }
      // 'no-speech' = silence normal (notre propre minuteur), 'aborted' = annulation volontaire.
      if (err && err !== 'no-speech' && err !== 'aborted') this._showAnswer(null, `liaison vocale interrompue (${err}) — réessaie`);
    };
    if (!rec) { conclude(); return; }
    // stop() et non abort() : Safari iOS ne délivre souvent la transcription finale
    // qu'APRÈS l'arrêt. On laisse ~900 ms aux derniers résultats avant de conclure.
    rec.onend = conclude;
    try { rec.stop(); } catch { conclude(); return; }
    this._finishT = setTimeout(conclude, 900);
  };

  toggleVoiceReply = () => {
    const v = !this.state.voiceReply;
    this.setState({ voiceReply: v });
    try { localStorage.setItem('oracleVoiceReply', v ? '1' : '0'); } catch { /* noop */ }
    if (v) this._warmupSpeech();
    else this._stopSpeech();
  };

  // iOS n'autorise la lecture programmatique (voix système ou <audio>) que dans la
  // foulée d'un geste utilisateur : on débloque les deux pistes ici (une énonciation
  // vide + un clip audio silencieux), pour que la lecture async de la réponse marche.
  _warmupSpeech() {
    const synth = window.speechSynthesis;
    if (synth) { synth.cancel(); synth.speak(new SpeechSynthesisUtterance('')); }
    if (!this._audioEl) this._audioEl = new Audio();
    const a = this._audioEl;
    // CRUCIAL : purger les handlers de la lecture précédente. Sinon le onended de la
    // dernière réponse (qui ferme la modale et invalide la requête en cours via closeAsk)
    // se redéclencherait à la fin de ce clip silencieux et tuerait la commande suivante.
    a.onended = null;
    a.onerror = null;
    a.src = SILENT_WAV;
    a.play().catch(() => { /* ignoré : au pire on retombera sur la voix système */ });
  }

  _stopSpeech() {
    if (this._audioEl) { try { this._audioEl.pause(); } catch { /* noop */ } }
    window.speechSynthesis?.cancel();
  }

  // Voix OpenAI TTS en priorité (naturelle, gère bien la ponctuation) ; repli sur la
  // voix système du navigateur si la synthèse échoue ou n'est pas configurée.
  _speak(text, onDone) {
    const clean = (text || '').replace(/[*_`#]/g, '').trim();
    if (!clean) { if (onDone) onDone(); return; }
    this._stopSpeech();
    synthesizeSpeech(clean).then((blob) => {
      if (blob) {
        if (!this._audioEl) this._audioEl = new Audio();
        const audio = this._audioEl;
        const url = URL.createObjectURL(blob);
        const cleanup = () => { audio.onended = null; audio.onerror = null; URL.revokeObjectURL(url); if (onDone) onDone(); };
        audio.onended = cleanup;
        audio.onerror = cleanup;
        audio.src = url;
        audio.play().catch(() => this._speakBrowser(clean, onDone));
      } else {
        this._speakBrowser(clean, onDone);
      }
    });
  }

  _speakBrowser(text, onDone) {
    const synth = window.speechSynthesis;
    if (!synth) { if (onDone) onDone(); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR';
    const voice = synth.getVoices().find((v) => v.lang && v.lang.startsWith('fr'));
    if (voice) u.voice = voice;
    if (onDone) { u.onend = onDone; u.onerror = onDone; }
    synth.speak(u);
  }

  // La réponse reste affichée tant que l'utilisateur ne la ferme pas lui-même, sauf si
  // la lecture vocale est activée : dans ce cas elle se ferme automatiquement dès que
  // la dictée est terminée (pas de minuteur arbitraire).
  _showAnswer(reply, errorText) {
    this.setState({ phase: 'idle', asking: 'answered', answer: reply || null, askError: errorText || null });
    if (reply && this.state.voiceReply) this._speak(reply, () => this.closeAsk());
  }

  // Tronque l'historique en gardant des tours complets : il doit commencer par un vrai
  // message utilisateur (texte), jamais par un tool_result orphelin, sinon l'API rejette
  // toute la conversation suivante.
  _commitHistory(convo) {
    const h = convo.slice(-10);
    while (h.length && !(h[0].role === 'user' && typeof h[0].content === 'string')) h.shift();
    this._history = h;
  }

  async submit(text) {
    text = (text || '').trim(); if (!text) return;
    clearTimeout(this._t1); clearTimeout(this._t2);
    this._burst();
    try { this._rec?.abort(); } catch { /* noop */ }
    if (this.state.voiceReply) this._warmupSpeech();
    const seq = ++this._askSeq;
    this.setState({ value: '', phase: 'thinking', listening: false, response: '', asking: 'thinking', askQuestion: text, answer: null, askError: null });

    const toolSchemas = this.TOOLS.map(({ run, ...schema }) => schema);
    const convo = [...this._history, { role: 'user', content: text.slice(0, 4000) }];

    // Boucle d'outils : Claude peut enchaîner plusieurs actions (ex: ajouter une séance
    // PUIS une tâche) avant de rendre sa réponse finale en texte.
    for (let round = 0; round < 5; round++) {
      const res = await askOracle(convo, toolSchemas);
      if (seq !== this._askSeq) return;
      if (res?.error || !res?.content) { this._showAnswer(null, res?.error || 'liaison interrompue — réessaie'); return; }

      if (res.toolUse) {
        const { id, name, input } = res.toolUse;
        const tool = this.TOOLS.find((t) => t.name === name);
        const result = tool ? await tool.run(input) : { ok: false, error: 'Outil inconnu' };
        if (seq !== this._askSeq) return;

        if (name === 'ouvrir_module') {
          // openModule() affiche déjà sa propre confirmation visuelle (fichier en ouverture) et
          // on ne renvoie pas de tool_result ici : on ne garde donc PAS ce tour dans l'historique,
          // sinon Claude verrait un tool_use sans tool_result et rejetterait la commande suivante.
          this.setState({ asking: false, askQuestion: '', answer: null, askError: null });
          return;
        }

        convo.push({ role: 'assistant', content: res.content });
        convo.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: JSON.stringify(result) }] });
        continue;
      }

      convo.push({ role: 'assistant', content: res.content });
      this._commitHistory(convo);
      if (!res.reply) { this._showAnswer(null, 'réponse vide — réessaie'); return; }
      this._showAnswer(res.reply, null);
      return;
    }
    this._showAnswer(null, "séquence d'actions trop longue — réessaie en découpant la demande");
  }

  closeAsk() {
    this._askSeq += 1;
    clearTimeout(this._t2);
    this._stopSpeech();
    this.setState({ asking: false, askQuestion: '', answer: null, askError: null });
  }

  render() {
    const d = new Date();
    const h = d.getHours();
    const word = (h < 5 || h >= 22) ? 'Bonne nuit' : (h < 18 ? 'Bonjour' : 'Bonsoir');
    const bootLines = this.state.booting ? STATUS_LINES.slice(0, this.state.bootStep) : [];

    let subLine, statusWord = 'EN LIGNE';
    if (this.state.listening) { subLine = 'À l’écoute…'; statusWord = 'ÉCOUTE'; }
    else if (this.state.phase === 'thinking') { subLine = '▸ analyse…'; statusWord = 'CALCUL'; }
    else if (this.state.phase === 'responding') subLine = this.state.response;
    else if (this.state.booting && this.state.bootStep < 4) { subLine = 'Initialisation des systèmes…'; statusWord = 'DÉMARRAGE'; }
    else subLine = 'Tous les systèmes sont opérationnels. En attente d’instructions.';

    if (this.state.asking === 'answered') statusWord = 'RÉPONSE';
    if (this.state.opening) { subLine = `Ouverture du fichier — ${this.state.opening.label}…`; statusWord = 'ACCÈS'; }

    const { taskSummary, nextSession } = this.state;
    const modules = [
      { label: 'SANTÉ', num: '01', value: 'Énergie 82 %', sub: 'sommeil 7 h 20', ref: this.santeRef, tap: () => this.openModule(this.santeRef, 'SANTÉ', '/sante') },
      { label: 'ENTRAÎNEMENT', num: '02', value: `${nextSession.groupe} · ${nextSession.jour}`, sub: '3 / 4 cette semaine', ref: this.trainRef, tap: () => this.openModule(this.trainRef, 'ENTRAÎNEMENT', '/entrainement') },
      { label: 'TÂCHES', num: '03', value: `${taskSummary.count} en cours`, sub: taskSummary.top || 'aucune tâche', ref: this.tachesRef, tap: () => this.openModule(this.tachesRef, 'TÂCHES', '/taches') },
      { label: 'AGENDA', num: '04', value: 'Calendrier séances', sub: 'historique & suivi', ref: this.agendaRef, tap: () => this.openModule(this.agendaRef, 'AGENDA', '/entrainement', { initialScreen: 'calendar' }) },
      { label: 'VEILLE MONDIALE', num: '05', value: 'Signaux en direct', sub: 'flux RSS + IA', ref: this.veilleRef, tap: () => this.openModule(this.veilleRef, 'VEILLE MONDIALE', '/veille') },
    ];
    const value = this.state.value;
    const onInput = (e) => this.setState({ value: e.target.value });
    const onSubmit = (e) => {
      e.preventDefault();
      // referme le clavier iOS (et son zoom éventuel) au moment de l'envoi
      e.currentTarget.querySelector('input')?.blur();
      this.submit(value);
    };
    const dateStr = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();

    return (
      <div ref={this.rootRef} onClick={() => { if (this.state.booting) this._skipBoot(); }} className={`home${this._retHome ? ' core-blur-in' : ''}`}>
        <canvas ref={this.canvasRef} className="home-canvas" />
        <div ref={this.nucleusRef} className="home-nucleus" />
        <div className="home-scanline" />
        <div className="home-tick tl" /><div className="home-tick tr" /><div className="home-tick bl" /><div className="home-tick br" />

        <div className="home-masthead">
          <div className="home-masthead-inner">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span className="home-brand">ORACLE</span>
              <span className="home-sub home-hide-mobile">SYS.CORE // V3</span>
            </div>
            <div className="home-status">
              <span><span className="home-dot" />{statusWord}</span>
              <span className="home-hide-mobile">{dateStr}</span>
              <span ref={this.clockRef} style={{ color: '#eaf5ff', fontWeight: 500 }}>{d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            </div>
          </div>
        </div>

        {!this.state.isMobile && (
          <div>
            <div className="home-greet">
              <div className="home-greet-title hdg">{word},<br /><span className="home-greet-name">{USER_NAME}</span></div>
              <div className="home-subline">{subLine}<span className="home-caret">_</span></div>
            </div>

            {this.state.booting && (
              <div className="home-boot">
                {bootLines.map((bl, i) => (
                  <div key={i} className="home-boot-line"><span style={{ color: 'var(--accent)' }}>▸</span><span>{bl}</span></div>
                ))}
              </div>
            )}

            {!this.state.booting && (
              <>
                {!this.state.asking && (
                  <>
                    <div className="home-rail">
                      <div className="home-rail-label">REGISTRE // {dateStr}</div>
                      {modules.filter((m) => m.label !== 'VEILLE MONDIALE').map((m) => (
                        <div key={m.label} ref={m.ref} onClick={m.tap} className="gcard">
                          <div className="gcard-top"><span>{m.label}</span><span>{m.num}</span></div>
                          <div className="gval">{m.value}</div>
                          <div className="gsub">{m.sub}</div>
                        </div>
                      ))}
                    </div>

                    {(() => {
                      const veille = modules.find((m) => m.label === 'VEILLE MONDIALE');
                      return veille && (
                        <div ref={veille.ref} onClick={veille.tap} className="gcard home-veille-card">
                          <div className="gcard-top"><span>{veille.label}</span><span>{veille.num}</span></div>
                          <div className="gval">{veille.value}</div>
                          <div className="gsub">{veille.sub}</div>
                        </div>
                      );
                    })()}
                  </>
                )}

                <div className="home-cmdbar">
                  <form onSubmit={onSubmit} className="home-cmdform">
                    <span style={{ color: 'var(--accent)', fontSize: 13 }}>▸</span>
                    <input value={value} onChange={onInput} placeholder={this.state.listening ? 'JE VOUS ÉCOUTE…' : 'ENTRER UNE COMMANDE'} />
                    {this._sttOK && (
                      <button type="button" onClick={this.toggleListen} title="Parler au lieu d'écrire" className={`home-vocal${this.state.listening ? ' on rec' : ''}`}>{this.state.listening ? 'ÉCOUTE…' : 'VOCAL'}</button>
                    )}
                    <button type="button" onClick={this.toggleVoiceReply} title="Lire les réponses à voix haute" className={`home-vocal${this.state.voiceReply ? ' on' : ''}`}>VOIX {this.state.voiceReply ? 'ON' : 'OFF'}</button>
                    <button type="submit" title="Envoyer" className="home-send">⏵</button>
                  </form>
                </div>
              </>
            )}
          </div>
        )}

        {this.state.isMobile && (
          <div className="home-mobile">
            <div style={{ animation: 'rise .9s ease both' }}>
              <div className="home-greet-title hdg" style={{ fontSize: 'clamp(26px,7.5vw,36px)' }}>{word},<br /><span className="home-greet-name">{USER_NAME}</span></div>
              <div className="home-subline" style={{ fontSize: 11.5, minHeight: '2.8em' }}>{subLine}<span className="home-caret">_</span></div>
            </div>
            <div className="home-mobile-spacer" />
            {this.state.booting && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {bootLines.map((bl, i) => (
                  <div key={i} className="home-boot-line" style={{ fontSize: 10.5 }}><span style={{ color: 'var(--accent)' }}>▸</span><span>{bl}</span></div>
                ))}
              </div>
            )}
            {!this.state.booting && (
              <div style={{ animation: 'rowIn .7s ease both', display: 'flex', flexDirection: 'column', gap: 11 }}>
                {!this.state.asking && (
                  <>
                    <div className="home-rail-label">REGISTRE</div>
                    {modules.map((m) => (
                      <div key={m.label} ref={m.ref} onClick={m.tap} className="gcard">
                        <div style={{ fontSize: 9, letterSpacing: '.26em', color: '#3d5a75' }}>{m.label}</div>
                        <div className="gval">{m.value}</div>
                        <div className="gsub">{m.sub}</div>
                      </div>
                    ))}
                  </>
                )}
                <form onSubmit={onSubmit} className="home-cmdform" style={{ marginTop: 14 }}>
                  <span style={{ color: 'var(--accent)', fontSize: 13 }}>▸</span>
                  <input value={value} onChange={onInput} placeholder={this.state.listening ? 'JE VOUS ÉCOUTE…' : 'ENTRER UNE COMMANDE'} />
                  {this._sttOK && (
                    <button type="button" onClick={this.toggleListen} title="Parler au lieu d'écrire" className={`home-vocal${this.state.listening ? ' on rec' : ''}`}>{this.state.listening ? '●' : 'VOCAL'}</button>
                  )}
                  <button type="button" onClick={this.toggleVoiceReply} title="Lire les réponses à voix haute" className={`home-vocal${this.state.voiceReply ? ' on' : ''}`}>♪</button>
                  <button type="submit" title="Envoyer" className="home-send">⏵</button>
                </form>
              </div>
            )}
          </div>
        )}

        {this.state.opening && (
          <div className="home-open-backdrop">
            <div ref={this.openRef} className="home-open-panel">
              <div className="home-open-corner tl" /><div className="home-open-corner tr" /><div className="home-open-corner bl" /><div className="home-open-corner br" />
              <div className="home-open-scan" />
              <div className="home-open-text">
                <div className="home-open-eyebrow">OUVERTURE DU FICHIER</div>
                <div className="home-open-label hdg">{this.state.opening.label}</div>
                <div className="home-open-status"><span className="home-open-dot" />DÉCRYPTAGE EN COURS</div>
              </div>
            </div>
          </div>
        )}

        {this.state.asking && (
          <div className="home-ask-backdrop" onClick={() => this.closeAsk()}>
            <div className="home-ask-panel" onClick={(e) => e.stopPropagation()}>
              <div className="home-open-eyebrow">ORACLE</div>
              <div className="home-ask-question">« {this.state.askQuestion} »</div>
              {this.state.asking === 'thinking' && (
                <div className="home-ask-thinking"><span className="home-open-dot" />ANALYSE EN COURS</div>
              )}
              {this.state.asking === 'answered' && (
                <div className={`home-ask-answer${this.state.askError ? ' err' : ''}`}>{this.state.askError || this.state.answer}</div>
              )}
              <button className="home-ask-close" onClick={() => this.closeAsk()}>FERMER</button>
            </div>
          </div>
        )}

      </div>
    );
  }
}

export default function Home() {
  const navigate = useNavigate();
  return <HomeCanvas navigate={navigate} />;
}
