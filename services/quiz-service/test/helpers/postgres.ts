import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

export interface TestPostgres {
  readonly connectionString: string;
  stop(): Promise<void>;
}

/** Starts a real `postgres:16-alpine` container. Docker unavailability is an environmental failure. */
export async function startTestPostgres(): Promise<TestPostgres> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:16-alpine').start();

  return {
    connectionString: container.getConnectionUri(),
    async stop(): Promise<void> {
      await container.stop();
    },
  };
}
