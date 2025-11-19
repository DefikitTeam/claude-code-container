import type { UpdateUserDto } from '../../core/use-cases/user/update-user.use-case';
import { ValidationError } from '../../shared/errors/validation.error';
import {
  validateApiKey,
  validateRequired,
  validateUserId,
} from '../../shared/utils/validation.util';

export interface UpdateUserRequestBody {
  anthropicApiKey?: string;
  repositoryAccess?: string[];
}

export function parseUpdateUserDto(
  userId: string,
  body: UpdateUserRequestBody,
): UpdateUserDto {
  validateRequired(userId, 'userId');
  validateUserId(userId);

  const anthropicApiKey = body.anthropicApiKey?.trim();
  const repositoryAccess = Array.isArray(body.repositoryAccess)
    ? body.repositoryAccess.map((repo) => repo.trim()).filter(Boolean)
    : undefined;

  if (anthropicApiKey) {
    validateApiKey(anthropicApiKey);
  }

  if (repositoryAccess && repositoryAccess.length === 0) {
    throw new ValidationError(
      'repositoryAccess must contain at least one repository',
    );
  }

  return {
    userId,
    anthropicApiKey,
    repositoryAccess,
  };
}
