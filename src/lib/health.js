import { supabase, supabaseReady } from './supabase.js';

// Renvoie le dernier enregistrement + jusqu'à 7 jours pour la tendance (ordre chronologique).
export async function fetchHealth() {
  if (!supabaseReady) return { latest: null, trend: [] };
  const { data, error } = await supabase
    .from('health_records')
    .select('*')
    .order('date', { ascending: false })
    .limit(7);
  if (error || !data?.length) return { latest: null, trend: [] };
  return { latest: data[0], trend: [...data].reverse() };
}

export function fmtSleep(hours) {
  if (hours == null) return '—';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return { h, m };
}

export function timeAgo(iso) {
  if (!iso) return '';
  const diffMin = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}
