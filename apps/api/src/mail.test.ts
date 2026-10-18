import { createServer, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseFrom, SmtpMailer } from './mail';

/** Just enough of an SMTP server (RFC 5321) to receive one message in plain text. */
function smtpServer(received: string[]) {
  return createServer((socket) => {
    let data = false;
    let message = '';
    socket.write('220 test ESMTP\r\n');
    socket.on('data', (chunk) => {
      for (const line of chunk.toString('utf8').split('\r\n')) {
        if (data) {
          if (line === '.') {
            data = false;
            received.push(message);
            socket.write('250 queued\r\n');
          } else message += `${line}\n`;
          continue;
        }
        if (/^(EHLO|HELO)/i.test(line)) socket.write('250 test\r\n');
        else if (/^(MAIL FROM|RCPT TO)/i.test(line)) socket.write('250 ok\r\n');
        else if (/^DATA/i.test(line)) {
          data = true;
          socket.write('354 go on\r\n');
        } else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n');
        else if (line) socket.write('250 ok\r\n');
      }
    });
  });
}

describe('e-mail through an SMTP provider', () => {
  const received: string[] = [];
  let server: Server;
  let port = 0;

  beforeAll(async () => {
    server = smtpServer(received);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    port = typeof address === 'object' && address ? address.port : 0;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('reads MAIL_FROM with or without a name, and refuses anything else', () => {
    expect(parseFrom('Facture Impec <bonjour@exemple.test>')).toEqual({
      name: 'Facture Impec',
      address: 'bonjour@exemple.test',
    });
    expect(parseFrom('"Cabinet Durand" <x@exemple.test>').name).toBe('Cabinet Durand');
    expect(parseFrom('bonjour@exemple.test')).toEqual({
      name: '',
      address: 'bonjour@exemple.test',
    });
    expect(() => parseFrom('Facture Impec')).toThrow(/MAIL_FROM/);
  });

  it('delivers the message, under the firm’s name when a brand replaces ours', async () => {
    const mailer = new SmtpMailer(
      `smtp://127.0.0.1:${port}?ignoreTLS=true`,
      'Facture Impec <bonjour@exemple.test>',
    );
    await mailer.send({ to: 'client@exemple.test', subject: 'Votre lien', text: 'Bonjour' });
    await mailer.send({
      to: 'client@exemple.test',
      subject: 'Rapport',
      text: 'Semaine',
      fromName: 'Cabinet Durand',
    });
    expect(received).toHaveLength(2);
    expect(received[0]).toMatch(/^From: Facture Impec <bonjour@exemple\.test>$/m);
    expect(received[0]).toMatch(/^To: client@exemple\.test$/m);
    expect(received[0]).toMatch(/^Subject: Votre lien$/m);
    expect(received[1]).toMatch(/^From: Cabinet Durand <bonjour@exemple\.test>$/m);
  });
});
