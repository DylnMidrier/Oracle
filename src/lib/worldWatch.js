import { supabase, supabaseReady } from './supabase.js';

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
