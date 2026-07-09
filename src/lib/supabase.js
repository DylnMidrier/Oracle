import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabaseReady = Boolean(url && anonKey);

export const supabase = supabaseReady ? createClient(url, anonKey) : null;
