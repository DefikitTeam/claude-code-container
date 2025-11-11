const CONTAINER_INSTANCE_ID = `${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 11)}`;

export interface LogDetails {
  [key: string]: unknown;
}

export function logWithContext(
  context: string,
  message: string,
  details?: LogDetails,
): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${context}] [${CONTAINER_INSTANCE_ID}]`;
  if (details && Object.keys(details).length > 0) {
    console.error(`${prefix} ${message}`, JSON.stringify(details));
  } else {
    console.error(`${prefix} ${message}`);
  }
}
