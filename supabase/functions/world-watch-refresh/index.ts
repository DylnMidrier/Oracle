// Edge Function : veille mondiale — récupère des flux RSS, fait classifier chaque
// nouvel article par Claude Haiku (résumé FR, catégorie, urgence, région), puis
// écrit le résultat dans la table world_watch_articles. Déclenchée à la demande
// depuis l'app via supabase.functions.invoke('world-watch-refresh').
import { createClient } from 'jsr:@supabase/supabase-js@2';

const FEEDS = [
  { url: 'https://www.lemonde.fr/rss/une.xml', name: 'Le Monde' },
  { url: 'https://www.lefigaro.fr/rss/figaro_actualites.xml', name: 'Le Figaro' },
  { url: 'http://feeds.bbci.co.uk/news/world/rss.xml', name: 'BBC World' },
  { url: 'https://feeds.reuters.com/reuters/topNews', name: 'Reuters' },
  { url: 'https://rsshub.app/apnews/topics/apf-topnews', name: 'AP News' },
];

const SYSTEM_PROMPT =
  "Tu es un système de veille neutre et factuel. Résume cet article en 2 phrases maximum, en français, sans opinion politique, sans biais. " +
  "Identifie la catégorie parmi : [Monde, France, Économie, Science, Alerte, Tech]. " +
  "Identifie la région géographique principale parmi : [Europe, France, Amérique du Nord, Amérique du Sud, Asie-Pacifique, Moyen-Orient, Afrique, Mondial]. " +
  "Identifie le niveau d'urgence selon ces critères stricts : " +
  "critical = événement majeur à impact immédiat (conflit armé, attentat, catastrophe naturelle, mort d'un dirigeant, crise géopolitique grave, effondrement économique, décision politique historique) ; " +
  "warning = développement significatif qui mérite attention (tension internationale, incident diplomatique, manifestation importante, accident grave, décision politique notable, alerte sanitaire, résultat électoral) ; " +
  "normal = actualité courante sans urgence particulière. " +
  "La majorité des articles d'actualité internationale et nationale doivent être classés warning ou critical — réserve normal uniquement pour les faits divers mineurs ou la culture. " +
  'Réponds uniquement en JSON strict, sans markdown : { "summary": string, "category": string, "urgency": string, "region": string }';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const results = await Promise.allSettled(FEEDS.map((f) => fetchFeed(f.url, f.name)));
    const rawArticles = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

    // Anti-doublons : on écarte les articles déjà en base — par URL ET par titre normalisé,
    // pour capter le même sujet publié par plusieurs sources sous des URL différentes — ainsi
    // que les doublons au sein d'un même run. La table étant bornée par la purge (voir plus
    // bas), charger toutes les URL/titres existants reste peu coûteux.
    const { data: existing } = await supabase
      .from('world_watch_articles')
      .select('url, title');
    const existingUrls = new Set((existing || []).map((r: { url: string }) => r.url));
    const existingTitles = new Set((existing || []).map((r: { title: string }) => normTitle(r.title)));

    const seenUrl = new Set<string>();
    const seenTitle = new Set<string>();
    // Plafond par run pour maîtriser le coût des appels Claude.
    const toProcess: RawArticle[] = [];
    for (const a of rawArticles) {
      if (toProcess.length >= 30) break;
      const nt = normTitle(a.title);
      if (!a.url || !nt) continue;
      if (seenUrl.has(a.url) || existingUrls.has(a.url)) continue;
      if (seenTitle.has(nt) || existingTitles.has(nt)) continue;
      seenUrl.add(a.url);
      seenTitle.add(nt);
      toProcess.push(a);
    }

    let inserted = 0;
    const CONCURRENCY = 5;
    for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
      const batch = toProcess.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (article) => {
        const analysis = await analyzeArticle(article.title, article.content);
        if (!analysis) return;
        const { error } = await supabase.from('world_watch_articles').insert({
          title: article.title,
          summary: analysis.summary,
          category: analysis.category,
          urgency: analysis.urgency,
          region: analysis.region,
          source: article.source,
          url: article.url,
          published_at: article.publishedAt,
        });
        if (!error) inserted++;
      }));
    }

    // Purge : on ne garde que les articles publiés dans les 30 dernières heures
    // (published_at), maintenant que l'actualisation tourne automatiquement chaque heure.
    const cutoff = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
    const { count: purged } = await supabase
      .from('world_watch_articles')
      .delete({ count: 'exact' })
      .lt('published_at', cutoff);

    return new Response(
      JSON.stringify({ fetched: rawArticles.length, processed: toProcess.length, inserted, purged: purged ?? 0 }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

interface RawArticle { title: string; url: string; content: string; publishedAt: string; source: string }

async function analyzeArticle(title: string, content: string) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Titre : ${title}\n\nContenu : ${content.slice(0, 2000)}` }],
      }),
    });
    const json = await res.json();
    const block = json.content?.[0];
    if (!block || block.type !== 'text') return null;
    const raw = block.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    return JSON.parse(raw) as { summary: string; category: string; urgency: string; region: string };
  } catch (err) {
    console.error('[analyzeArticle]', err);
    return null;
  }
}

async function fetchFeed(url: string, source: string): Promise<RawArticle[]> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Oracle/1.0 (Veille Mondiale)' } });
  const xml = await res.text();
  return parseRss(xml, source);
}

function parseRss(xml: string, source: string): RawArticle[] {
  const items: RawArticle[] = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/g) || [];
  for (const block of blocks.slice(0, 15)) {
    const title = clean(extractTag(block, 'title'));
    const link = clean(extractTag(block, 'link')).trim();
    const pubDate = extractTag(block, 'pubDate');
    const description = clean(extractTag(block, 'description')).replace(/<[^>]+>/g, '');
    if (!title || !link) continue;
    items.push({
      title,
      url: link,
      content: description.slice(0, 2000),
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      source,
    });
  }
  return items;
}

function extractTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

function clean(s: string): string {
  const cdata = s.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  const inner = cdata ? cdata[1] : s;
  return inner
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// Titre normalisé (minuscules, sans accents ni ponctuation) pour la déduplication
// inter-sources : deux titres identiques à la casse/ponctuation près = même sujet.
function normTitle(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
