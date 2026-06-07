import { Resend } from 'resend';
import { createMagicLink, verifyMagicLink } from '../db/magic-links.js';
import { upsertEmailUser } from '../db/users.js';

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM    = process.env.EMAIL_FROM ?? 'BlindGEO <hello@blindgeo.com>';
const APP_URL = process.env.APP_URL ?? 'https://legibly.dev';

function h(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function sendMagicLink(email) {
  if (!resend) {
    process.stderr.write(`[magic-link] RESEND_API_KEY not set — skipping email to ${email}\n`);
    return;
  }
  const token = createMagicLink(email);
  const link  = `${APP_URL}/auth/email/verify?token=${token}`;

  await resend.emails.send({
    from:    FROM,
    to:      email,
    subject: 'Sign in to BlindGEO',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
        <p style="font-size:18px;font-weight:600;margin-bottom:8px;">Sign in to BlindGEO</p>
        <p style="color:#555;margin-bottom:24px;">Click the button below to sign in. This link expires in 15 minutes.</p>
        <a href="${link}" style="display:inline-block;background:#0a0a0a;color:#e8ff47;text-decoration:none;padding:12px 24px;border-radius:4px;font-weight:600;">
          Sign in to BlindGEO →
        </a>
        <p style="color:#999;font-size:12px;margin-top:24px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
}

export async function sendReportReady(email, reportUrl, domain) {
  if (!resend) return;
  await resend.emails.send({
    from:    FROM,
    to:      email,
    subject: `Your BlindGEO report for ${domain} is ready`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
        <p style="font-size:18px;font-weight:600;margin-bottom:8px;">Your AI visibility report is ready</p>
        <p style="color:#555;margin-bottom:8px;">We scanned <strong>${domain}</strong> and found specific fixes to improve your AI visibility.</p>
        <a href="${reportUrl}" style="display:inline-block;background:#0a0a0a;color:#e8ff47;text-decoration:none;padding:12px 24px;border-radius:4px;font-weight:600;margin-top:16px;">
          View your report →
        </a>
      </div>
    `,
  });
}

export async function sendDeltaEmail(email, domain, dashboardUrl, { prevGrade, newGrade, scoreDelta, topIssues = [] }) {
  if (!resend) return;
  const improved = scoreDelta > 0;
  const subject  = improved
    ? `${h(domain)} improved from ${h(prevGrade)} → ${h(newGrade)} this week`
    : scoreDelta < 0
      ? `${h(domain)} dropped to grade ${h(newGrade)} — action needed`
      : `Weekly update: ${h(domain)} is still grade ${h(newGrade)}`;

  const issueList = topIssues.length
    ? `<ul style="padding-left:20px;margin:12px 0">${topIssues.map(i => `<li style="margin-bottom:4px">${h(i)}</li>`).join('')}</ul>`
    : '';

  await resend.emails.send({
    from: FROM,
    to:   email,
    subject,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
        <p style="font-size:18px;font-weight:600;margin-bottom:8px;">Weekly AI visibility update</p>
        <p style="color:#555;margin-bottom:16px;"><strong>${domain}</strong> — grade this week:</p>
        <div style="font-size:48px;font-weight:700;font-family:Georgia,serif;margin-bottom:4px;">${h(newGrade)}</div>
        <div style="font-size:14px;color:${improved ? '#16a34a' : scoreDelta < 0 ? '#dc2626' : '#6b7280'};margin-bottom:20px;">
          ${improved ? `↑ Improved from ${h(prevGrade)}` : scoreDelta < 0 ? `↓ Dropped from ${h(prevGrade)}` : `→ No change from ${h(prevGrade)}`}
        </div>
        ${topIssues.length ? `<p style="font-size:14px;font-weight:600;margin-bottom:4px;">Issues to fix this week:</p>${issueList}` : ''}
        <a href="${h(dashboardUrl)}" style="display:inline-block;background:#0a0a0a;color:#e8ff47;text-decoration:none;padding:12px 24px;border-radius:4px;font-weight:600;margin-top:16px;">
          View full report →
        </a>
        <p style="color:#999;font-size:12px;margin-top:24px;"><a href="${APP_URL}/settings/notifications" style="color:#999;">Manage notification settings</a></p>
      </div>
    `,
  });
}

export async function sendPostFixEmail(email, domain, dashboardUrl, { newGrade, remainingCompetitors = [] }) {
  if (!resend) return;
  const compList = remainingCompetitors.slice(0, 3)
    .map(d => `<li style="margin-bottom:4px"><strong>${h(d)}</strong> still appearing in your prompts</li>`)
    .join('');

  await resend.emails.send({
    from:    FROM,
    to:      email,
    subject: `${domain} is now grade ${newGrade} — but competitors are still winning`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
        <p style="font-size:18px;font-weight:600;margin-bottom:8px;">Your site improved to grade ${h(newGrade)}</p>
        <p style="color:#555;margin-bottom:16px;">The GitHub fixes worked. Your AI visibility score went up.</p>
        ${compList ? `
          <p style="font-size:14px;font-weight:600;margin-bottom:8px;">But these competitors still appear instead of you:</p>
          <ul style="padding-left:20px;margin:0 0 20px">${compList}</ul>
          <p style="font-size:14px;color:#555;">Track them weekly to know the moment you overtake them.</p>
        ` : ''}
        <a href="${dashboardUrl}?upgrade=fix" style="display:inline-block;background:#0a0a0a;color:#e8ff47;text-decoration:none;padding:12px 24px;border-radius:4px;font-weight:600;margin-top:16px;">
          Track weekly for $19/mo →
        </a>
      </div>
    `,
  });
}

export async function verifyAndLogin(token) {
  const email = verifyMagicLink(token);
  if (!email) return null;
  return upsertEmailUser(email);
}
