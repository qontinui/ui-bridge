/**
 * Handler implementations for the api transport.
 *
 * Extracted from `index.ts` so the smoke test can register the same set of
 * actions against an injected stub `apiClient` without re-importing the CLI
 * bootstrap. Every handler receives `(params, ctx)` where `ctx` is `undefined`
 * — the api transport does no I/O of its own, so there is no per-dispatch
 * context. Everything a handler needs comes from `params` plus the closed-over
 * `apiClient`.
 *
 * Action ids here are wrapper-internal; they're driven by the *caller*
 * (this script's `main`, or the test) via `transport.dispatch(id, params)`.
 * They do not flow over the wire to a runner — that's the live transport.
 * When you adopt this for your own upstream API, rename the actions and swap
 * the routes for whatever your service exposes.
 */

import type { WrapperTransport } from '@qontinui/ui-bridge-wrapper';

// ---------------------------------------------------------------------------
// Domain types — a tiny "todo list" service. Generic enough to read without
// context. Adopters should replace these with whatever the upstream API
// returns.
// ---------------------------------------------------------------------------

export interface Todo {
  id: number;
  title: string;
  completed: boolean;
}

/** Result of `listTodos`. */
export interface ListTodosResult {
  todos: Todo[];
}

/** `getTodo` either returns the todo or a structured `not_found`. */
export type GetTodoResult = Todo | { error: 'not_found'; id: number };
export interface GetTodoParams {
  id: number;
}

/** `createTodo` returns the todo with the server-assigned id. */
export interface CreateTodoParams {
  title: string;
  completed?: boolean;
}
export type CreateTodoResult = Todo;

/** `toggleTodo` reads, flips `completed`, PATCHes, returns updated todo. */
export interface ToggleTodoParams {
  id: number;
}
export type ToggleTodoResult = Todo | { error: 'not_found'; id: number };

/** `deleteTodo` returns `{ deleted: id }` on success. */
export interface DeleteTodoParams {
  id: number;
}
export type DeleteTodoResult = { deleted: number } | { error: 'not_found'; id: number };

// ---------------------------------------------------------------------------
// Tiny HTTP client — JSON in/out, throws on non-2xx unless explicitly told not
// to (we want to detect 404 → not_found ourselves on `getTodo` etc.).
// ---------------------------------------------------------------------------

/** Minimal `fetch`-backed JSON client the handlers close over. */
export interface ApiClient {
  /** JSON request that throws on any non-2xx. */
  request<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
  /** Like `request`, but returns `null` on 404 instead of throwing. */
  requestOrNull<T = unknown>(method: string, path: string, body?: unknown): Promise<T | null>;
  /** DELETE that returns `true` on 2xx (incl. 204) and `false` on 404. */
  del(path: string): Promise<boolean>;
}

/**
 * Build an `ApiClient` rooted at `baseUrl`. Uses Node 18+'s global `fetch`;
 * no extra dependency. Path is appended verbatim — caller is responsible for
 * leading slashes.
 */
export function createApiClient(baseUrl: string): ApiClient {
  const trimmed = baseUrl.replace(/\/+$/, '');

  async function call(method: string, path: string, body?: unknown): Promise<Response> {
    const url = `${trimmed}${path}`;
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    return fetch(url, init);
  }

  async function readError(res: Response): Promise<string> {
    try {
      return await res.text();
    } catch {
      return '';
    }
  }

  return {
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      const res = await call(method, path, body);
      if (!res.ok) {
        const text = await readError(res);
        throw new Error(`${method} ${path} failed: ${res.status} ${res.statusText} ${text}`);
      }
      if (res.status === 204) return undefined as unknown as T;
      return (await res.json()) as T;
    },
    async requestOrNull<T>(method: string, path: string, body?: unknown): Promise<T | null> {
      const res = await call(method, path, body);
      if (res.status === 404) return null;
      if (!res.ok) {
        const text = await readError(res);
        throw new Error(`${method} ${path} failed: ${res.status} ${res.statusText} ${text}`);
      }
      if (res.status === 204) return null;
      return (await res.json()) as T;
    },
    async del(path: string): Promise<boolean> {
      const res = await call('DELETE', path);
      if (res.status === 404) return false;
      if (!res.ok) {
        const text = await readError(res);
        throw new Error(`DELETE ${path} failed: ${res.status} ${res.statusText} ${text}`);
      }
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

/**
 * Register every action the example exposes onto the given transport. Idempotent
 * — re-registration replaces the prior handler (HandlerRegistry semantics).
 *
 * @param transport - any transport, but for this example always `ApiTransport`.
 * @param apiClient - upstream HTTP client. Tests inject a stub-backed client;
 *                    `index.ts` builds one from `TARGET_API_URL`.
 */
export function registerHandlers(transport: WrapperTransport, apiClient: ApiClient): void {
  // 1. listTodos: GET /todos.
  transport.register<undefined, ListTodosResult>('listTodos', async () => {
    const todos = await apiClient.request<Todo[]>('GET', '/todos');
    return { todos };
  });

  // 2. getTodo: GET /todos/:id. Returns `{ error: 'not_found', id }` on 404
  //    rather than throwing — the api transport surfaces thrown errors as
  //    `WrapperTransportError("HANDLER_ERROR")`, but for a missing record
  //    a structured result reads more naturally.
  transport.register<GetTodoParams, GetTodoResult>('getTodo', async (params) => {
    const id = params?.id;
    if (typeof id !== 'number') {
      throw new Error('getTodo requires { id: number }');
    }
    const todo = await apiClient.requestOrNull<Todo>('GET', `/todos/${id}`);
    if (todo === null) return { error: 'not_found', id };
    return todo;
  });

  // 3. createTodo: POST /todos. Server assigns the id.
  transport.register<CreateTodoParams, CreateTodoResult>('createTodo', async (params) => {
    const title = params?.title;
    if (typeof title !== 'string' || title.length === 0) {
      throw new Error('createTodo requires { title: string }');
    }
    const completed = Boolean(params?.completed ?? false);
    return apiClient.request<Todo>('POST', '/todos', { title, completed });
  });

  // 4. toggleTodo: read → flip `completed` → PATCH. Two upstream calls; the
  //    handler is the right place to compose them so callers stay declarative.
  transport.register<ToggleTodoParams, ToggleTodoResult>('toggleTodo', async (params) => {
    const id = params?.id;
    if (typeof id !== 'number') {
      throw new Error('toggleTodo requires { id: number }');
    }
    const current = await apiClient.requestOrNull<Todo>('GET', `/todos/${id}`);
    if (current === null) return { error: 'not_found', id };
    return apiClient.request<Todo>('PATCH', `/todos/${id}`, { completed: !current.completed });
  });

  // 5. deleteTodo: DELETE /todos/:id. Returns `{ deleted: id }` on success.
  transport.register<DeleteTodoParams, DeleteTodoResult>('deleteTodo', async (params) => {
    const id = params?.id;
    if (typeof id !== 'number') {
      throw new Error('deleteTodo requires { id: number }');
    }
    const ok = await apiClient.del(`/todos/${id}`);
    if (!ok) return { error: 'not_found', id };
    return { deleted: id };
  });
}

/** Action ids registered by `registerHandlers`. Exposed for help text. */
export const REGISTERED_ACTIONS = [
  'listTodos',
  'getTodo',
  'createTodo',
  'toggleTodo',
  'deleteTodo',
] as const;
export type RegisteredAction = (typeof REGISTERED_ACTIONS)[number];
