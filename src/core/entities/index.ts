/**
 * Core Entities - Pure business models with validation
 * No dependencies on repositories or external services
 */

export { UserEntity, type UserProps } from './user.entity';
export {
  InstallationEntity,
  type InstallationProps,
} from './installation.entity';
export {
  ContainerConfigEntity,
  type ContainerConfigProps,
} from './container-config.entity';
export {
  DeploymentEntity,
  type DeploymentProps,
  type DeploymentStatus,
} from './deployment.entity';
