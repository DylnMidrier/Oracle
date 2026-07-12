import { supabase, supabaseReady } from './supabase.js';

// Résumé léger de l'entraînement pour la Home et le tool statut_systeme : dernière
// séance, jours écoulés depuis, décompte de la semaine en cours (base lundi) et type
// de séance conseillé (alternance upper/lower, protocole de l'app).

function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export async function fetchWorkoutLogs() {
  if (!supabaseReady) return [];
  const { data, error } = await supabase
    .from('workout_logs')
    .select('session_key, performed_on, data')
    .order('performed_on', { ascending: false });
  return error ? [] : (data || []);
}

export function trainingSummary(logs) {
  const sorted = [...(logs || [])].sort((a, b) => (a.performed_on < b.performed_on ? 1 : -1));
  const last = sorted[0] || null;
  const now = new Date();
  const daysSince = last ? Math.floor((now - new Date(last.performed_on + 'T12:00:00')) / 86400000) : null;

  const monday = mondayOf(now);
  const weekCount = sorted.filter((l) => new Date(l.performed_on + 'T12:00:00') >= monday).length;

  let nextLabel = null;
  if (last) {
    if (last.session_key === 'upper') nextLabel = 'LOWER';
    else if (last.session_key === 'lower') nextLabel = 'UPPER';
    else nextLabel = String(last.session_key).split('_')[0].toUpperCase();
  }

  return { last, daysSince, weekCount, weekTarget: 4, nextLabel };
}
