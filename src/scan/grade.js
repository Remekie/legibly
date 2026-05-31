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
 * Any signal with score === 0 AND marked as a blocker produces an immediate blocker line.
 */
export function toGrade(signals) {
  let weighted = 0;
  for (const [key, signal] of Object.entries(signals)) {
    weighted += (signal.score / MAX_SIGNAL_SCORE) * (WEIGHTS[key] ?? 0);
  }

  const score = Math.round(weighted * 100);

  const grade =
    score >= 90 ? 'A' :
    score >= 75 ? 'B' :
    score >= 60 ? 'C' :
    score >= 45 ? 'D' : 'F';

  // Surface the most severe blocker first
  const blocker =
    signals.prerender?.score === 0 ? signals.prerender.detail :
    signals.robots?.score === 0    ? signals.robots.detail    :
    null;

  return { grade, score, blocker };
}
