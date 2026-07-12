-- Oracle — schéma Supabase pour le module Entraînement.
-- À exécuter dans l'éditeur SQL du projet Supabase (Database > SQL Editor).

create table if not exists workout_logs (
  id uuid primary key default gen_random_uuid(),
  session_key text not null, -- clé libre : séances upper/lower + séances créées par Oracle (ajouter_seance)
  performed_on date not null default current_date,
  overall_rpe int,
  data jsonb not null, -- { exercises: [{ name, sets: [{ reps, weight, checked }], rpe }] }
  created_at timestamptz not null default now()
);

create index if not exists workout_logs_performed_on_idx on workout_logs (performed_on desc);

-- MVP mono-utilisateur sans authentification : RLS désactivé.
-- À activer (avec des policies liées à auth.uid()) si l'app devient multi-utilisateur.
alter table workout_logs disable row level security;

-- Modèles de séance (Upper/Lower) : éditables via le picker d'exercices wger dans l'appli.
create table if not exists session_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique, -- clé libre : upper/lower + clés dynamiques des séances créées par Oracle
  meta jsonb not null, -- { name, tag, sub, glyph, dur }
  exercises jsonb not null, -- [{ name, note, target, prev, pr, rest, reps: [...], wgerId? }]
  updated_at timestamptz not null default now()
);

alter table session_templates disable row level security;

-- Seed initial (upper/lower) : voir src/data/sessions.js pour le contenu de référence,
-- ou dupliquer l'INSERT exécuté lors de la mise en place initiale de ce projet.

-- Veille mondiale : articles agrégés depuis les flux RSS et classifiés par Claude
-- (résumé, catégorie, urgence, région) via l'Edge Function supabase/functions/world-watch-refresh.
create table if not exists world_watch_articles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null,
  category text not null,
  urgency text not null check (urgency in ('normal', 'warning', 'critical')),
  region text,
  source text not null,
  url text not null unique,
  published_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists world_watch_articles_published_at_idx on world_watch_articles (published_at desc);

alter table world_watch_articles disable row level security;

-- L'Edge Function nécessite un secret ANTHROPIC_API_KEY (Dashboard Supabase >
-- Edge Functions > world-watch-refresh > Secrets, ou `supabase secrets set`).
--
-- Anti-doublons : la fonction écarte les articles déjà en base par URL (contrainte
-- unique ci-dessus) ET par titre normalisé (même sujet publié par plusieurs sources),
-- et purge en fin de run les articles dont published_at dépasse 30 heures.
--
-- Actualisation automatique horaire via pg_cron + pg_net (en plus du bouton ↻ de l'app) :
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net;
--   select cron.schedule(
--     'world-watch-hourly', '0 * * * *',
--     $job$ select net.http_post(
--       url := 'https://<project-ref>.supabase.co/functions/v1/world-watch-refresh',
--       headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <ANON_KEY>'),
--       body := '{}'::jsonb, timeout_milliseconds := 120000) $job$);
-- Retrait du job : select cron.unschedule('world-watch-hourly');
-- Historique d'exécution : select * from cron.job_run_details order by start_time desc;

-- Santé : métriques Apple Watch / AutoSleep reçues via l'automatisation iOS
-- (Raccourcis) qui POST sur l'Edge Function supabase/functions/health-ingest.
create table if not exists health_records (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  recorded_at timestamptz not null default now(),

  sleep_hours numeric,
  sleep_start text,
  sleep_end text,
  sleep_score numeric,
  sleep_evaluation text,

  heart_rate_resting int,
  heart_rate_day int,
  heart_rate_min int,
  heart_rate_max int,
  hrv numeric,
  hrv_baseline numeric,

  steps int,
  active_calories int,
  exercise_minutes int,
  stand_hours int,

  spo2 numeric,
  respiratory_rate numeric
);

create index if not exists health_records_date_idx on health_records (date desc);

alter table health_records disable row level security;

-- L'Edge Function nécessite un secret HEALTH_API_TOKEN (choisis une valeur
-- aléatoire, mets-la dans les secrets Supabase ET dans le header Authorization
-- du Raccourci iOS : "Bearer <valeur>").

-- Barre de commande de la Home : supabase/functions/ask-oracle relaie la question
-- à Claude Sonnet. Réutilise le même secret ANTHROPIC_API_KEY que world-watch-refresh
-- (les secrets Supabase sont partagés au niveau du projet, pas besoin de le redéfinir).

-- Tâches : module Tâches (vue 1B "objectif prioritaire" sur desktop, groupé par
-- priorité + tiroir sur mobile). Alimenté manuellement (quick-add dans l'appli) ou
-- via le tool vocal ajouter_tache (voir src/pages/Home.jsx).
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text,
  priority text not null default 'p3' check (priority in ('p1', 'p2', 'p3')),
  status text not null default 'attente' check (status in ('attente', 'cours', 'clos')),
  due_at timestamptz,
  note text,
  subs jsonb not null default '[]', -- [{ label, done }]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_status_idx on tasks (status);
alter table tasks disable row level security;

-- Lecture vocale des réponses d'Oracle : supabase/functions/tts appelle OpenAI TTS
-- (voix bien plus naturelle que les voix système du navigateur, utilisées en repli
-- si ce secret est absent ou que l'appel échoue). Nécessite un secret OPENAI_API_KEY
-- (Dashboard Supabase > Edge Functions > tts > Secrets, ou `supabase secrets set`).
