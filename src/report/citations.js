const PERPLEXITY_API = 'https://api.perplexity.ai/chat/completions';
const MAX_PROMPTS = 6; // 3 awareness + 3 decision — keeps cost ~$0.03/report

/**
 * Check if the scanned domain appears in Perplexity AI responses
 * for the prompts it should be winning.
 *
 * Uses the generated prompts from generatePrompts() — takes first 3 awareness
 * and first 3 decision prompts as test queries.
 *
 * Returns null if PERPLEXITY_API_KEY is not set.
 */
export async function checkCitations(domain, prompts) {
  if (!process.env.PERPLEXITY_API_KEY) return null;
  if (!prompts) return null;

  const testPrompts = [
    ...(prompts.awareness ?? []).slice(0, 3),
    ...(prompts.decision ?? []).slice(0, 3),
  ].slice(0, MAX_PROMPTS);

  if (testPrompts.length === 0) return null;

  const results = await Promise.allSettled(
    testPrompts.map(prompt => queryPerplexity(prompt, domain))
  );

  const checked = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  const appearing = checked.filter(r => r.appearing).length;

  return {
    domain,
    promptsTested: checked.length,
    promptsAppearing: appearing,
    visibilityRate: checked.length > 0 ? Math.round((appearing / checked.length) * 100) : 0,
    results: checked,
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
    if (!res.ok) return { prompt, appearing: false, citedSources: [], error: res.status };

    const data = await res.json();
    const answer = data.choices?.[0]?.message?.content ?? '';

    // Extract cited sources from response
    const citations = data.citations ?? [];
    const domainNorm = domain.replace('www.', '').toLowerCase();

    // Check if domain appears in answer text OR cited sources
    const inAnswer = answer.toLowerCase().includes(domainNorm);
    const inCitations = citations.some(c =>
      String(c).toLowerCase().includes(domainNorm)
    );
    const appearing = inAnswer || inCitations;

    return {
      prompt,
      appearing,
      citedSources: citations.slice(0, 5),
      answerPreview: answer.slice(0, 200),
    };
  } catch (err) {
    return { prompt, appearing: false, citedSources: [], error: err.message };
  }
}
