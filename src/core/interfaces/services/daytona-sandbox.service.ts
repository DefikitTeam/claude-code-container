import {
  SandboxConfig,
  SandboxInfo,
  SandboxStatus,
} from '../../../shared/types/daytona.types';

export interface IDaytonaSandboxService {
  create(config: SandboxConfig): Promise<SandboxInfo>;
  executeCommand(sandboxId: string, command: string): Promise<any>; // Replace 'any' with a proper result type later
  delete(sandboxId: string): Promise<void>;
  getStatus(sandboxId: string): Promise<SandboxStatus>;
}
