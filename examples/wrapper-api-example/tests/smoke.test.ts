/**
 * End-to-end smoke for the api transport.
 *
 * Pipeline:
 *   1. Start a tiny in-memory todo server on a random port using `node:http`.
 *   2. Construct `ApiTransport` and a `fetch`-backed `apiClient` rooted at
 *      that server's URL.
 *   3. Register the example's handlers via `registerHandlers(transport, apiClient)`.
 *   4. Dispatch each action and assert the upstream calls flowed through and
 *      the return values match expectations.
 *   5. Tear down (transport + server) regardless of test outcome.
 *
 * No browser, no runner, no WebSocket. The whole thing runs in-process.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { ApiTransport, type WrapperTransport } from '@qontinui/ui-bridge-wrapper';
import {
  createApiClient,
  registerHandlers,
  type CreateTodoResult,
  type DeleteTodoResult,
  type GetTodoResult,
  type ListTodosResult,
  type Todo,
  type ToggleTodoResult,
} from '../src/handlers.js';

// ---------------------------------------------------------------------------
// In-memory todo stub. Implements just enough of the upstream contract for the
// smoke: GET /todos, GET /todos/:id, POST /todos, PATCH /todos/:id,
// DELETE /todos/:id. Real adopters point at the real API instead.
// ---------------------------------------------------------------------------

let server: Server | null = null;
let serverPort = 0;
let transport: WrapperTransport | null = null;

const todos = new Map<number, Todo>();
let nextId = 1;

function clearStore(): void {
  todos.clear();
  nextId = 1;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (chunks.length === 0) {
        res(undefined);
        return;
      }
      try {
        res(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch (err) {
        rej(err);
      }
    });
    req.on('error', rej);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function notFound(res: ServerResponse): void {
  sendJson(res, 404, { error: 'not_found' });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';
  // Match `/todos` (collection) or `/todos/:id` (item).
  const collectionMatch = url === '/todos';
  const itemMatch = /^\/todos\/(\d+)$/.exec(url);

  if (collectionMatch && method === 'GET') {
    sendJson(res, 200, Array.from(todos.values()));
    return;
  }

  if (collectionMatch && method === 'POST') {
    const body = (await readJsonBody(req)) as Partial<Todo> | undefined;
    if (!body || typeof body.title !== 'string') {
      sendJson(res, 400, { error: 'title required' });
      return;
    }
    const todo: Todo = {
      id: nextId++,
      title: body.title,
      completed: Boolean(body.completed ?? false),
    };
    todos.set(todo.id, todo);
    sendJson(res, 201, todo);
    return;
  }

  if (itemMatch) {
    const id = Number(itemMatch[1]);
    const existing = todos.get(id);

    if (method === 'GET') {
      if (!existing) {
        notFound(res);
        return;
      }
      sendJson(res, 200, existing);
      return;
    }

    if (method === 'PATCH') {
      if (!existing) {
        notFound(res);
        return;
      }
      const body = (await readJsonBody(req)) as Partial<Todo> | undefined;
      const updated: Todo = {
        ...existing,
        ...(body?.title !== undefined ? { title: body.title } : {}),
        ...(body?.completed !== undefined ? { completed: body.completed } : {}),
      };
      todos.set(id, updated);
      sendJson(res, 200, updated);
      return;
    }

    if (method === 'DELETE') {
      if (!existing) {
        notFound(res);
        return;
      }
      todos.delete(id);
      res.writeHead(204);
      res.end();
      return;
    }
  }

  notFound(res);
}

async function startServer(): Promise<void> {
  server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  });
  await new Promise<void>((res, rej) => {
    server!.once('error', rej);
    server!.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      if (addr === null || typeof addr === 'string') {
        rej(new Error('Failed to obtain server port'));
        return;
      }
      serverPort = addr.port;
      res();
    });
  });
}

async function stopServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((res) => server!.close(() => res()));
  server = null;
}

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  if (transport) {
    try {
      await transport.close();
    } catch {
      // best-effort
    }
    transport = null;
  }
  await stopServer();
  clearStore();
});

describe('wrapper-api-example (ApiTransport)', () => {
  it('dispatches the registered actions against an upstream HTTP API and round-trips the data', async () => {
    transport = new ApiTransport();
    const apiClient = createApiClient(`http://127.0.0.1:${serverPort}`);
    registerHandlers(transport, apiClient);
    await transport.ready();

    // 1. createTodo: server assigns the id; title and completed flag round-trip.
    const created = await transport.dispatch<CreateTodoResult>('createTodo', {
      title: 'first',
      completed: false,
    });
    expect(typeof created.id).toBe('number');
    expect(created.id).toBeGreaterThan(0);
    expect(created.title).toBe('first');
    expect(created.completed).toBe(false);
    const createdId = created.id;

    // 2. listTodos: the new entry shows up exactly once.
    const list = await transport.dispatch<ListTodosResult>('listTodos');
    expect(list.todos).toHaveLength(1);
    expect(list.todos[0]?.id).toBe(createdId);
    expect(list.todos[0]?.title).toBe('first');

    // 3. toggleTodo: completed flips false → true.
    const toggled = (await transport.dispatch<ToggleTodoResult>('toggleTodo', {
      id: createdId,
    })) as Todo;
    expect(toggled.id).toBe(createdId);
    expect(toggled.completed).toBe(true);

    // 4. getTodo: state matches the toggled value.
    const fetched = (await transport.dispatch<GetTodoResult>('getTodo', {
      id: createdId,
    })) as Todo;
    expect(fetched.id).toBe(createdId);
    expect(fetched.completed).toBe(true);
    expect(fetched.title).toBe('first');

    // 5. deleteTodo: returns `{ deleted: id }` on success.
    const deleted = (await transport.dispatch<DeleteTodoResult>('deleteTodo', {
      id: createdId,
    })) as { deleted: number };
    expect(deleted.deleted).toBe(createdId);

    // 6. getTodo after delete: structured `not_found`.
    const after = await transport.dispatch<GetTodoResult>('getTodo', { id: createdId });
    expect(after).toEqual({ error: 'not_found', id: createdId });

    await transport.close();
    transport = null;
  });
});
