import { supabase, supabaseReady } from './supabase.js';

export async function askOracle(message) {
  if (!supabaseReady) return { error: 'Supabase non configuré' };
  const { data, error } = await supabase.functions.invoke('ask-oracle', { body: { message } });
  if (error) return { error: error.message || 'Échec de la requête' };
  return data;
}
