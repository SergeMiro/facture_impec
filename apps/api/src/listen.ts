import { serve } from '@hono/node-server';

export interface Listening {
  url: string;
  port: number;
  close(): Promise<void>;
}

/** Serves `fetch` on `port` (0 = any free port) and resolves once it accepts connections. */
export function listen(
  fetch: (request: Request) => Response | Promise<Response>,
  port: number,
  hostname = '127.0.0.1',
) {
  return new Promise<Listening>((resolve) => {
    const server = serve({ fetch, port, hostname }, (info) => {
      resolve({
        url: `http://${hostname}:${info.port}`,
        port: info.port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            if ('closeAllConnections' in server) server.closeAllConnections();
          }),
      });
    });
  });
}
