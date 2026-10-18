import { serve } from '@hono/node-server';

export interface Listening {
  url: string;
  port: number;
  close(): Promise<void>;
}

/** Serves `fetch` on `port` (0 = any free port) and resolves once it accepts connections. */
export function listen(fetch: (request: Request) => Response | Promise<Response>, port: number) {
  return new Promise<Listening>((resolve) => {
    const server = serve({ fetch, port, hostname: '127.0.0.1' }, (info) => {
      resolve({
        url: `http://127.0.0.1:${info.port}`,
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
