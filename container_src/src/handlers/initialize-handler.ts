import { acpState } from './acp-state.js';
import type {
  InitializeRequest,
  InitializeResponse,
} from '../types/acp-messages.js';
import { RequestContext } from '../services/stdio-jsonrpc.js';

// Lightweight validation mirroring monolith semantics
export async function initializeHandler(
  params: InitializeRequest['params'],
  requestContext: RequestContext,
): Promise<InitializeResponse['result']> {
  if (!params || typeof params.protocolVersion !== 'string') {
    throw Object.assign(new Error('Invalid params: protocolVersion required'), {
      code: -32602,
    });
  }

  const { protocolVersion, clientCapabilities, clientInfo } = params;
  const supportedVersion = '0.3.1';
  if (!protocolVersion.startsWith('0.3.')) {
    throw Object.assign(
      new Error(
        `Incompatible protocol version: ${protocolVersion} (expected ${supportedVersion})`,
      ),
      { code: -32602 },
    );
  }

  if (clientInfo) acpState.setClientInfo(clientInfo);
  acpState.setInitialized(true);
  acpState.setInitializationTime(Date.now());
  console.error(`[INIT] Agent initialized: ${acpState.isInitialized()}`);

  const response: InitializeResponse['result'] = {
    protocolVersion: supportedVersion,
    agentCapabilities: acpState.getAgentCapabilities(),
    agentInfo: acpState.getAgentInfo(),
  };

  // (Optional) annotate with clientCapabilities echo in development
  if (process.env.NODE_ENV === 'development') {
    (response as Record<string, unknown>).clientCapabilities = clientCapabilities;  
    (response as Record<string, unknown>).clientInfo = acpState.getClientInfo();
  }
  return response;
}

export default initializeHandler;
