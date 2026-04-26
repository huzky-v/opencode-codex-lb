import { SERVICE, type AppClient, type LogLevel } from "./types.js"

export async function log(
  client: AppClient,
  level: LogLevel,
  message: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    await client.app.log({
      body: {
        service: SERVICE,
        level,
        message,
        extra,
      },
    })
  } catch {
    // Ignore logging failures to keep startup resilient.
  }
}
