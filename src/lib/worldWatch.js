import { supabase, supabaseReady } from './supabase.js';

// Décompte des signaux des dernières 48 h par urgence — pour la carte VEILLE et le
// tool statut_systeme de la Home (sans charger tout le flux).
export async function fetchWorldWatchSummary() {
  if (!supabaseReady) return { crit: 0, warn: 0, total: 0 };
  const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from('world_watch_articles')
    .select('urgency')
    .gte('published_at', since);
  if (error || !data) return { crit: 0, warn: 0, total: 0 };
  return {
    crit: data.filter((a) => a.urgency === 'critical').length,
    warn: data.filter((a) => a.urgency === 'warning').length,
    total: data.length,
  };
}

export async function fetchArticles() {
  if (!supabaseReady) return [];
  const { data, error } = await supabase
    .from('world_watch_articles')
    .select('*')
    .order('published_at', { ascending: false })
    .limit(200);
  return error ? [] : data;
}

export async function refreshWorldWatch() {
  if (!supabaseReady) return { error: 'Supabase non configuré' };
  const { data, error } = await supabase.functions.invoke('world-watch-refresh');
  if (error) return { error: error.message || 'Échec de la mise à jour' };
  return data;
}
