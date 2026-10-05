import { EMAIL_PALETTE as PALETTE } from '@motor-fix/ui-cockpit/email';

// The HTML part every e-mail shares: the light Cockpit palette
// (libs/ui-cockpit/src/styles/cockpit.css), the wordmark, one amber button
// and the footer that says why the person gets it. Inline styles only:
// mail clients drop <style> blocks and CSS variables.
const FONT = 'font-family:Helvetica,Arial,sans-serif';

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export function emailHtml(mail: {
  language: 'ro' | 'en';
  subject: string;
  lines: readonly string[];
  button: { label: string; href: string };
  reason: string;
  stop?: { label: string; href: string };
}): string {
  const stop = mail.stop
    ? `<br><a href="${escapeHtml(mail.stop.href)}" style="color:${PALETTE.textSecondary};text-decoration:underline">${escapeHtml(mail.stop.label)}</a>`
    : '';
  const lines = mail.lines
    .map(
      (line) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:${PALETTE.text}">${escapeHtml(line)}</p>`,
    )
    .join('');
  return `<!doctype html>
<html lang="${mail.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(mail.subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:${PALETTE.bg};${FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:${PALETTE.panel};border:1px solid ${PALETTE.line};border-radius:8px">
<tr><td style="padding:24px 24px 8px;font-size:20px;font-weight:700;letter-spacing:0.02em;color:${PALETTE.text}">MotorFix</td></tr>
<tr><td style="padding:16px 24px 8px">${lines}
<p style="margin:8px 0 24px"><a href="${escapeHtml(mail.button.href)}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:${PALETTE.amber};color:${PALETTE.onAmber};font-size:16px;font-weight:700;text-decoration:none">${escapeHtml(mail.button.label)}</a></p></td></tr>
<tr><td style="padding:16px 24px 24px;border-top:1px solid ${PALETTE.line};font-size:13px;line-height:20px;color:${PALETTE.textSecondary}">${escapeHtml(mail.reason)}${stop}</td></tr>
</table>
</body></html>`;
}
