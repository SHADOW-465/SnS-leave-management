import { lanAddress } from './host-local.js';
import { readLanHostname } from './hostname.js';
import { createRuntime } from './runtime.js';

const runtime = await createRuntime();
const { app, config } = runtime;
const host = config.bindAll ? '0.0.0.0' : config.host;
let stopDiscovery = () => {};

if (process.argv.includes('--prepare')) {
  app.log.info('Prepared the data folder, backup folder, and local certificate.');
  await runtime.close();
  process.exit(0);
}

if (!process.env.VERCEL) {
  try {
    await app.listen({ port: config.port, host });
    const scheme = config.tlsEnabled ? 'https' : 'http';
    app.log.info(`Leave OS listening on ${scheme}://${host}:${config.port}`);
    if (config.env === 'production' && !config.hostedPreview) {
      try {
        const { publishLanName } = await import('./discovery.js');
        const published = await publishLanName({
          hostname: await readLanHostname(runtime.db),
          port: config.port,
          address: lanAddress(),
        });
        stopDiscovery = published.stop;
      } catch (err) {
        app.log.error({ err }, 'The office name was not published. The IP address still works.');
      }
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

async function shutdown(signal: string) {
  app.log.info({ signal }, 'graceful shutdown');
  stopDiscovery();
  await runtime.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

export default app;
