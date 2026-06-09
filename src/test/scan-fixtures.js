/**
 * Scan regression fixtures.
 *
 * These encode the expected behavior for known real-world sites.
 * Run against any scan-logic change before shipping.
 *
 * Usage: node src/test/scan-fixtures.js
 *
 * Each fixture has:
 *   - url: site to scan
 *   - must: assertions that MUST pass (failure = regression)
 *   - mustNot: things that must NOT appear (failure = regression)
 */

export const FIXTURES = [
  {
    id: 'dentsply-not-blocked',
    url: 'https://www.dentsplysirona.com/',
    description: 'Enterprise site with index/follow + full metadata — must not say "blocking AI"',
    must: [
      { signal: 'robots', check: s => s.score > 0,                  label: 'robots score > 0' },
      { signal: 'robots', check: s => !s.detail?.includes('stay out'), label: 'no "stay out" verdict' },
      { signal: 'robots', check: s => !s.detail?.includes('invisible to every'), label: 'no "invisible to every" verdict' },
      { signal: 'metadata', check: s => s.score >= 5,               label: 'metadata score >= 5' },
      { signal: 'prerender', check: s => s.isAgeGated === true,     label: 'age-gate detected' },
      { result: true, check: r => r.grade !== 'F',                  label: 'grade is not F' },
    ],
    mustNot: [
      { signal: 'robots', check: s => s.score === 0 && s.detail?.includes('stay out'), label: '"stay out" catastrophic verdict' },
    ],
  },
  {
    id: 'real-noindex-fires',
    url: null, // inject via robotsTxt mock
    description: 'Site with genuine noindex in meta-robots MUST fire blocking verdict',
    mockRobotsTxt: `User-agent: GPTBot\nDisallow: /\n`,
    must: [
      { signal: 'robots', check: s => s.score === 0,   label: 'robots score = 0 for full block' },
      { signal: 'robots', check: s => s.blockedBots?.includes('GPTBot'), label: 'GPTBot in blockedBots' },
    ],
    note: 'Anti-regression: the fix must not suppress real blocks',
  },
  {
    id: 'robots-404-is-unknown',
    url: null, // inject via mock
    description: 'robots.txt 404 / fetch failure → unknown, never "blocked"',
    mockRobotsFetch: 'fail',
    must: [
      { signal: 'robots', check: s => s.score === 8,                   label: 'robots score = 8 (unknown = permissive)' },
      { signal: 'robots', check: s => s.fetchState === 'unknown',      label: 'fetchState is unknown' },
      { signal: 'robots', check: s => !s.detail?.includes('blocked'),  label: 'no "blocked" in detail' },
    ],
  },
  {
    id: 'wingsnob-need-based-prompts',
    url: 'https://wingsnob.com/',
    description: 'Restaurant — prompts must be need-based, not brand-stuffed',
    must: [
      { result: true, check: r => r.grade !== 'F',  label: 'realistic grade (not F)' },
    ],
    mustNotInPrompts: ['wingsnob.com', 'wingsnob alternatives', 'provides services like wingsnob'],
    note: 'Awareness prompts must be "best wings near me" not "best wingsnob.com alternatives"',
  },
  {
    id: 'nonprofit-no-rivals',
    url: null, // inject a .org nonprofit mock
    description: 'Nonprofit/.org — no fabricated commercial competitors; framing softened',
    must: [
      { result: true, check: r => r.report?.citations?.isNonCommercial === true, label: 'isNonCommercial flagged' },
    ],
    note: 'Commercial competitor framing must be absent for nonprofits',
  },
  {
    id: 'small-site-real-gaps',
    description: 'A site with genuinely missing schema + llms.txt — must still report real gaps',
    must: [
      { signal: 'schema',  check: s => s.score < 5,   label: 'schema gap reported' },
      { signal: 'llmstxt', check: s => s.score < 5,   label: 'llmstxt gap reported' },
    ],
    note: 'Anti-regression: the validation layer must not suppress real missing signals',
  },
];

/**
 * Lightweight runner — checks deterministic fixtures (no live fetch).
 * Import and call runFixtures(scanFn) from tests or CI.
 */
export function assertFixture(fixture, signals, result) {
  const failures = [];

  for (const assertion of fixture.must ?? []) {
    if (assertion.signal) {
      const sig = signals?.[assertion.signal];
      if (!sig || !assertion.check(sig)) {
        failures.push(`MUST PASS: ${assertion.label}`);
      }
    } else if (assertion.result) {
      if (!assertion.check(result)) {
        failures.push(`MUST PASS: ${assertion.label}`);
      }
    }
  }

  for (const assertion of fixture.mustNot ?? []) {
    if (assertion.signal) {
      const sig = signals?.[assertion.signal];
      if (sig && assertion.check(sig)) {
        failures.push(`MUST NOT: ${assertion.label}`);
      }
    }
  }

  return { passed: failures.length === 0, failures, fixture: fixture.id };
}
