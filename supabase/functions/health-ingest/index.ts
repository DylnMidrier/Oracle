// Edge Function : point d'entrée pour l'automatisation iOS (Raccourcis) qui envoie
// les métriques Apple Watch / AutoSleep du jour. Authentification par jeton statique
// (secret HEALTH_API_TOKEN), pas de vérification JWT Supabase — appelée par un
// Raccourci iOS, pas par le client de l'app.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function fr(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isNaN(n) ? undefined : n;
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

  // AutoSleep envoie `sleep` comme un objet JSON stringifié
  let autoSleep: Record<string, string> = {};
  if (typeof body.sleep === 'string' && body.sleep.trim().startsWith('{')) {
    try { autoSleep = JSON.parse(body.sleep); } catch { /* ignore */ }
  }

  const fields = {
    sleep_hours: fr(body.sleepHours),
    sleep_start: body.sleepStart ? String(body.sleepStart) : null,
    sleep_end: body.sleepEnd ? String(body.sleepEnd) : null,
    sleep_score: fr(autoSleep['Étoiles']),
    sleep_evaluation: autoSleep['Évaluation'] ? String(autoSleep['Évaluation']) : null,
    heart_rate_resting: fr(autoSleep['BPM']),
    heart_rate_day: fr(body.heartRate),
    heart_rate_min: fr(body.heartRateMin) ?? fr(autoSleep['BPMauréveildebas']),
    heart_rate_max: fr(body.heartRateMax),
    hrv: fr(body.hrv) ?? fr(autoSleep['VFC']),
    hrv_baseline: fr(autoSleep['VFCdebase']),
    steps: fr(body.steps),
    active_calories: fr(body.activeCalories),
    exercise_minutes: fr(body.exerciseMinutes),
    stand_hours: fr(body.standHours),
    spo2: fr(body.spo2),
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
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
