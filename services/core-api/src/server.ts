import { buildApp } from './app.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await buildApp({ config });

  await app.lifecycle.start();
  await app.listen({ host: config.host, port: config.port });

  let shuttingDown: Promise<void> | null = null;
  const shutdown = (): Promise<void> => {
    shuttingDown ??= app.close();
    return shuttingDown;
  };

  const handleSignal = () => {
    void shutdown().catch((error: unknown) => {
      app.log.error(error);
      process.exitCode = 1;
    });
  };

  process.once('SIGTERM', handleSignal);
  process.once('SIGINT', handleSignal);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
