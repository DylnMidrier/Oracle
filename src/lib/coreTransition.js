import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export const RETURN_KEY = 'oracleReturn';

// Fermeture animée (portes) avant de revenir au noyau (Home).
export function useCoreClose() {
  const navigate = useNavigate();
  const [closing, setClosing] = useState(false);
  const timerRef = useRef(null);

  function goHome() {
    if (closing) return;
    setClosing(true);
    try { sessionStorage.setItem(RETURN_KEY, '1'); } catch { /* ignore */ }
    timerRef.current = setTimeout(() => navigate('/'), 480);
  }

  return { closing, goHome };
}

// Lecture non destructive : sûre à appeler plusieurs fois (StrictMode double-invoque
// le constructeur en dev), contrairement à un "consume" qui effacerait le flag avant
// la deuxième lecture et ferait rejouer le boot par erreur.
export function peekReturnFlag() {
  try { return !!sessionStorage.getItem(RETURN_KEY); } catch { return false; }
}

// À appeler une fois le composant monté (componentDidMount) : idempotent même si
// StrictMode rejoue le cycle de montage.
export function clearReturnFlag() {
  try { sessionStorage.removeItem(RETURN_KEY); } catch { /* ignore */ }
}
