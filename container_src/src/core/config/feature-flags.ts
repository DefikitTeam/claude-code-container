export function isTrue(flagValue: string | undefined): boolean {
  if (!flagValue) return false;
  const normalized = flagValue.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function useDomainEntities(): boolean {
  return isTrue(process.env.USE_DOMAIN_ENTITIES);
}

export const featureFlags = {
  useDomainEntities,
};
