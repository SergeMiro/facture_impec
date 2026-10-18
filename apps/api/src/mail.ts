// E-mail for sign-in links. Local dev keeps the mails in memory (GET /dev/outbox) and prints them;
// sandbox and prod have no provider yet, so links are off there and the tenant key is the way in
// (docs/DEFERRED.md: the provider is the owner's choice).
import type { Mail, Mailer } from './deps';

export class OutboxMailer implements Mailer {
  readonly sent: (Mail & { at: string })[] = [];

  constructor(private readonly log: (message: string) => void = () => {}) {}

  async send(mail: Mail): Promise<void> {
    this.sent.push({ ...mail, at: new Date().toISOString() });
    if (this.sent.length > 50) this.sent.shift();
    this.log(`mail to ${mail.to}: ${mail.subject}\n${mail.text}`);
  }
}
