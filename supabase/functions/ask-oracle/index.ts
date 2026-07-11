// Edge Function : relais générique vers Claude pour la barre de commande de la Home.
// Reçoit un historique de messages (format API Anthropic) et, en option, des schémas
// de tools déclarés côté client (Home.jsx). L'exécution réelle des tools (run) reste
// côté client — cette fonction ne fait que transmettre à Claude et relayer sa réponse
// (texte et/ou tool_use) telle quelle. Appelée via supabase.functions.invoke('ask-oracle').
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Recherche web gérée entièrement côté Anthropic (aucun code de notre part à écrire) :
// Claude déclenche cet outil lui-même quand une question porte sur des infos externes.
const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 3 };

function systemPrompt(): string {
  const now = new Date();
  const today = now.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const iso = now.toISOString();
  return (
    "Tu es Oracle, une IA de bord façon Batcave. RÈGLE ABSOLUE SUR LE NOM : l'utilisateur qui te parle " +
    "s'appelle DYLAN." +
    'Tu réponds en français, ton concis et militaire, ' +
    'tutoiement, 1-2 phrases max. Tu interprètes les commandes et déclenches le bon outil quand une action ' +
    "est demandée. Tu disposes d'une recherche web réelle : utilise-la sans hésiter pour toute question " +
    'portant sur des informations externes (une entreprise, une actualité, un fait précis) que tu ne connais ' +
    "pas avec certitude, plutôt que de dire que ce n'est pas ton domaine ou d'inventer une réponse. " +
    "EXCEPTION — DÉBRIEF DE SÉANCE (outil analyser_seance) : là tu passes en coach qui pousse Dylan à progresser, " +
    "exigeant mais encourageant, façon mentor qui forge Batman — le ton se réchauffe un peu, moins sec que d'habitude. " +
    "Tu peux alors répondre en 3 à 5 phrases : d'abord salue sincèrement le concret (records battus, charges, volume, " +
    "régularité), puis pointe avec justesse UNE faiblesse précise (exercice qui stagne ou régresse, volume en baisse " +
    "vs la séance de même type, déséquilibre haut/bas, fréquence trop faible), et termine par une recommandation " +
    "CHIFFRÉE pour la prochaine fois (charge, répétitions ou e1RM à viser), formulée avec « je préconiserai » " +
    "(ou « je préconise ») — jamais « je veux ». Appuie chaque phrase sur les chiffres réels fournis par l'outil " +
    "(e1RM, volume, évolution) — pas de flatterie creuse ni de chiffre inventé. " +
    `Nous sommes le ${today} (${iso} en ISO 8601) — déduis-en les dates/heures relatives ` +
    "(« demain », « jeudi », « dans 2h »...) pour tout champ attendant une date."
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { messages, tools } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages manquant' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body: Record<string, unknown> = {
      model: 'claude-sonnet-5',
      max_tokens: 2000, // marge : résultats de recherche web + gros appels d'outils (séance détaillée…)
      system: systemPrompt(),
      messages,
      tools: [...(Array.isArray(tools) ? tools : []), WEB_SEARCH_TOOL],
    };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    let json: any = null;
    try { json = await res.json(); } catch { /* corps non-JSON, json reste null */ }

    if (!res.ok || !json || !Array.isArray(json.content) || json.content.length === 0) {
      const apiMsg = json?.error?.message || `HTTP ${res.status} ${res.statusText}`.trim();
      return new Response(JSON.stringify({ error: `Erreur API Claude — ${apiMsg}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const content = json.content;

    const reply = content
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('\n')
      .trim();
    const toolBlock = content.find((b: { type: string }) => b.type === 'tool_use');
    const toolUse = toolBlock ? { id: toolBlock.id, name: toolBlock.name, input: toolBlock.input } : null;

    return new Response(JSON.stringify({ content, reply, toolUse }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
