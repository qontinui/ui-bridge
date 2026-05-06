/**
 * End-to-end smoke test for the WebSocket wrapper example.
 *
 * Pipeline:
 *   1. Spawn a temp runner via the supervisor on port 9875.
 *   2. Wait for `/health` to return 200.
 *   3. Launch this package's `src/index.ts` as a child process pointed at the
 *      runner's `/ui-bridge/ws`.
 *   4. Wait for the wrapper to log `handshake complete`.
 *   5. Hit the retrofitted SDK control routes via fetch and assert the
 *      response shape contains the wrapper handler's distinctive markers
 *      (proves the WS path fired — HTTP fallback would 502 or return IPC
 *      shape).
 *   6. SIGTERM the wrapper, ask the supervisor to stop the runner.
 *
 * The supervisor must be running on `http://127.0.0.1:9875` for the test to
 * pass. Spawn happens with `rebuild: false` to keep the smoke fast.
 *
 * Skipped automatically in environments without a supervisor at SUPERVISOR_URL.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const SUPERVISOR_URL = process.env.SUPERVISOR_URL ?? 'http://127.0.0.1:9875';
const SPAWN_TIMEOUT_MS = 60_000;
const WRAPPER_READY_TIMEOUT_MS = 15_000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');
const WRAPPER_ENTRY = resolve(PACKAGE_ROOT, 'src/index.ts');

interface SpawnResponse {
  runner_id?: string;
  id?: string;
  port?: number;
  runner_port?: number;
}

// Top-level await is supported under vitest + ESM. probeSupervisor is hoisted
// (`async function` declaration), so this resolves before the describe block
// is registered, letting describe.skipIf gate the entire suite.
const SUPERVISOR_AVAILABLE = await probeSupervisor();

let runnerId: string | null = null;
let runnerPort: number | null = null;
let wrapperProc: ChildProcess | null = null;
let wrapperOutput = '';

async function jsonFetch<T>(
  method: string,
  url: string,
  body?: unknown
): Promise<{ status: number; data: T }> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  // `fetch` doesn't throw on non-2xx; we want the body either way.
  let data: T;
  try {
    data = (await res.json()) as T;
  } catch {
    data = {} as T;
  }
  return { status: res.status, data };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForRunnerHealth(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.status === 200) return true;
    } catch {
      // not yet up
    }
    await sleep(1000);
  }
  return false;
}

async function probeSupervisor(): Promise<boolean> {
  try {
    const res = await fetch(`${SUPERVISOR_URL}/health`);
    return res.status === 200;
  } catch {
    return false;
  }
}

async function startWrapper(port: number): Promise<void> {
  const env = {
    ...process.env,
    RUNNER_URL: `ws://127.0.0.1:${port}/ui-bridge/ws`,
    APP_ID: `wrapper-live-example-smoke-${process.pid}`,
    APP_NAME: 'Wrapper Live Example (Smoke)',
  };
  // `tsx` is in this package's devDependencies; resolve via npx-equivalent.
  // Use `node --import tsx` for ESM TS execution (matches the `start` script).
  const proc = spawn(process.execPath, ['--import', 'tsx', WRAPPER_ENTRY], {
    cwd: PACKAGE_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  wrapperProc = proc;
  proc.stdout?.on('data', (chunk) => {
    const text = String(chunk);
    wrapperOutput += text;
    // eslint-disable-next-line no-console
    process.stdout.write(`[wrapper] ${text}`);
  });
  proc.stderr?.on('data', (chunk) => {
    const text = String(chunk);
    wrapperOutput += text;
    // eslint-disable-next-line no-console
    process.stderr.write(`[wrapper] ${text}`);
  });

  const deadline = Date.now() + WRAPPER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (wrapperOutput.includes('handshake complete')) return;
    if (proc.exitCode !== null) {
      throw new Error(
        `Wrapper exited early with code ${proc.exitCode}.\nOutput:\n${wrapperOutput}`
      );
    }
    await sleep(250);
  }
  throw new Error(
    `Wrapper did not log "handshake complete" within ${WRAPPER_READY_TIMEOUT_MS}ms.\nOutput:\n${wrapperOutput}`
  );
}

async function stopWrapper(): Promise<void> {
  const proc = wrapperProc;
  wrapperProc = null;
  if (!proc || proc.exitCode !== null) return;
  await new Promise<void>((res) => {
    proc.once('exit', () => res());
    proc.kill('SIGTERM');
    // Hard kill after 3s if it didn't exit gracefully.
    setTimeout(() => {
      if (proc.exitCode === null) {
        try {
          proc.kill('SIGKILL');
        } catch {
          // ignore
        }
        res();
      }
    }, 3000);
  });
}

describe.skipIf(!SUPERVISOR_AVAILABLE)('wrapper-live-example WS dispatch', () => {
  beforeAll(
    async () => {
      // Spawn a temp runner with the cached binary (rebuild:false for speed —
      // the WS bridge already exists in the binary as of db36037d9).
      const requesterId = `wrapper-live-example-smoke-${process.pid}`;
      const spawnRes = await jsonFetch<SpawnResponse>(
        'POST',
        `${SUPERVISOR_URL}/runners/spawn-test`,
        {
          rebuild: false,
          wait: true,
          requester_id: requesterId,
          queue_timeout_secs: 60,
        }
      );
      if (spawnRes.status !== 200 && spawnRes.status !== 201) {
        throw new Error(
          `spawn-test failed: status=${spawnRes.status} body=${JSON.stringify(spawnRes.data)}`
        );
      }
      runnerId = spawnRes.data.runner_id ?? spawnRes.data.id ?? null;
      runnerPort = spawnRes.data.port ?? spawnRes.data.runner_port ?? null;
      if (!runnerId || !runnerPort) {
        throw new Error(
          `Could not parse runner_id/port from spawn response: ${JSON.stringify(spawnRes.data)}`
        );
      }

      const ready = await waitForRunnerHealth(runnerPort, SPAWN_TIMEOUT_MS);
      if (!ready)
        throw new Error(
          `Runner ${runnerId} on port ${runnerPort} did not become healthy in ${SPAWN_TIMEOUT_MS}ms`
        );

      await startWrapper(runnerPort);
    },
    SPAWN_TIMEOUT_MS + WRAPPER_READY_TIMEOUT_MS + 5_000
  );

  afterAll(async () => {
    await stopWrapper();
    if (runnerId) {
      try {
        await fetch(`${SUPERVISOR_URL}/runners/${runnerId}/stop`, { method: 'POST' });
      } catch {
        // best-effort cleanup
      }
    }
  }, 30_000);

  it('returns the wrapper handler shape from GET /ui-bridge/sdk/control/snapshot (proves WS path fired)', async () => {
    if (!runnerPort) throw new Error('no runner port');
    const { status, data } = await jsonFetch<{
      success: boolean;
      data?: {
        elements?: Array<{ id: string }>;
        url?: string;
        title?: string;
      };
    }>('GET', `http://127.0.0.1:${runnerPort}/ui-bridge/sdk/control/snapshot`);
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    // Distinctive markers from the wrapper's getControlSnapshot handler.
    expect(data.data?.url).toBe('ws-app://wrapper-live-example');
    expect(data.data?.title).toBe('Wrapper Live Example');
    expect(data.data?.elements?.map((e) => e.id)).toContain('sample.button.submit');
  });

  it('returns the wrapper handler shape from GET /ui-bridge/sdk/control/element/:id', async () => {
    if (!runnerPort) throw new Error('no runner port');
    const { status, data } = await jsonFetch<{
      success: boolean;
      data?: { id?: string; type?: string; label?: string };
    }>('GET', `http://127.0.0.1:${runnerPort}/ui-bridge/sdk/control/element/sample.input.email`);
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data?.id).toBe('sample.input.email');
    expect(data.data?.type).toBe('input');
    expect(data.data?.label).toBe('Email');
  });

  it('returns the wrapper handler shape from POST /ui-bridge/sdk/control/element/:id/action', async () => {
    if (!runnerPort) throw new Error('no runner port');
    const { status, data } = await jsonFetch<{
      success: boolean;
      data?: { elementId?: string; action?: string; executedAt?: number };
    }>(
      'POST',
      `http://127.0.0.1:${runnerPort}/ui-bridge/sdk/control/element/sample.button.submit/action`,
      {
        action: 'click',
      }
    );
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data?.elementId).toBe('sample.button.submit');
    expect(data.data?.action).toBe('click');
    expect(typeof data.data?.executedAt).toBe('number');
  });

  it('returns the wrapper handler shape from GET /ui-bridge/sdk/control/forms', async () => {
    if (!runnerPort) throw new Error('no runner port');
    const { status, data } = await jsonFetch<{
      success: boolean;
      data?: { forms?: Array<{ formId?: string; fields?: unknown[] }> };
    }>('GET', `http://127.0.0.1:${runnerPort}/ui-bridge/sdk/control/forms`);
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data?.forms?.[0]?.formId).toBe('sample.form.signin');
    expect(data.data?.forms?.[0]?.fields?.length).toBe(2);
  });

  it('returns the wrapper handler shape from POST /ui-bridge/sdk/control/fill', async () => {
    if (!runnerPort) throw new Error('no runner port');
    const { status, data } = await jsonFetch<{
      success: boolean;
      data?: {
        formId?: string;
        filledCount?: number;
        filled?: Array<{ name: string; value: unknown }>;
      };
    }>('POST', `http://127.0.0.1:${runnerPort}/ui-bridge/sdk/control/fill`, {
      formId: 'sample.form.signin',
      values: { email: 'a@b.c', password: 'pw' },
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data?.formId).toBe('sample.form.signin');
    expect(data.data?.filledCount).toBe(2);
    const names = data.data?.filled?.map((f) => f.name) ?? [];
    expect(names).toEqual(expect.arrayContaining(['email', 'password']));
  });
});
