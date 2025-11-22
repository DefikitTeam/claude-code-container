export interface StreamBrokerConfig {
  url?: string;
  key?: string;
  enabled: boolean;
}

export function getStreamBrokerConfig(): StreamBrokerConfig {
  const url = process.env.STREAM_BROKER_URL?.trim();
  const key = process.env.STREAM_BROKER_KEY?.trim();
  const rawEnabled = process.env.STREAM_BROKER_ENABLED;
  let enabled: boolean;
  if (rawEnabled !== undefined) {
    enabled = ['1', 'true', 'yes', 'on'].includes(rawEnabled.toLowerCase());
  } else {
    // Default: enabled when URL is provided
    enabled = !!url;
  }
  return {
    url: url || undefined,
    key: key || undefined,
    enabled,
  };
}

export default getStreamBrokerConfig;
