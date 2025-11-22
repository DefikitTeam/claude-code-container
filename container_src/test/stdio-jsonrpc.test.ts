import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as streaming from '../src/api/utils/streaming.js';
import { createStdioJSONRPCServer } from '../src/services/stdio-jsonrpc.js';

describe('StdioJSONRPCServer.sendNotification -> postToBroker integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.STREAM_BROKER_URL;
    delete process.env.STREAM_BROKER_KEY;
    delete process.env.STREAM_BROKER_ENABLED;
  });

  it('should call postToBroker and still write to stdout when env set', () => {
    process.env.STREAM_BROKER_URL = 'http://localhost:3000';
    process.env.STREAM_BROKER_ENABLED = '1';
    const server = createStdioJSONRPCServer();
    const postSpy = vi
      .spyOn(streaming, 'default')
      .mockImplementation(() => Promise.resolve());
    const stdoutWrite = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true as any);

    server.sendNotification('session/update', {
      sessionId: 'sess-1',
      status: 'working',
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        method: 'session/update',
        params: expect.objectContaining({
          sessionId: 'sess-1',
          status: 'working',
        }),
      }),
      undefined,
    );
    // Ensure seqNo and timestamp are included
    const postedEnvelope = (postSpy as any).mock.calls[0][1];
    expect(typeof postedEnvelope.params.seqNo).toBe('number');
    expect(typeof postedEnvelope.params.timestamp).toBe('number');
    expect(stdoutWrite).toHaveBeenCalled();
    stdoutWrite.mockRestore();
    postSpy.mockRestore();
  });

  it('should call postToBroker when params.stream=true even when env not set', () => {
    process.env.STREAM_BROKER_ENABLED = '1';
    const server = createStdioJSONRPCServer();
    const postSpy = vi
      .spyOn(streaming, 'default')
      .mockImplementation(() => new Promise(() => {}));
    const stdoutWrite = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true as any);

    server.sendNotification('session/update', {
      sessionId: 'sess-2',
      status: 'working',
      stream: true,
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith(
      'sess-2',
      expect.objectContaining({
        method: 'session/update',
        params: expect.objectContaining({
          sessionId: 'sess-2',
          status: 'working',
          stream: true,
        }),
      }),
      undefined,
    );
    const postedEnvelope2 = (postSpy as any).mock.calls[0][1];
    expect(typeof postedEnvelope2.params.seqNo).toBe('number');
    expect(typeof postedEnvelope2.params.timestamp).toBe('number');
    expect(stdoutWrite).toHaveBeenCalled();
    stdoutWrite.mockRestore();
    postSpy.mockRestore();
  });

  it('should not throw if postToBroker rejects and still write to stdout', () => {
    const postSpy = vi
      .spyOn(streaming, 'default')
      .mockImplementation(() => Promise.reject(new Error('fail')));
    const server = createStdioJSONRPCServer();
    const stdoutWrite = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true as any);

    expect(() =>
      server.sendNotification('session/update', {
        sessionId: 'sess-err',
        status: 'working',
      }),
    ).not.toThrow();
    expect(stdoutWrite).toHaveBeenCalled();
    stdoutWrite.mockRestore();
    postSpy.mockRestore();
  });

  it('should pass streamToken to postToBroker when provided', () => {
    process.env.STREAM_BROKER_URL = 'http://localhost:3000';
    process.env.STREAM_BROKER_ENABLED = '1';
    const token = 'token-abc';
    const postSpy = vi
      .spyOn(streaming, 'default')
      .mockImplementation(() => Promise.resolve());
    const server = createStdioJSONRPCServer();
    const stdoutWrite = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true as any);

    server.sendNotification('session/update', {
      sessionId: 'sess-tok',
      status: 'working',
      streamToken: token,
    });
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect((postSpy as any).mock.calls[0][2]).toBe(token);
    expect(stdoutWrite).toHaveBeenCalled();
    stdoutWrite.mockRestore();
    postSpy.mockRestore();
  });

  it('should not block stdout when postToBroker resolves later', async () => {
    let resolveFn: (val?: unknown) => void;
    const postSpy = vi.spyOn(streaming, 'default').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );
    const server = createStdioJSONRPCServer();
    const stdoutWrite = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true as any);

    server.sendNotification('session/update', {
      sessionId: 'sess-slow',
      status: 'working',
    });
    // stdout should be immediately written (non-blocking)
    expect(stdoutWrite).toHaveBeenCalled();
    // Now resolve postToBroker promise to clean up
    resolveFn?.();
    stdoutWrite.mockRestore();
    postSpy.mockRestore();
  });

  it('should not call postToBroker for non-session events', () => {
    process.env.STREAM_BROKER_URL = 'http://localhost:3000';
    process.env.STREAM_BROKER_ENABLED = '1';
    const server = createStdioJSONRPCServer();
    const postSpy = vi
      .spyOn(streaming, 'default')
      .mockImplementation(() => Promise.resolve());
    const stdoutWrite = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true as any);

    server.sendNotification('other/event', { foo: 'bar' });

    expect(postSpy).not.toHaveBeenCalled();
    expect(stdoutWrite).toHaveBeenCalled();
    stdoutWrite.mockRestore();
    postSpy.mockRestore();
  });

  it('should not call postToBroker when STREAM_BROKER_ENABLED explicitly disabled even if URL set', () => {
    process.env.STREAM_BROKER_URL = 'http://localhost:3000';
    process.env.STREAM_BROKER_ENABLED = '0';
    const server = createStdioJSONRPCServer();
    const postSpy = vi
      .spyOn(streaming, 'default')
      .mockImplementation(() => Promise.resolve());
    const stdoutWrite = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true as any);

    server.sendNotification('session/update', {
      sessionId: 'sess-disabled',
      status: 'working',
    });

    expect(postSpy).not.toHaveBeenCalled();
    expect(stdoutWrite).toHaveBeenCalled();
    stdoutWrite.mockRestore();
    postSpy.mockRestore();
  });

  it('should not call postToBroker when params.stream=true but STREAM_BROKER_ENABLED disabled', () => {
    process.env.STREAM_BROKER_ENABLED = '0';
    const server = createStdioJSONRPCServer();
    const postSpy = vi
      .spyOn(streaming, 'default')
      .mockImplementation(() => Promise.resolve());
    const stdoutWrite = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true as any);

    server.sendNotification('session/update', {
      sessionId: 'sess-disabled-2',
      status: 'working',
      stream: true,
    });

    expect(postSpy).not.toHaveBeenCalled();
    expect(stdoutWrite).toHaveBeenCalled();
    stdoutWrite.mockRestore();
    postSpy.mockRestore();
  });
});
