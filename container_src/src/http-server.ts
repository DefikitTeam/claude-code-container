import { runHttpServer as runModularServer } from './api/http/server.js';

export async function runHttpServer(argv: any = {}): Promise<void> {
  await runModularServer(argv);
}

export default runHttpServer;
