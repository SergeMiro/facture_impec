// E-mail for sign-in links, chasing e-mails sent by the autopilot and the weekly report. Local dev
// keeps the mails in memory (GET /admin/outbox) and prints them; sandbox and prod have no provider
// yet, so all three are off there (docs/DEFERRED.md: the provider is the owner's choice).
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
