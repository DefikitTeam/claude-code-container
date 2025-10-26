import { runHttpServer as runModularServer } from './api/http/server.js';

const LEGACY_FLAG = 'ACP_HTTP_SERVER_LEGACY';

export async function runHttpServer(argv: any = {}): Promise<void> {
  const forceLegacy = argv['legacy-http-server'] === true;
  const useLegacy = forceLegacy || process.env[LEGACY_FLAG] === '1';

  if (useLegacy) {
    const { runHttpServer: runLegacyServer } = await import('./http-server.legacy.js');
    await runLegacyServer(argv);
    return;
  }

  await runModularServer(argv);
}

export default runHttpServer;
