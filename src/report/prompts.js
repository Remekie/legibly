import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Generate "Prompts This Page Should Be Winning" using Claude.
 * Returns 12 realistic queries across 5 intent categories.
 */
export async function generatePrompts(context) {
  const { title, description, h1, h2s, bodyText, location, domain } = context;

  const systemPrompt = `You are a GEO (Generative Engine Optimization) specialist.
Given a business webpage's content, generate realistic search prompts that real customers
would type into ChatGPT, Perplexity, or Claude — where this business SHOULD appear in the
AI's answer but likely doesn't due to visibility gaps.

Rules:
- Write prompts in natural conversational language, exactly how a real person would ask
- Each prompt must be specific enough that this particular business SHOULD be mentioned
- Do NOT explain the prompts — just list them
- Return valid JSON only, no markdown, no explanation`;

  const userPrompt = `Business: ${title}
Domain: ${domain}
Description: ${description}
Main heading: ${h1}
Page sections: ${h2s.join(', ')}
Content excerpt: ${bodyText.slice(0, 800)}
${location ? `Location: ${location}` : ''}

Generate exactly 12 prompts this page should be winning in AI search.
Also tag each prompt as "rag" (Perplexity/Google AI Overviews — live web search, results in days)
or "parametric" (ChatGPT/Claude — training data, results in 3-6 months).
Awareness/comparison prompts are usually parametric. Decision/use-case prompts often trigger RAG.

Return JSON in this exact shape:
{
  "awareness": [{"prompt": "...", "type": "parametric"}, {"prompt": "...", "type": "parametric"}],
  "comparison": [{"prompt": "...", "type": "parametric"}, {"prompt": "...", "type": "parametric"}],
  "decision": [{"prompt": "...", "type": "rag"}, {"prompt": "...", "type": "rag"}],
  "usecase": [{"prompt": "...", "type": "rag"}, {"prompt": "...", "type": "rag"}, {"prompt": "...", "type": "parametric"}],
  "postpurchase": [{"prompt": "...", "type": "parametric"}, {"prompt": "...", "type": "parametric"}, {"prompt": "...", "type": "rag"}]
}`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: userPrompt }],
    system: systemPrompt,
  });

  const raw = message.content[0]?.text ?? '{}';

  // Strip any markdown fences if present
  const cleaned = raw.replace(/```(?:json)?/g, '').replace(/```/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return { awareness: [], comparison: [], decision: [], usecase: [], postpurchase: [] };
  }
}
