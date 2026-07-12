import { supabase, supabaseReady } from './supabase.js';

const PRI_ORDER = { p1: 0, p2: 1, p3: 2 };

export async function fetchTasks() {
  if (!supabaseReady) return [];
  const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: true });
  if (error || !data) return [];
  return data;
}

// Tâches actives (non closes), triées par priorité puis échéance — pour le tool
// vocal gerer_taches (lister / clore).
export async function fetchActiveTasks() {
  if (!supabaseReady) return [];
  const { data, error } = await supabase.from('tasks').select('*').neq('status', 'clos');
  if (error || !data) return [];
  return [...data].sort((a, b) => {
    const p = PRI_ORDER[a.priority] - PRI_ORDER[b.priority];
    if (p) return p;
    return new Date(a.due_at || 8.64e15) - new Date(b.due_at || 8.64e15);
  });
}

export async function fetchTaskSummary() {
  if (!supabaseReady) return { count: 0, top: null };
  const { data, error } = await supabase.from('tasks').select('title, priority').neq('status', 'clos');
  if (error || !data) return { count: 0, top: null };
  const sorted = [...data].sort((a, b) => PRI_ORDER[a.priority] - PRI_ORDER[b.priority]);
  return { count: data.length, top: sorted[0]?.title || null };
}

export async function createTask({ title, category, priority, dueAt, note }) {
  if (!supabaseReady) return { data: null, error: 'Supabase non configuré' };
  const { data, error } = await supabase.from('tasks').insert({
    title,
    category: category || null,
    priority: ['p1', 'p2', 'p3'].includes(priority) ? priority : 'p3',
    due_at: dueAt || null,
    note: note || null,
  }).select().single();
  return { data: data || null, error: error?.message || null };
}

export async function updateTaskStatus(id, status) {
  if (!supabaseReady) return;
  await supabase.from('tasks').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
}

export async function updateTaskSubs(id, subs) {
  if (!supabaseReady) return;
  await supabase.from('tasks').update({ subs, updated_at: new Date().toISOString() }).eq('id', id);
}
