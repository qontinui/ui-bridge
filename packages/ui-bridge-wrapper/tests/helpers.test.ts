import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../src/helpers/retry.js';
import { withAuthRefresh } from '../src/helpers/auth.js';
import { paramSchemaOf } from '../src/helpers/schema.js';
import { WrapperTransportError } from '../src/types.js';

describe('withRetry', () => {
  it('succeeds on first try without sleeping', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const result = await withRetry(async () => 'ok', { sleep });
    expect(result).toBe('ok');
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries and eventually succeeds', async () => {
    let calls = 0;
    const sleep = vi.fn(async (_ms: number) => {});
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('transient');
        return 'ok';
      },
      { attempts: 5, baseMs: 10, sleep }
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    // Two failures => two sleeps.
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up after N attempts and rethrows the last error', async () => {
    let calls = 0;
    const sleep = vi.fn(async (_ms: number) => {});
    const err = new Error('still broken');
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw err;
        },
        { attempts: 3, baseMs: 1, sleep }
      )
    ).rejects.toBe(err);
    expect(calls).toBe(3);
    // N-1 sleeps between the three attempts.
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retryable WrapperTransportError', async () => {
    let calls = 0;
    const err = new WrapperTransportError('NOPE', 'fatal', { retryable: false });
    await expect(
      withRetry(async () => {
        calls += 1;
        throw err;
      })
    ).rejects.toBe(err);
    expect(calls).toBe(1);
  });

  it('retries retryable WrapperTransportError', async () => {
    let calls = 0;
    const sleep = vi.fn(async (_ms: number) => {});
    const err = new WrapperTransportError('SOCKET', 'try again', {
      retryable: true,
    });
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw err;
        },
        { attempts: 3, baseMs: 1, sleep }
      )
    ).rejects.toBe(err);
    expect(calls).toBe(3);
  });

  it('honors custom shouldRetry predicate', async () => {
    let calls = 0;
    const err = new Error('flag-controlled');
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw err;
        },
        { attempts: 5, baseMs: 1, shouldRetry: () => false }
      )
    ).rejects.toBe(err);
    expect(calls).toBe(1);
  });
});

describe('withAuthRefresh', () => {
  it('runs fn once when no auth error occurs', async () => {
    const refresh = vi.fn(async () => {});
    const fn = vi.fn(async () => 'ok');
    const result = await withAuthRefresh(fn, refresh);
    expect(result).toBe('ok');
    expect(refresh).not.toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('refreshes and retries once on an auth-code WrapperTransportError', async () => {
    let calls = 0;
    const refresh = vi.fn(async () => {});
    const result = await withAuthRefresh(async () => {
      calls += 1;
      if (calls === 1) {
        throw new WrapperTransportError('AUTH_EXPIRED', 'token dead');
      }
      return 'ok';
    }, refresh);
    expect(result).toBe('ok');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
  });

  it('refreshes on 401-status errors', async () => {
    let calls = 0;
    const refresh = vi.fn(async () => {});
    const result = await withAuthRefresh(async () => {
      calls += 1;
      if (calls === 1) {
        const err = Object.assign(new Error('unauthorized'), { status: 401 });
        throw err;
      }
      return 'ok';
    }, refresh);
    expect(result).toBe('ok');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('rethrows unrelated errors without refreshing', async () => {
    const refresh = vi.fn(async () => {});
    const err = new Error('server down');
    await expect(
      withAuthRefresh(async () => {
        throw err;
      }, refresh)
    ).rejects.toBe(err);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not loop if the retry also fails with an auth error', async () => {
    const refresh = vi.fn(async () => {});
    let calls = 0;
    await expect(
      withAuthRefresh(async () => {
        calls += 1;
        throw new WrapperTransportError('AUTH_EXPIRED', 'still dead');
      }, refresh)
    ).rejects.toBeInstanceOf(WrapperTransportError);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
  });
});

describe('paramSchemaOf', () => {
  it('produces a JSON-Schema-subset object for primitive types', () => {
    const schema = paramSchemaOf({
      email: 'string',
      password: 'string',
      remember: 'boolean',
    });
    expect(schema).toEqual({
      type: 'object',
      properties: {
        email: { type: 'string' },
        password: { type: 'string' },
        remember: { type: 'boolean' },
      },
      required: ['email', 'password', 'remember'],
      additionalProperties: false,
    });
  });

  it('accepts full JSON-Schema objects for fields and strips `optional`', () => {
    const schema = paramSchemaOf({
      mode: { type: 'string', enum: ['fast', 'slow'] },
      verbose: { type: 'boolean', optional: true },
    });
    expect(schema).toEqual({
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['fast', 'slow'] },
        verbose: { type: 'boolean' },
      },
      required: ['mode'],
      additionalProperties: false,
    });
  });

  it('drops null/undefined entries', () => {
    const schema = paramSchemaOf({
      keep: 'string',
      skipUndef: undefined,
      skipNull: null,
    });
    expect(schema).toEqual({
      type: 'object',
      properties: { keep: { type: 'string' } },
      required: ['keep'],
      additionalProperties: false,
    });
  });

  it('omits required when every field is optional', () => {
    const schema = paramSchemaOf({
      flag: { type: 'boolean', optional: true },
    });
    expect(schema).toEqual({
      type: 'object',
      properties: { flag: { type: 'boolean' } },
      additionalProperties: false,
    });
  });
});

describe('WrapperTransportError', () => {
  it('exposes structured details when provided', () => {
    const details = { registeredElements: [{ id: 'btn-1', role: 'button' }], elementCount: 3 };
    const err = new WrapperTransportError('INJECTED_EXPECT_SELECTOR_UNMET', 'unmet', {
      retryable: true,
      details,
    });
    expect(err.details).toBe(details);
    expect(err.retryable).toBe(true);
    expect(err.code).toBe('INJECTED_EXPECT_SELECTOR_UNMET');
  });

  it('leaves details undefined when not provided', () => {
    const err = new WrapperTransportError('X', 'no details');
    expect(err.details).toBeUndefined();
  });
});
