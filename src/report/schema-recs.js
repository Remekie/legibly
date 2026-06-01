import * as cheerio from 'cheerio';

const PAGE_TYPE_SIGNALS = {
  product:  /product|shop|buy|price|add to cart|checkout/i,
  faq:      /faq|frequently asked|questions and answers/i,
  blog:     /blog|article|post|news|published|author/i,
  local:    /location|hours|directions|address|phone|call us/i,
  service:  /service|we offer|our work|what we do|hire us|contact us/i,
};

const SCHEMA_TEMPLATES = {
  LocalBusiness: (ctx) => ({
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: ctx.title.split('|')[0].trim(),
    description: ctx.description || ctx.h1,
    url: ctx.url,
    ...(ctx.location ? { address: { '@type': 'PostalAddress', addressLocality: ctx.location } } : {}),
    sameAs: [],
  }),
  Organization: (ctx) => ({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: ctx.title.split('|')[0].trim(),
    description: ctx.description || ctx.h1,
    url: ctx.url,
    sameAs: [],
  }),
  FAQPage: (ctx) => ({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: ctx.h2s.slice(0, 3).map(q => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: '[Answer to be filled in]' },
    })),
  }),
  Article: (ctx) => ({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: ctx.h1 || ctx.title,
    description: ctx.description,
    url: ctx.url,
    author: { '@type': 'Person', name: '[Author name]' },
    datePublished: new Date().toISOString().split('T')[0],
  }),
  Product: () => ({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: '[Product name]',
    description: '[Product description]',
    offers: {
      '@type': 'Offer',
      price: '[Price]',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
    },
  }),
  Service: (ctx) => ({
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: ctx.h1 || ctx.title.split('|')[0].trim(),
    description: ctx.description,
    provider: { '@type': 'Organization', name: ctx.title.split('|')[0].trim() },
  }),
};

export function generateSchemaRecs(context, existingSchemaTypes = []) {
  const { bodyText, h2s, url } = context;
  const combinedText = [bodyText, ...h2s].join(' ');

  // Detect page type
  let pageType = 'service';
  for (const [type, pattern] of Object.entries(PAGE_TYPE_SIGNALS)) {
    if (pattern.test(combinedText)) { pageType = type; break; }
  }

  // Map page type → recommended schema
  const recommendations = [];

  const schemaMap = {
    local:   ['LocalBusiness'],
    service: ['Organization', 'Service'],
    faq:     ['FAQPage'],
    blog:    ['Article'],
    product: ['Product'],
  };

  const recommended = schemaMap[pageType] ?? ['Organization'];

  for (const type of recommended) {
    if (existingSchemaTypes.includes(type)) continue;
    const generator = SCHEMA_TEMPLATES[type];
    if (generator) {
      recommendations.push({
        type,
        reason: reasonFor(type, pageType),
        snippet: JSON.stringify(generator(context), null, 2),
      });
    }
  }

  // Always recommend Organization if not present and not already recommended
  if (!existingSchemaTypes.includes('Organization') && !recommended.includes('Organization')) {
    recommendations.push({
      type: 'Organization',
      reason: 'All sites should have Organization schema so AI can identify and verify the business.',
      snippet: JSON.stringify(SCHEMA_TEMPLATES.Organization(context), null, 2),
    });
  }

  return { pageType, recommendations };
}

function reasonFor(type, pageType) {
  const reasons = {
    LocalBusiness: 'Your content signals a local business. This schema tells AI your exact location, hours, and service area.',
    Organization:  'AI needs to know your business name, description, and website to cite you confidently.',
    FAQPage:       'Your page has FAQ-style content. FAQPage schema lets AI extract and cite your specific answers.',
    Article:       'Article schema tells AI who wrote this, when it was published, and what it covers — all trust signals.',
    Product:       'Product schema includes pricing and availability — critical for AI shopping and comparison queries.',
    Service:       'Service schema clarifies what you offer and who provides it — helps AI recommend you for relevant queries.',
  };
  return reasons[type] ?? `${type} schema is recommended for this page type.`;
}
