import { supabaseReady } from './supabase.js';

const URL_BASE = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Appel direct en fetch (plutôt que supabase.functions.invoke) : on veut un Blob audio
// binaire fiable, sans dépendre de la façon dont le SDK devine le type de la réponse.
export async function synthesizeSpeech(text) {
  if (!supabaseReady || !text) return null;
  try {
    const res = await fetch(`${URL_BASE}/functions/v1/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}
