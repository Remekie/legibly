import { scan } from '../scan/index.js';
import { extractContext } from './context.js';
import { generatePrompts } from './prompts.js';
import { generateSchemaRecs } from './schema-recs.js';
import { generateLlmstxt } from './llmstxt-gen.js';
import { generateFixes } from './fixes.js';

/**
 * Generate a full report for a URL.
 * Runs scan + all report sections in parallel where possible.
 */
export async function generateReport(url) {
  // Run scan and page context extraction in parallel
  const [scanResult, context] = await Promise.all([
    scan(url),
    extractContext(url).catch(() => null),
  ]);

  if (!context) {
    return { ...scanResult, report: null, error: 'Could not fetch page content for report.' };
  }

  // Extract existing schema types from scan result for schema recs
  const existingSchemaTypes = scanResult.signals.schema?.types ?? [];

  // Run all report sections in parallel
  const [prompts, schemaRecs, llmstxt] = await Promise.allSettled([
    process.env.ANTHROPIC_API_KEY
      ? generatePrompts(context)
      : Promise.resolve(null),
    Promise.resolve(generateSchemaRecs(context, existingSchemaTypes)),
    generateLlmstxt(url),
  ]);

  const fixes = generateFixes(scanResult.signals, context);

  return {
    ...scanResult,
    context: {
      title: context.title,
      description: context.description,
      domain: context.domain,
    },
    report: {
      prompts:    prompts.status    === 'fulfilled' ? prompts.value    : null,
      schemaRecs: schemaRecs.status === 'fulfilled' ? schemaRecs.value : null,
      llmstxt:    llmstxt.status    === 'fulfilled' ? llmstxt.value    : null,
      fixes,
    },
  };
}
