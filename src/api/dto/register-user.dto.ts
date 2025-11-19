import {
  validateApiKey,
  validateInstallationId,
  validateRequired,
  validateUserId,
} from '../../shared/utils/validation.util';
import type { RegisterUserDto } from '../../core/use-cases/user/register-user.use-case';

export interface RegisterUserRequestBody {
  userId?: string;
  installationId?: string;
  anthropicApiKey?: string;
  repositoryAccess?: string[];
  projectLabel?: string;
}

export interface RegisterUserRequestContext {
  defaultUserId?: string;
  defaultInstallationId?: string;
}

export function parseRegisterUserDto(
  body: RegisterUserRequestBody,
  context: RegisterUserRequestContext = {},
): RegisterUserDto {
  const userId = sanitizeOptional(body.userId ?? context.defaultUserId);
  const installationId = sanitize(
    body.installationId ?? context.defaultInstallationId,
    'installationId',
  );
  const anthropicApiKey = sanitizeOptional(body.anthropicApiKey); // Optional - worker uses its own key
  const projectLabel = sanitizeOptional(body.projectLabel);
  const repositoryAccess = Array.isArray(body.repositoryAccess)
    ? body.repositoryAccess.map((repo) => repo.trim()).filter(Boolean)
    : [];

  if (userId) {
    validateUserId(userId);
  }

  validateInstallationId(installationId);

  // Only validate API key if provided (optional now)
  if (anthropicApiKey) {
    validateApiKey(anthropicApiKey);
  }

  return {
    userId: userId ?? createDefaultUserId(installationId),
    installationId,
    anthropicApiKey,
    repositoryAccess,
    projectLabel: projectLabel ?? undefined,
  };
}

function sanitize(value: string | undefined, field: string): string {
  validateRequired(value, field);
  return (value ?? '').trim();
}

function sanitizeOptional(value?: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function createDefaultUserId(installationId: string): string {
  return `user-${installationId}-${Date.now()}`;
}
