// Profil physique de l'utilisateur (MVP mono-utilisateur) : sert aux barèmes de force
// (ratio charge / poids de corps). Persisté en localStorage — pas de table Supabase tant
// que l'app reste mono-utilisateur ; à migrer côté DB si l'app devient multi-compte.
import { useState } from 'react';

const KEY = 'oracleProfile';
const DEFAULT = { sex: 'homme', bodyweight: 83, age: 31, height: 183 };

export function loadProfile() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT, ...JSON.parse(raw) };
  } catch { /* localStorage indisponible / JSON invalide → valeurs par défaut */ }
  return { ...DEFAULT };
}

export function saveProfile(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* noop */ }
}

// Hook : [profil, update(patch)] — persiste à chaque modification.
export function useProfile() {
  const [profile, setProfile] = useState(loadProfile);
  const update = (patch) => setProfile((prev) => {
    const next = { ...prev, ...patch };
    saveProfile(next);
    return next;
  });
  return [profile, update];
}
