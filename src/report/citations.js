import Sentiment from 'sentiment';

const PERPLEXITY_API = 'https://api.perplexity.ai/chat/completions';
const MAX_PROMPTS = 6; // 3 awareness + 3 decision — keeps cost ~$0.03/report
const sentiment = new Sentiment();

export async function checkCitations(domain, prompts) {
  if (!process.env.PERPLEXITY_API_KEY) return null;
  if (!prompts) return null;

  const testPrompts = [
    ...(prompts.awareness ?? []).slice(0, 3),
    ...(prompts.decision ?? []).slice(0, 3),
  ].slice(0, MAX_PROMPTS);

  if (testPrompts.length === 0) return null;

  const results = await Promise.allSettled(
    testPrompts.map(p => {
      const text = typeof p === 'object' ? p.prompt : p;
      return queryPerplexity(text, domain);
    })
  );

  const checked = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  const appearing = checked.filter(r => r.appearing).length;

  // Aggregate competitor domains appearing across all prompts
  const competitorCounts = new Map();
  for (const result of checked) {
    for (const competitor of result.competitors ?? []) {
      competitorCounts.set(competitor, (competitorCounts.get(competitor) ?? 0) + 1);
    }
  }

  // Sort by frequency, return top 5
  // Aggregate sentiment across prompts where brand appeared
  const sentimentScores = checked
    .filter(r => r.appearing && r.sentiment)
    .map(r => r.sentiment.score);

  const avgSentiment = sentimentScores.length > 0
    ? sentimentScores.reduce((a, b) => a + b, 0) / sentimentScores.length
    : null;

  const sentimentLabel = avgSentiment === null ? null
    : avgSentiment > 1  ? 'positive'
    : avgSentiment < -1 ? 'negative'
    : 'neutral';

  const topCompetitors = [...competitorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([competitor, count]) => ({ domain: competitor, appearances: count, total: checked.length }));

  return {
    domain,
    promptsTested: checked.length,
    promptsAppearing: appearing,
    visibilityRate: checked.length > 0 ? Math.round((appearing / checked.length) * 100) : 0,
    sentiment: sentimentLabel,
    sentimentScore: avgSentiment !== null ? Math.round(avgSentiment * 10) / 10 : null,
    results: checked,
    competitors: topCompetitors,
  };
}

/**
 * Score sentiment of sentences in the AI answer that mention the brand.
 * Uses AFINN word list via the `sentiment` package.
 * Returns { score, label, excerpt } or null if brand not mentioned.
 */
function scoreBrandSentiment(answerText, domainNorm) {
  if (!answerText || !domainNorm) return null;

  // Find sentences mentioning the brand (split on . ! ?)
  const sentences = answerText.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
  const brandSentences = sentences.filter(s =>
    s.toLowerCase().includes(domainNorm) ||
    s.toLowerCase().includes(domainNorm.split('.')[0]) // match brand name without TLD
  );

  if (brandSentences.length === 0) return null;

  const combined = brandSentences.join('. ');
  const result   = sentiment.analyze(combined);

  return {
    score:   result.score,
    label:   result.score > 1 ? 'positive' : result.score < -1 ? 'negative' : 'neutral',
    excerpt: brandSentences[0].slice(0, 150),
  };
}

async function queryPerplexity(prompt, domain) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(PERPLEXITY_API, {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800,
      }),
    });

    clearTimeout(timer);
    if (!res.ok) return { prompt, appearing: false, citedSources: [], competitors: [], error: res.status };

    const data = await res.json();
    const answer = data.choices?.[0]?.message?.content ?? '';
    const citations = data.citations ?? [];
    const domainNorm = domain.replace('www.', '').toLowerCase();

    const inAnswer   = answer.toLowerCase().includes(domainNorm);
    const inCitations = citations.some(c => String(c).toLowerCase().includes(domainNorm));
    const appearing  = inAnswer || inCitations;

    // Sentiment: score the sentences that mention the brand
    const brandSentiment = scoreBrandSentiment(answer, domainNorm);

    // Extract competitor domains: all cited domains that aren't the user's
    const competitors = citations
      .map(c => {
        try { return new URL(String(c)).hostname.replace('www.', '').toLowerCase(); }
        catch { return null; }
      })
      .filter(h => h && h !== domainNorm && !h.includes('wikipedia') && !h.includes('reddit'));

    return {
      prompt,
      appearing,
      sentiment: brandSentiment,
      citedSources: citations.slice(0, 5),
      competitors: [...new Set(competitors)],
      answerPreview: answer.slice(0, 200),
    };
  } catch (err) {
    return { prompt, appearing: false, citedSources: [], competitors: [], error: err.message };
  }
}
