import { scan } from '../scan/index.js';
import { extractContext } from './context.js';
import { generatePrompts } from './prompts.js';
import { generateSchemaRecs } from './schema-recs.js';
import { generateLlmstxt } from './llmstxt-gen.js';
import { generateFixes } from './fixes.js';
import { checkCitations } from './citations.js';

export async function generateReport(url) {
  const [scanResult, context] = await Promise.all([
    scan(url),
    extractContext(url).catch(() => null),
  ]);

  if (!context) {
    return { ...scanResult, report: null, error: 'Could not fetch page content for report.' };
  }

  const existingSchemaTypes = scanResult.signals.schema?.types ?? [];

  // Generate prompts first — citations depend on them
  const promptsResult = await (
    process.env.ANTHROPIC_API_KEY
      ? generatePrompts(context).catch(() => null)
      : Promise.resolve(null)
  );

  // Run remaining sections + citations in parallel
  const [schemaRecs, llmstxt, citations] = await Promise.allSettled([
    Promise.resolve(generateSchemaRecs(context, existingSchemaTypes)),
    generateLlmstxt(url),
    checkCitations(context.domain, promptsResult),
  ]);

  const fixes = generateFixes(scanResult.signals, context, scanResult.sitePages);

  return {
    ...scanResult,
    context: {
      title: context.title,
      description: context.description,
      domain: context.domain,
    },
    report: {
      prompts:    promptsResult,
      schemaRecs: schemaRecs.status  === 'fulfilled' ? schemaRecs.value  : null,
      llmstxt:    llmstxt.status     === 'fulfilled' ? llmstxt.value     : null,
      citations:  citations.status   === 'fulfilled' ? citations.value   : null,
      fixes,
    },
  };
}
