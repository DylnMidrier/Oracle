// Edge Function : reçoit une question tapée dans la barre de commande de la Home
// et répond via Claude Sonnet. Appelée depuis le client via supabase.functions.invoke('ask-oracle').
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYSTEM_PROMPT =
  "Tu es Oracle, l'assistant personnel intégré à l'interface de Dylan. Réponds en français, de façon concise " +
  '(2 à 4 phrases sauf si on te demande explicitement plus de détails), sur un ton calme, direct, façon assistant ' +
  "de bord futuriste — sans emoji, sans formules creuses. Tu n'as pas d'accès en temps réel aux modules de " +
  "l'application (santé, entraînement, veille mondiale, tâches, agenda) : n'invente jamais de données précises " +
  'venant de ces modules si elles ne te sont pas explicitement fournies dans la question.';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { message } = await req.json();
    if (!message || typeof message !== 'string' || !message.trim()) {
      return new Response(JSON.stringify({ error: 'Message manquant' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: message.slice(0, 4000) }],
      }),
    });

    const json = await res.json();
    const block = json.content?.[0];
    const reply = block && block.type === 'text' ? block.text : null;

    if (!reply) {
      return new Response(JSON.stringify({ error: json.error?.message || "Réponse invalide de l'API" }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ reply }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
