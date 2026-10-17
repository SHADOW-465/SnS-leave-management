import { pathsFor } from '@sns/config';
import { lanAddress } from './host-local.js';
import { readLanHostname } from './hostname.js';
import { createRuntime } from './runtime.js';
import { startStaffSetup } from './setup-http.js';

const runtime = await createRuntime();
const { app, config } = runtime;
const host = config.bindAll ? '0.0.0.0' : config.host;
let stopDiscovery = () => {};
let stopSetup = async () => {};

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
    if (config.tlsEnabled && config.env !== 'test' && !config.hostedPreview) {
      try {
        const setup = await startStaffSetup({
          hostname: await readLanHostname(runtime.db),
          httpsPort: config.port,
          certDir: pathsFor(config).certs,
          log: (message) => app.log.info(message),
        });
        if (setup) {
          stopSetup = setup.close;
        } else {
          app.log.error('The staff setup page could not listen on port 80 or 8080.');
        }
      } catch (err) {
        app.log.error({ err }, 'The staff setup page did not start.');
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
  await stopSetup();
  await runtime.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

export default app;
