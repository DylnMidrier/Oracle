import { supabase, supabaseReady } from './supabase.js';

// messages : historique au format API Anthropic (role/content).
// tools : schémas de tools optionnels (name/description/input_schema), sans les "run" côté client.
export async function askOracle(messages, tools) {
  if (!supabaseReady) return { error: 'Supabase non configuré' };
  const { data, error } = await supabase.functions.invoke('ask-oracle', { body: { messages, tools } });
  if (error) {
    // Sur une réponse non-2xx, le SDK Supabase ne relaie pas le corps JSON de l'erreur
    // (juste un message générique type "non-2xx status code") : on va le relire à la main.
    let detail = error.message || 'Échec de la requête';
    if (error.context && typeof error.context.json === 'function') {
      try {
        const body = await error.context.json();
        if (body?.error) detail = body.error;
      } catch { /* corps illisible, on garde le message générique */ }
    }
    return { error: detail };
  }
  return data;
}
