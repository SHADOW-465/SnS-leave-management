import nodemailer from 'nodemailer';
import type { Db } from '@sns/database';
export function previewLeaveEmail(input: {
  to: string;
  requesterName: string;
  leaveType: string;
  dates: string;
  workingDays: string;
  link: string;
}): {
  to: string;
  subject: string;
  heading: string;
  body: string;
  rows: {
    k: string;
    v: string;
  }[];
} {
  return {
    to: input.to,
    subject: `Leave request from ${input.requesterName}`,
    heading: 'A leave request needs a decision',
    body: `${input.requesterName} submitted a leave request. Sign in to Leave OS to review it. This message cannot approve or reject the request.`,
    rows: [
      { k: 'Person', v: input.requesterName },
      { k: 'Type', v: input.leaveType },
      { k: 'Dates', v: input.dates },
      { k: 'Working days', v: input.workingDays },
      { k: 'Link', v: input.link },
    ],
  };
}
export async function drainOutbox(sqlite: Db): Promise<void> {
  const enabled = (await sqlite
    .prepare(`SELECT value_json FROM app_setting WHERE key = 'email.enabled'`)
    .get()) as
    | {
        value_json: string;
      }
    | undefined;
  if (enabled?.value_json !== 'true') return;
  const settings = (await sqlite
    .prepare(`SELECT value_json FROM app_setting WHERE key = 'email.smtp'`)
    .get()) as
    | {
        value_json: string;
      }
    | undefined;
  if (!settings) return;
  let smtp: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
  };
  try {
    smtp = JSON.parse(settings.value_json) as typeof smtp;
  } catch {
    return;
  }
  const pending = (await sqlite
    .prepare(
      `SELECT * FROM outbox_message WHERE status = 'pending' AND next_attempt_at <= ? LIMIT 20`,
    )
    .all(new Date().toISOString())) as {
    id: string;
    payload_json: string;
    attempts: number;
  }[];
  if (pending.length === 0) return;
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  for (const row of pending) {
    const payload = JSON.parse(row.payload_json) as {
      to: string;
      subject: string;
      text: string;
    };
    try {
      await transport.sendMail({
        from: smtp.from,
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
      });
      await sqlite
        .prepare(
          `UPDATE outbox_message SET status = 'sent', sent_at = ?, attempts = attempts + 1 WHERE id = ?`,
        )
        .run(new Date().toISOString(), row.id);
    } catch (err) {
      const attempts = row.attempts + 1;
      const dead = attempts >= 8;
      const next = new Date(Date.now() + Math.min(60, 2 ** attempts) * 60000).toISOString();
      await sqlite
        .prepare(
          `UPDATE outbox_message SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?`,
        )
        .run(
          dead ? 'dead' : 'pending',
          attempts,
          next,
          err instanceof Error ? err.message : 'send failed',
          row.id,
        );
    }
  }
}
