import { ValidationError } from '../../shared/errors/validation.error';

export interface InstallationProps {
  installationId: string;
  appId: string;
  encryptedPrivateKey: {
    encryptedData: Uint8Array;
    iv: Uint8Array;
  };
  encryptedWebhookSecret: {
    encryptedData: Uint8Array;
    iv: Uint8Array;
  };
  created: number;
  updated: number;
  isActive: boolean;
}

/**
 * Installation Entity - Represents a GitHub App installation
 * Stores encrypted credentials for secure storage
 */
export class InstallationEntity {
  private props: InstallationProps;

  constructor(props: InstallationProps) {
    this.validate(props);
    this.props = props;
  }

  private validate(props: InstallationProps): void {
    if (!props.installationId || typeof props.installationId !== 'string') {
      throw new ValidationError('installationId must be a non-empty string');
    }

    if (!props.appId || typeof props.appId !== 'string') {
      throw new ValidationError('appId must be a non-empty string');
    }

    if (!props.encryptedPrivateKey?.encryptedData || !props.encryptedPrivateKey?.iv) {
      throw new ValidationError('encryptedPrivateKey must contain encryptedData and iv');
    }

    if (!props.encryptedWebhookSecret?.encryptedData || !props.encryptedWebhookSecret?.iv) {
      throw new ValidationError('encryptedWebhookSecret must contain encryptedData and iv');
    }

    if (typeof props.created !== 'number' || props.created <= 0) {
      throw new ValidationError('created must be a positive number');
    }

    if (typeof props.updated !== 'number' || props.updated <= 0) {
      throw new ValidationError('updated must be a positive number');
    }

    if (typeof props.isActive !== 'boolean') {
      throw new ValidationError('isActive must be a boolean');
    }
  }

  // Getters
  get installationId(): string { return this.props.installationId; }
  get appId(): string { return this.props.appId; }
  get encryptedPrivateKey() { return this.props.encryptedPrivateKey; }
  get encryptedWebhookSecret() { return this.props.encryptedWebhookSecret; }
  get created(): number { return this.props.created; }
  get updated(): number { return this.props.updated; }
  get isActive(): boolean { return this.props.isActive; }

  /**
   * Create a new installation
   */
  static create(
    installationId: string,
    appId: string,
    encryptedPrivateKey: { encryptedData: Uint8Array; iv: Uint8Array },
    encryptedWebhookSecret: { encryptedData: Uint8Array; iv: Uint8Array }
  ): InstallationEntity {
    const now = Date.now();
    return new InstallationEntity({
      installationId,
      appId,
      encryptedPrivateKey,
      encryptedWebhookSecret,
      created: now,
      updated: now,
      isActive: true,
    });
  }

  /**
   * Deactivate installation
   */
  deactivate(): InstallationEntity {
    return new InstallationEntity({
      ...this.props,
      isActive: false,
      updated: Date.now(),
    });
  }

  /**
   * Get props for storage/serialization
   */
  getProps(): InstallationProps {
    return { ...this.props };
  }
}
