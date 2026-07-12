// Météo temps réel via Open-Meteo — API gratuite, sans clé, CORS ouvert.
// Position fixée sur Paris (pas de demande de géolocalisation au chargement).

const PARIS = { lat: 48.8566, lon: 2.3522 };

// Codes WMO (Open-Meteo) → libellé FR court + glyphe monochrome pour le HUD.
function wmoLabel(code) {
  const c = Number(code);
  if (c === 0) return { label: 'Ciel dégagé', icon: '☀' };
  if (c === 1 || c === 2) return { label: 'Partiellement nuageux', icon: '⛅' };
  if (c === 3) return { label: 'Couvert', icon: '☁' };
  if (c >= 45 && c <= 48) return { label: 'Brouillard', icon: '≈' };
  if (c >= 51 && c <= 57) return { label: 'Bruine', icon: '☂' };
  if (c >= 61 && c <= 67) return { label: 'Pluie', icon: '☂' };
  if (c >= 71 && c <= 77) return { label: 'Neige', icon: '❄' };
  if (c >= 80 && c <= 82) return { label: 'Averses', icon: '☂' };
  if (c >= 85 && c <= 86) return { label: 'Averses de neige', icon: '❄' };
  if (c >= 95) return { label: 'Orage', icon: '⚡' };
  return { label: '—', icon: '·' };
}

export async function fetchWeather() {
  try {
    const { lat, lon } = PARIS;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m'
      + '&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1';
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = await res.json();
    const cur = j.current || {};
    const { label, icon } = wmoLabel(cur.weather_code);
    return {
      temp: Math.round(cur.temperature_2m),
      feels: Math.round(cur.apparent_temperature),
      code: cur.weather_code,
      label,
      icon,
      wind: Math.round(cur.wind_speed_10m),
      max: j.daily ? Math.round(j.daily.temperature_2m_max[0]) : null,
      min: j.daily ? Math.round(j.daily.temperature_2m_min[0]) : null,
    };
  } catch {
    return null;
  }
}
