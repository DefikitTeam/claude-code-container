import { z } from 'zod';

const gitInfoSchema = z
  .object({
    currentBranch: z.string().optional(),
    hasUncommittedChanges: z.boolean().optional(),
    remoteUrl: z.string().optional(),
    lastCommit: z.string().optional(),
  })
  .partial();

const workspaceSchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
  isEphemeral: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  gitInfo: gitInfoSchema.nullable().optional(),
});

type WorkspaceSchema = z.infer<typeof workspaceSchema>;

export class WorkspaceEntity {
  private readonly props: WorkspaceSchema;

  private constructor(props: WorkspaceSchema) {
    this.props = props;
  }

  static fromDescriptor(descriptor: WorkspaceSchema): WorkspaceEntity {
    const parsed = workspaceSchema.parse(descriptor);
    return new WorkspaceEntity({
      ...parsed,
      gitInfo: parsed.gitInfo
        ? { ...parsed.gitInfo }
        : (parsed.gitInfo ?? null),
    });
  }

  get sessionId(): string {
    return this.props.sessionId;
  }

  get path(): string {
    return this.props.path;
  }

  get isEphemeral(): boolean {
    return this.props.isEphemeral;
  }

  get createdAt(): number {
    return this.props.createdAt;
  }

  get gitInfo(): WorkspaceSchema['gitInfo'] {
    return this.props.gitInfo
      ? { ...this.props.gitInfo }
      : (this.props.gitInfo ?? null);
  }

  hasChanges(): boolean {
    return this.props.gitInfo?.hasUncommittedChanges === true;
  }

  shouldCleanup(): boolean {
    return this.props.isEphemeral;
  }

  toJSON(): WorkspaceSchema {
    return {
      sessionId: this.props.sessionId,
      path: this.props.path,
      isEphemeral: this.props.isEphemeral,
      createdAt: this.props.createdAt,
      gitInfo: this.props.gitInfo
        ? { ...this.props.gitInfo }
        : (this.props.gitInfo ?? null),
    };
  }
}

export default WorkspaceEntity;
