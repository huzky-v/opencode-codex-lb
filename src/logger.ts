import { SERVICE, type LogLevel } from "./types.js"

export async function log(
  level: LogLevel,
  message: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    const details = extra === undefined ? "" : ` ${JSON.stringify(extra)}`
    console[level](`[${SERVICE}] ${message}${details}`)
  } catch {
    // Ignore logging failures to keep startup resilient.
  }
}
