// Edge Function : synthèse vocale (OpenAI TTS) pour la lecture des réponses d'Oracle.
// Remplace les voix système du navigateur, souvent robotiques et qui lisent la
// ponctuation au lieu de marquer une pause. Reçoit { text }, renvoie un flux audio/mpeg.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { text } = await req.json();
    if (!text || typeof text !== 'string' || !text.trim()) {
      return new Response(JSON.stringify({ error: 'Texte manquant' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const clean = text.replace(/[*_`#]/g, '').trim().slice(0, 2000);

    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'tts-1', voice: 'onyx', input: clean, response_format: 'mp3' }),
    });

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        msg = j.error?.message || msg;
      } catch { /* corps non-JSON */ }
      return new Response(JSON.stringify({ error: `Erreur TTS — ${msg}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const buf = await res.arrayBuffer();
    return new Response(buf, { headers: { ...corsHeaders, 'Content-Type': 'audio/mpeg' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
