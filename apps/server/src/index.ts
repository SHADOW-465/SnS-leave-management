import { createRuntime } from './runtime.js';

const runtime = await createRuntime();
const { app, config } = runtime;
const host = config.bindAll ? '0.0.0.0' : config.host;

if (!process.env.VERCEL) {
  try {
    await app.listen({ port: config.port, host });
    app.log.info(`Leave OS listening on http://${host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

async function shutdown(signal: string) {
  app.log.info({ signal }, 'graceful shutdown');
  await runtime.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

export default app;
