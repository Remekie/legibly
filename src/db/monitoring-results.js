import { randomUUID } from 'crypto';
import db from './index.js';

export function saveMonitoringResult({ promptId, userId, appeared, snippet }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO monitoring_results (id, prompt_id, user_id, appeared, snippet)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, promptId, userId, appeared ? 1 : 0, snippet ?? null);
  return id;
}

export function getPromptResults(userId, limit = 100) {
  return db.prepare(`
    SELECT
      mr.id, mr.prompt_id, mr.checked_at, mr.appeared, mr.snippet,
      mp.prompt, mp.url
    FROM monitoring_results mr
    JOIN monitoring_prompts mp ON mr.prompt_id = mp.id
    WHERE mr.user_id = ?
    ORDER BY mr.checked_at DESC
    LIMIT ?
  `).all(userId, limit);
}

export function getLatestResultPerPrompt(userId) {
  return db.prepare(`
    SELECT
      mr.prompt_id, mr.appeared, mr.checked_at, mr.snippet,
      mp.prompt, mp.url
    FROM monitoring_results mr
    JOIN monitoring_prompts mp ON mr.prompt_id = mp.id
    WHERE mr.user_id = ?
      AND mr.checked_at = (
        SELECT MAX(checked_at) FROM monitoring_results
        WHERE prompt_id = mr.prompt_id AND user_id = mr.user_id
      )
    ORDER BY mp.created_at
  `).all(userId);
}
