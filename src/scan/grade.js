const WEIGHTS = {
  prerender: 0.25,
  robots:    0.20,
  schema:    0.15,
  llmstxt:   0.15,
  content:   0.15,
  eeat:      0.10,
};

const MAX_SIGNAL_SCORE = 10;

/**
 * Convert signal scores to a weighted A–F grade.
 * Stub signals are excluded from scoring — only live signals count.
 * Weights are renormalized across live signals so the grade stays meaningful.
 */
export function toGrade(signals) {
  const liveEntries = Object.entries(signals).filter(([, s]) => !s.stub);

  // Renormalize weights across live signals only
  const totalWeight = liveEntries.reduce((sum, [key]) => sum + (WEIGHTS[key] ?? 0), 0);

  let weighted = 0;
  for (const [key, signal] of liveEntries) {
    const normalizedWeight = (WEIGHTS[key] ?? 0) / totalWeight;
    weighted += (signal.score / MAX_SIGNAL_SCORE) * normalizedWeight;
  }

  const score = Math.round(weighted * 100);

  const grade =
    score >= 90 ? 'A' :
    score >= 75 ? 'B' :
    score >= 60 ? 'C' :
    score >= 45 ? 'D' : 'F';

  // Surface the most severe blocker from live signals only
  const blocker =
    signals.prerender?.score === 0 && !signals.prerender?.stub ? signals.prerender.detail :
    signals.robots?.score === 0    && !signals.robots?.stub    ? signals.robots.detail    :
    null;

  return { grade, score, blocker };
}
