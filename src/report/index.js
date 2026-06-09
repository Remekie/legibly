import { scan } from '../scan/index.js';
import { extractContext } from './context.js';
import { generatePrompts } from './prompts.js';
import { generateSchemaRecs } from './schema-recs.js';
import { generateLlmstxt } from './llmstxt-gen.js';
import { generateFixes } from './fixes.js';
import { checkCitations } from './citations.js';
import { generateLovableSnippets } from './lovable-snippets.js';
import { checkAuthority } from '../scan/authority.js';

export async function generateReport(url, brandContext = null) {
  const [scanResult, context] = await Promise.all([
    scan(url),
    extractContext(url).catch(() => null),
  ]);

  if (!context) {
    return { ...scanResult, report: null, error: 'Could not fetch page content for report.' };
  }

  // Merge brand description from user settings into context for richer prompts
  const enrichedContext = brandContext
    ? { ...context, brandDescription: brandContext.description, brandName: brandContext.name }
    : context;

  const existingSchemaTypes = scanResult.signals.schema?.types ?? [];

  const promptsResult = await (
    process.env.ANTHROPIC_API_KEY
      ? generatePrompts(enrichedContext).catch(() => null)
      : Promise.resolve(null)
  );

  const [schemaRecs, llmstxt, citations, authority] = await Promise.allSettled([
    Promise.resolve(generateSchemaRecs(enrichedContext, existingSchemaTypes)),
    generateLlmstxt(url),
    checkCitations(context.domain, promptsResult),
    checkAuthority(context.domain, enrichedContext.brandName),
  ]);

  const fixes = generateFixes(scanResult.signals, enrichedContext, scanResult.sitePages);
  const schemaRecsValue = schemaRecs.status === 'fulfilled' ? schemaRecs.value : null;
  const llmstxtValue    = llmstxt.status    === 'fulfilled' ? llmstxt.value    : null;

  const lovableSnippets = generateLovableSnippets({
    signals:    scanResult.signals,
    schemaRecs: schemaRecsValue,
    llmstxt:    llmstxtValue,
    domain:     context.domain,
  });

  return {
    ...scanResult,
    context: {
      title:       context.title,
      description: context.description,
      domain:      context.domain,
    },
    report: {
      prompts:         promptsResult,
      schemaRecs:      schemaRecsValue,
      llmstxt:         llmstxtValue,
      citations:       citations.status  === 'fulfilled' ? citations.value  : null,
      authority:       authority.status  === 'fulfilled' ? authority.value  : null,
      fixes,
      lovableSnippets,
      agentView:       scanResult.signals.prerender?.agentView ?? null,
      humanHtml:       scanResult.signals.prerender?.humanHtml ?? null,
    },
  };
}
