import { ValidationError } from '../../shared/errors/validation.error';

export interface CreatePRDTO {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  installationId: string;
}

export function parseCreatePRDTO(
  body: any,
  installationId: string,
): CreatePRDTO {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Invalid PR data: body must be an object');
  }

  const { repository, title, body: prBody, head, base } = body;

  if (!repository || typeof repository !== 'string') {
    throw new ValidationError(
      'Invalid PR data: repository is required (format: owner/repo)',
    );
  }

  // Parse owner/repo format
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) {
    throw new ValidationError(
      'Invalid PR data: repository must be in owner/repo format',
    );
  }

  if (!title || typeof title !== 'string') {
    throw new ValidationError('Invalid PR data: title is required');
  }

  if (!head || typeof head !== 'string') {
    throw new ValidationError('Invalid PR data: head branch is required');
  }

  if (!base || typeof base !== 'string') {
    throw new ValidationError('Invalid PR data: base branch is required');
  }

  return {
    owner,
    repo,
    title,
    body: prBody || '',
    head,
    base,
    installationId,
  };
}
