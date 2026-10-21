import { startServer } from './support.js';

/** One seeded server for the whole run, on a throwaway data folder. Stopped by its PID. */
export default async function globalSetup() {
  const server = await startServer({ LEAVEOS_SEED_DEMO: 'true' });
  process.env.E2E_BASE_URL = server.url;
  return server.stop;
}
