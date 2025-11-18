export interface StreamBrokerConfig {
  url?: string;
  key?: string;
  enabled: boolean;
}

export function getStreamBrokerConfig(): StreamBrokerConfig {
  const url = process.env.STREAM_BROKER_URL?.trim();
  const key = process.env.STREAM_BROKER_KEY?.trim();
  const enabled = !!url;
  return {
    url: url || undefined,
    key: key || undefined,
    enabled,
  };
}

export default getStreamBrokerConfig;
