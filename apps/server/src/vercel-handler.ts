import type { IncomingMessage, ServerResponse } from 'node:http';
import { getHostedApp } from './runtime.js';

let appPromise: ReturnType<typeof getHostedApp> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  appPromise ??= getHostedApp();
  const app = await appPromise;
  await app.ready();
  app.server.emit('request', req, res);
}
