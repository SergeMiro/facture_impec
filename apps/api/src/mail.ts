// E-mail for sign-in and sign-up links, chasing e-mails sent by the autopilot and the weekly report.
// Local dev keeps the mails in memory (GET /admin/outbox) and prints them; sandbox and prod send
// through the SMTP provider of MAIL_SMTP_URL, and without one all of this is off there.
import { createTransport, type Transporter } from 'nodemailer';
import type { Mail, Mailer } from './deps';

export class OutboxMailer implements Mailer {
  readonly sent: (Mail & { at: string })[] = [];

  constructor(
    private readonly log: (message: string) => void = () => {},
    /** Stamps each mail: business time in the scenario stack. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  async send(mail: Mail): Promise<void> {
    this.sent.push({ ...mail, at: this.now().toISOString() });
    if (this.sent.length > 50) this.sent.shift();
    this.log(`mail to ${mail.to}: ${mail.subject}\n${mail.text}`);
  }
}

/** "Name <address>" or a bare address, as MAIL_FROM gives it. */
export function parseFrom(value: string): { name: string; address: string } {
  const named = /^\s*"?([^"<]*?)"?\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(value);
  if (named?.[2]) return { name: named[1] ?? '', address: named[2] };
  const bare = value.trim();
  if (/^[^\s@<>]+@[^\s@<>]+$/.test(bare)) return { name: '', address: bare };
  throw new Error('MAIL_FROM: expected "Name <address@domain>" or an address');
}

/**
 * Any provider that speaks SMTP (MAIL_SMTP_URL, e.g. smtps://user:password@host:465): the owner
 * chooses the provider, the code does not change. The URL holds a password: it is never logged.
 */
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;
  private readonly from: { name: string; address: string };

  constructor(url: string, from: string) {
    this.transport = createTransport(url);
    this.from = parseFrom(from);
  }

  async send(mail: Mail): Promise<void> {
    await this.transport.sendMail({
      from: { name: mail.fromName ?? this.from.name, address: this.from.address },
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
  }
}
