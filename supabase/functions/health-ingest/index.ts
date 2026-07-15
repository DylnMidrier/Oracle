// Edge Function : point d'entrée pour l'automatisation iOS (Raccourcis) qui envoie
// les métriques Apple Watch / AutoSleep du jour. Authentification par jeton statique
// (secret HEALTH_API_TOKEN), pas de vérification JWT Supabase — appelée par un
// Raccourci iOS, pas par le client de l'app.
//
// AutoSleep envoie ses données dans trois objets imbriqués :
//   readiness  → { Étoiles, Évaluation, BPM, VFC, VFCdebase, BPMauréveildebase }
//   sleepTime  → { Sommeil, Démarrer, Jusqu'a, Équilibre, Recharge%, ... }
//   anneaux    → { Sommeil%, Qualité, Profond, BPM, ... }  (non utilisé pour l'instant)
// Les clés peuvent contenir des espaces parasites, des apostrophes courbes ou une
// casse variable : la lecture est donc tolérante (voir `get`).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Nombre (accepte la virgule décimale française).
function fr(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isNaN(n) ? undefined : n;
}

// Colonnes entières : les moyennes/sommes d'Apple Santé arrivent souvent avec des
// décimales (FC moyenne 68,4 ; énergie active 512,7…). On arrondit pour éviter
// « invalid input syntax for type integer » côté Postgres.
function fri(v: unknown): number | undefined {
  const n = fr(v);
  return n == null ? undefined : Math.round(n);
}

// Entier borné dans [min, max] (ex. heures debout : max 24).
function frc(v: unknown, min: number, max: number): number | undefined {
  const n = fri(v);
  return n == null ? undefined : Math.min(max, Math.max(min, n));
}

// SpO2 : ramène en pourcentage lisible 0-100. Santé peut envoyer une fraction
// (0,966) ou une valeur sur-multipliée par le Raccourci (9663) — on normalise.
function spo2v(v: unknown): number | undefined {
  let n = fr(v);
  if (n == null) return undefined;
  if (n <= 1) n = n * 100;
  while (n > 100) n = n / 100;
  return Math.round(n * 10) / 10;
}

function str(v: unknown): string | null {
  return v == null || v === '' ? null : String(v);
}

// Extrait l'heure d'une date AutoSleep verbeuse ("mer. 15/07/26 2:08 AM" → "2:08 AM").
function hhmm(v: unknown): string | null {
  if (v == null || v === '') return null;
  const m = String(v).match(/\d{1,2}:\d{2}(?:\s*[AP]M)?/i);
  return m ? m[0].toUpperCase() : String(v);
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? v as Record<string, unknown> : {};
}

// Normalise une clé pour une comparaison tolérante (espaces parasites comme
// "Étoiles ", casse, apostrophes courbes vs droites).
function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/[‘’]/g, "'");
}

// Lit une clé dans un objet en tolérant les variations de format.
function get(obj: Record<string, unknown>, key: string): unknown {
  const target = normKey(key);
  const k = Object.keys(obj).find((x) => normKey(x) === target);
  return k === undefined ? undefined : obj[k];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== Deno.env.get('HEALTH_API_TOKEN')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const date = (body.date as string) ?? new Date().toISOString().slice(0, 10);

  const readiness = asObj(body.readiness); // Étoiles, Évaluation, BPM, VFC, VFCdebase…
  const sleepTime = asObj(body.sleepTime); // Sommeil (heures), Démarrer, Jusqu'a…

  const fields = {
    sleep_hours: fr(get(sleepTime, 'Sommeil')) ?? fr(body.sleepHours),
    sleep_start: hhmm(get(sleepTime, 'Démarrer') ?? body.sleepStart),
    sleep_end: hhmm(get(sleepTime, "Jusqu'a") ?? body.sleepEnd),
    sleep_score: fr(get(readiness, 'Étoiles')),
    sleep_evaluation: str(get(readiness, 'Évaluation')),
    heart_rate_resting: fri(get(readiness, 'BPM')),
    heart_rate_day: fri(body.heartRate),
    heart_rate_min: fri(body.heartRateMin) ?? fri(get(readiness, 'BPMauréveildebase')),
    heart_rate_max: fri(body.heartRateMax),
    hrv: fr(body.hrv) ?? fr(get(readiness, 'VFC')),
    hrv_baseline: fr(get(readiness, 'VFCdebase')),
    steps: fri(body.steps),
    active_calories: fri(body.activeCalories),
    exercise_minutes: fri(body.exerciseMinutes),
    stand_hours: frc(body.standHours, 0, 24),
    spo2: spo2v(body.spo2),
    respiratory_rate: fr(body.respiratoryRate),
  };

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data, error } = await supabase
      .from('health_records')
      .upsert({ date, recorded_at: new Date().toISOString(), ...fields }, { onConflict: 'date' })
      .select('id, date')
      .single();
    if (error) throw error;
    return new Response(JSON.stringify({ ok: true, ...data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    // Les erreurs Supabase/Postgres sont des objets ({ message, details, hint, code }),
    // pas des instances Error : String(err) donnerait "[object Object]" et masquerait la
    // cause. On sérialise proprement pour renvoyer un message exploitable.
    const detail =
      err instanceof Error ? err.message
      : (err && typeof err === 'object') ? JSON.stringify(err)
      : String(err);
    return new Response(JSON.stringify({ error: detail }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
