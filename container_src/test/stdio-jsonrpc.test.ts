import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as streaming from '../src/api/utils/streaming.js';
import { createStdioJSONRPCServer } from '../src/services/stdio-jsonrpc.js';

describe('StdioJSONRPCServer.sendNotification -> postToBroker integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.STREAM_BROKER_URL;
    delete process.env.STREAM_BROKER_KEY;
  });

  it('should call postToBroker and still write to stdout when env set', () => {
    process.env.STREAM_BROKER_URL = 'http://localhost:3000';
    const server = createStdioJSONRPCServer();
    const postSpy = vi.spyOn(streaming, 'default').mockImplementation(() => Promise.resolve());
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as any);

    server.sendNotification('session/update', { sessionId: 'sess-1', status: 'working' });

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        method: 'session/update',
        params: expect.objectContaining({ sessionId: 'sess-1', status: 'working' }),
      }),
      undefined,
    );
    expect(stdoutWrite).toHaveBeenCalled();
    stdoutWrite.mockRestore();
    postSpy.mockRestore();
  });

  it('should call postToBroker when params.stream=true even when env not set', () => {
    const server = createStdioJSONRPCServer();
    const postSpy = vi.spyOn(streaming, 'default').mockImplementation(() => Promise.resolve());
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as any);

    server.sendNotification('session/update', { sessionId: 'sess-2', status: 'working', stream: true });

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith(
      'sess-2',
      expect.objectContaining({
        method: 'session/update',
        params: expect.objectContaining({ sessionId: 'sess-2', status: 'working', stream: true }),
      }),
      undefined,
    );
    expect(stdoutWrite).toHaveBeenCalled();
    stdoutWrite.mockRestore();
    postSpy.mockRestore();
  });

  it('should not call postToBroker for non-session events', () => {
    process.env.STREAM_BROKER_URL = 'http://localhost:3000';
    const server = createStdioJSONRPCServer();
    const postSpy = vi.spyOn(streaming, 'default').mockImplementation(() => Promise.resolve());
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as any);

    server.sendNotification('other/event', { foo: 'bar' });

    expect(postSpy).not.toHaveBeenCalled();
    expect(stdoutWrite).toHaveBeenCalled();
    stdoutWrite.mockRestore();
    postSpy.mockRestore();
  });
});
