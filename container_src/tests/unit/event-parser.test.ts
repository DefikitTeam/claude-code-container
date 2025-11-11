import { describe, it, expect } from 'vitest';
import { EventParser } from '../../src/services/openhands/event-parser.js';

describe('EventParser', () => {
  it('parses a valid event and returns non-null', () => {
    const parser = new EventParser();
    const ev = { id: 'evt-1', type: 'message', timestamp: new Date().toISOString(), payload: { text: 'hello' } };
    const parsed = parser.parse(ev);
    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe('evt-1');
  });

  it('deduplicates duplicate events using parseAndAdd', () => {
    const parser = new EventParser();
    const ev = { id: 'evt-dup', type: 'message', timestamp: new Date().toISOString(), payload: { text: 'x' } };
    const first = parser.parseAndAdd(ev);
    const second = parser.parseAndAdd(ev);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('respects maxBuffer and trims older events', () => {
    const parser = new EventParser({ maxBuffer: 2 });
    const ev1 = { id: 'e1', type: 'message', timestamp: new Date().toISOString() };
    const ev2 = { id: 'e2', type: 'message', timestamp: new Date().toISOString() };
    const ev3 = { id: 'e3', type: 'message', timestamp: new Date().toISOString() };
    parser.addEvent(ev1 as any);
    parser.addEvent(ev2 as any);
    parser.addEvent(ev3 as any);
    const buf = parser.getBuffer();
    expect(buf.length).toBeLessThanOrEqual(2);
    // oldest (e1) should have been removed
    expect(buf.find((b) => b.id === 'e1')).toBeUndefined();
  });
});
