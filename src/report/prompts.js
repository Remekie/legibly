import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Detect non-commercial intent from page content
function detectNonCommercial(context) {
  const { domain, title, h1, bodyText, description } = context;
  const text = [title, h1, description, bodyText].join(' ').toLowerCase();
  const tld  = domain?.split('.').pop()?.toLowerCase() ?? '';

  const nonCommercialTlds     = new Set(['org', 'edu', 'gov', 'nonprofit']);
  const nonCommercialKeywords = [
    'nonprofit', 'non-profit', '501(c)', 'charity', 'charitable', 'donation', 'donate',
    'volunteer', 'grant', 'foundation', 'ngo', 'mission-driven', 'tax-exempt',
    'community services', 'public benefit', 'no cost', 'free services',
  ];

  const hasTld    = nonCommercialTlds.has(tld);
  const hasKeyword = nonCommercialKeywords.some(k => text.includes(k));
  // Commercial signals override: pricing, buy, shop, order, subscribe
  const hasCommercialSignal = /\b(pricing|price|buy|shop|order|subscribe|paid plan)\b/i.test(text);

  return (hasTld || hasKeyword) && !hasCommercialSignal;
}

/**
 * Generate "Prompts This Page Should Be Winning" using Claude.
 * Returns prompts across 4 journey stages.
 * Awareness + consideration prompts NEVER contain the brand name.
 * Domain only appears in evaluation + decision prompts.
 */
export async function generatePrompts(context) {
  const { title, description, h1, h2s, bodyText, location, domain, brandDescription, brandName } = context;

  const isNonCommercial = detectNonCommercial(context);
  const brand = brandName || (domain ? domain.replace('www.', '').split('.')[0] : '');

  const systemPrompt = `You are a GEO (Generative Engine Optimization) specialist.
Given a business webpage's content, generate realistic search prompts that real customers
would type into ChatGPT, Perplexity, or Claude.

CRITICAL RULES:
1. Infer the business category noun from the page content (e.g. "wing restaurant", "B2B sales data tool", "children's mental health services") — NOT from the domain name.
2. Awareness and consideration prompts MUST be completely unbranded. A real user who has never heard of this business would type these. Do NOT include the brand name, domain, or any company name.
3. Evaluation and decision prompts may include the brand name.
4. Write in natural conversational language, exactly how a real person would ask.
5. Return valid JSON only, no markdown, no explanation.${isNonCommercial ? '\n6. This is a non-commercial/nonprofit organization. Do not generate competitor comparisons or commercial intent prompts.' : ''}`;

  const userPrompt = `Business: ${title}
Domain: ${domain}
Description: ${description}
Main heading: ${h1}
Page sections: ${(h2s ?? []).join(', ')}
Content excerpt: ${(bodyText ?? '').slice(0, 800)}
${location ? `Location: ${location}` : ''}
${brandDescription ? `Brand context: ${brandDescription}` : ''}

First, infer: (a) the specific category noun for this business, (b) the primary ICP (who buys/uses this), (c) whether commercial intent exists.

Then generate exactly 12 prompts across these stages:

AWARENESS (2 prompts): Unbranded, need-based. "Where can I get [need]?", "best [category] for [use case]". NO brand name. Weight: these are what real users actually ask.
CONSIDERATION (3 prompts): Unbranded comparison. "best [category] options", "top [category] for [segment]". NO brand name. Weight: high-volume, high-value.
EVALUATION (3 prompts): Branded comparison. "[${brand}] vs [competitor]", "is [${brand}] good for X". Brand name required here.
DECISION (4 prompts): High-intent. "[${brand}] pricing", "does [${brand}] offer [feature]", "[category] near me" (for local). Brand name required here.

Tag each prompt as "rag" (Perplexity/Google AI — live web search) or "parametric" (ChatGPT/Claude — training data).
Awareness + consideration = mostly parametric. Evaluation + decision = mostly rag.

Return JSON in this exact shape:
{
  "awareness": [{"prompt": "...", "type": "parametric"}, {"prompt": "...", "type": "parametric"}],
  "consideration": [{"prompt": "...", "type": "parametric"}, {"prompt": "...", "type": "parametric"}, {"prompt": "...", "type": "parametric"}],
  "evaluation": [{"prompt": "...", "type": "rag"}, {"prompt": "...", "type": "rag"}, {"prompt": "...", "type": "rag"}],
  "decision": [{"prompt": "...", "type": "rag"}, {"prompt": "...", "type": "rag"}, {"prompt": "...", "type": "rag"}, {"prompt": "...", "type": "parametric"}]
}`;

  const message = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 1200,
    messages:   [{ role: 'user', content: userPrompt }],
    system:     systemPrompt,
  });

  const raw     = message.content[0]?.text ?? '{}';
  const cleaned = raw.replace(/```(?:json)?/g, '').replace(/```/g, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    // Attach non-commercial flag so callers can adjust framing
    parsed._isNonCommercial = isNonCommercial;
    return parsed;
  } catch {
    return {
      awareness: [], consideration: [], evaluation: [], decision: [],
      // Legacy keys for backward compat with any code reading old keys
      comparison: [], usecase: [], postpurchase: [],
      _isNonCommercial: isNonCommercial,
    };
  }
}
