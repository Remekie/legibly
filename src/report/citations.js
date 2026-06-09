import Sentiment from 'sentiment';

const PERPLEXITY_API = 'https://api.perplexity.ai/chat/completions';
const RUNS_PER_PROMPT = 3; // AI answers are non-deterministic — single checks are unreliable
const MAX_PROMPTS     = 4; // 2 awareness + 2 decision, each run 3×; keeps cost ~$0.04/report
const sentiment       = new Sentiment();

export async function checkCitations(domain, prompts) {
  if (!process.env.PERPLEXITY_API_KEY) return null;
  if (!prompts) return null;

  const isNonCommercial = prompts._isNonCommercial ?? false;

  // Use awareness + consideration prompts (unbranded) and decision (branded)
  const awarenessPrompts    = [...(prompts.awareness ?? []), ...(prompts.consideration ?? [])].slice(0, 2);
  const decisionPrompts     = [...(prompts.decision ?? []), ...(prompts.evaluation ?? [])].slice(0, 2);
  const testPrompts         = [...awarenessPrompts, ...decisionPrompts].slice(0, MAX_PROMPTS);

  if (testPrompts.length === 0) return null;

  // Run each prompt RUNS_PER_PROMPT times — staggered to stay within Perplexity burst limit (5 req/s)
  // We run prompts sequentially, each prompt's 3 runs fire with a 300ms gap between prompts
  const allRunResults = [];
  for (let i = 0; i < testPrompts.length; i++) {
    const text = typeof testPrompts[i] === 'object' ? testPrompts[i].prompt : testPrompts[i];
    if (i > 0) await new Promise(r => setTimeout(r, 300)); // 300ms between prompt batches
    const batchResults = await Promise.allSettled(
      Array.from({ length: RUNS_PER_PROMPT }, () => queryPerplexity(text, domain))
    );
    allRunResults.push(...batchResults);
  }

  // Group results by prompt index
  const byPrompt = [];
  for (let i = 0; i < testPrompts.length; i++) {
    const start = i * RUNS_PER_PROMPT;
    const runs = allRunResults.slice(start, start + RUNS_PER_PROMPT)
      .filter(r => r.status === 'fulfilled' && r.value !== null) // exclude rate-limited runs
      .map(r => r.value);
    byPrompt.push({ prompt: typeof testPrompts[i] === 'object' ? testPrompts[i].prompt : testPrompts[i], runs });
  }

  // Aggregate per prompt: appearances/runs
  const checked = byPrompt.map(({ prompt, runs }) => {
    const appearances = runs.filter(r => r.appearing).length;
    const appearing   = appearances > 0;

    // Collect all competitor domains across runs
    const competitorMap = new Map();
    runs.forEach(r => {
      (r.competitors ?? []).forEach(c => {
        competitorMap.set(c, (competitorMap.get(c) ?? 0) + 1);
      });
    });

    // Sentiment: average across runs where brand appeared
    const sentimentScores = runs.filter(r => r.appearing && r.sentiment).map(r => r.sentiment.score);
    const avgSentiment = sentimentScores.length > 0
      ? sentimentScores.reduce((a, b) => a + b, 0) / sentimentScores.length : null;

    // Best answer preview from first run that returned content
    const firstAnswer = runs.find(r => r.answerPreview)?.answerPreview ?? '';

    return {
      prompt,
      appearing,
      runs:        runs.length,
      appearances,
      appearanceRate: `${appearances}/${runs.length}`,
      sentiment: avgSentiment !== null ? {
        score: avgSentiment,
        label: avgSentiment > 1 ? 'positive' : avgSentiment < -1 ? 'negative' : 'neutral',
      } : null,
      citedSources: runs[0]?.citedSources ?? [],
      competitors:  [...competitorMap.entries()].sort((a,b) => b[1]-a[1]).slice(0,3).map(([d]) => d),
      answerPreview: firstAnswer,
    };
  });

  const totalAppearing = checked.filter(r => r.appearing).length;

  const competitorCounts = new Map();
  for (const result of checked) {
    for (const competitor of result.competitors ?? []) {
      competitorCounts.set(competitor, (competitorCounts.get(competitor) ?? 0) + 1);
    }
  }

  const topCompetitors = [...competitorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([competitor, count]) => ({ domain: competitor, appearances: count, total: checked.length }));

  const sentimentScores = checked.filter(r => r.appearing && r.sentiment).map(r => r.sentiment.score);
  const avgSentiment    = sentimentScores.length > 0
    ? sentimentScores.reduce((a, b) => a + b, 0) / sentimentScores.length : null;

  return {
    domain,
    promptsTested:     checked.length,
    promptsAppearing:  totalAppearing,
    runsPerPrompt:     RUNS_PER_PROMPT,
    visibilityRate:    checked.length > 0 ? Math.round((totalAppearing / checked.length) * 100) : 0,
    sentiment:         avgSentiment !== null ? (avgSentiment > 1 ? 'positive' : avgSentiment < -1 ? 'negative' : 'neutral') : null,
    sentimentScore:    avgSentiment !== null ? Math.round(avgSentiment * 10) / 10 : null,
    results:           checked,
    competitors:       topCompetitors,
    isNonCommercial,
  };
}

function scoreBrandSentiment(answerText, domainNorm) {
  if (!answerText || !domainNorm) return null;
  const sentences    = answerText.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
  const brandName    = domainNorm.split('.')[0];
  const brandSents   = sentences.filter(s => s.toLowerCase().includes(domainNorm) || s.toLowerCase().includes(brandName));
  if (brandSents.length === 0) return null;
  const result = sentiment.analyze(brandSents.join('. '));
  return { score: result.score, label: result.score > 1 ? 'positive' : result.score < -1 ? 'negative' : 'neutral' };
}

async function queryPerplexity(prompt, domain) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(PERPLEXITY_API, {
      signal:  controller.signal,
      method:  'POST',
      headers: { 'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: prompt }], max_tokens: 800 }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      // 429 = rate-limited: return null so the caller can exclude this run from the denominator
      if (res.status === 429) return null;
      return { prompt, appearing: false, citedSources: [], competitors: [] };
    }

    const data     = await res.json();
    const answer   = data.choices?.[0]?.message?.content ?? '';
    const citations = data.citations ?? [];
    const domainNorm = domain.replace('www.', '').toLowerCase();

    const appearing = answer.toLowerCase().includes(domainNorm) ||
                      citations.some(c => String(c).toLowerCase().includes(domainNorm));

    const competitors = citations
      .map(c => { try { return new URL(String(c)).hostname.replace('www.', '').toLowerCase(); } catch { return null; } })
      .filter(h => h && h !== domainNorm && !h.includes('wikipedia') && !h.includes('reddit'));

    return {
      prompt,
      appearing,
      sentiment:     scoreBrandSentiment(answer, domainNorm),
      citedSources:  citations.slice(0, 5),
      competitors:   [...new Set(competitors)],
      answerPreview: answer.slice(0, 200),
    };
  } catch {
    return { prompt, appearing: false, citedSources: [], competitors: [] };
  }
}
