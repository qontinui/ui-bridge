/**
 * Ratchet: every route's declared argument shape matches its handler.
 *
 * The HTTP adapters (`nextjs.ts`, `express.ts`, `standalone.ts`) call a handler
 * positionally: `handler(...urlParams, payload?, context)`. Here `payload` is the
 * body when the route declares `bodyRequired`, or the query object when it
 * declares `queryRequired`. `context` is the `HandlerContext` carrying the
 * caller identity the auth gate verified.
 *
 * A route whose flags disagree with its handler's parameter list breaks
 * per-user tab scoping:
 *   - a missing flag slides the context into the request slot, so the relay
 *     dispatches to the primary tab;
 *   - a stray flag, or a URL param the handler does not take, puts request
 *     data in the context slot, so the request names the caller.
 * `route-scoping.test.ts` observes both end to end.
 *
 * Nothing here is hand-listed. The expected shape of every route is derived
 * from the `UIBridgeServerHandlers` signatures (read with the TypeScript
 * compiler from `types.ts`) and the route table, so a new route cannot slip
 * through.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { UI_BRIDGE_ROUTES, type RouteDefinition } from './types';

interface Param {
  name: string;
  type: string;
}

/** `UIBridgeServerHandlers` member name -> its parameters, as written. */
function handlerSignatures(): Map<string, Param[] | null> {
  const path = resolve(dirname(fileURLToPath(import.meta.url)), 'types.ts');
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const signatures = new Map<string, Param[] | null>();
  const read = (params: ts.NodeArray<ts.ParameterDeclaration>): Param[] =>
    params.map((p) => ({
      name: p.name.getText(source),
      type: p.type ? p.type.getText(source).replace(/\s+/g, ' ') : '',
    }));
  source.forEachChild((node) => {
    if (!ts.isInterfaceDeclaration(node) || node.name.text !== 'UIBridgeServerHandlers') return;
    for (const member of node.members) {
      const name = member.name?.getText(source);
      if (!name) continue;
      if (ts.isMethodSignature(member)) signatures.set(name, read(member.parameters));
      else if (ts.isPropertySignature(member) && member.type && ts.isFunctionTypeNode(member.type))
        signatures.set(name, read(member.type.parameters));
      else signatures.set(name, null);
    }
  });
  return signatures;
}

const CONTEXT = 'HandlerContext';
const PRIMITIVES = new Set(['string', 'number', 'boolean', 'bigint']);

/** Every way `route` disagrees with `params` (its handler's parameter list). */
function misalignments(route: RouteDefinition, params: Param[] | null | undefined): string[] {
  const where = `${route.method} ${route.path} -> ${route.handler}`;
  if (!params) return [`${where}: no function member of UIBridgeServerHandlers`];
  const problems: string[] = [];
  const urlParams = route.params ?? [];
  urlParams.forEach((url, i) => {
    if (params[i]?.type !== 'string') {
      problems.push(
        `${where}: URL param \`${url}\` lands in parameter ${i} (\`${params[i]?.name ?? 'none'}\`), ` +
          `which is not a string`
      );
    }
  });
  const rest = params.slice(urlParams.length);
  const takesPayload = rest.length > 0 && rest[0].type !== CONTEXT;
  const trailing = takesPayload ? rest.slice(1) : rest;
  if (trailing.length > 1 || (trailing.length === 1 && trailing[0].type !== CONTEXT)) {
    problems.push(
      `${where}: after the URL params the handler takes (${rest.map((p) => `${p.name}: ${p.type}`).join(', ')}); ` +
        'only [payload?, context?] lines up with the adapters'
    );
  }
  const declared =
    route.method === 'GET' ? route.queryRequired === true : route.bodyRequired === true;
  if (takesPayload !== declared) {
    const flag = route.method === 'GET' ? 'queryRequired' : 'bodyRequired';
    problems.push(
      takesPayload
        ? `${where}: the handler takes \`${rest[0].name}\` but the route does not declare ${flag}, so the context lands in that slot`
        : `${where}: the route declares ${flag} but the handler takes no payload, so the payload lands in the context slot`
    );
  }
  if (takesPayload && PRIMITIVES.has(rest[0].type)) {
    problems.push(
      `${where}: the payload parameter \`${rest[0].name}\` is typed \`${rest[0].type}\`, but the adapters pass an object`
    );
  }
  if (route.method === 'GET' && route.bodyRequired)
    problems.push(`${where}: GET declares bodyRequired`);
  if (route.method !== 'GET' && route.queryRequired)
    problems.push(`${where}: queryRequired outside GET`);
  return problems;
}

describe('route table x handler signatures', () => {
  const signatures = handlerSignatures();

  it('reads the whole contract, not an empty one', () => {
    // A parse that found nothing would pass every check below vacuously.
    expect(UI_BRIDGE_ROUTES.length).toBeGreaterThan(150);
    expect([...signatures.values()].filter(Boolean).length).toBeGreaterThan(150);
  });

  it('every route hands its handler exactly the arguments its signature names', () => {
    const problems = UI_BRIDGE_ROUTES.flatMap((route) =>
      misalignments(route, signatures.get(route.handler))
    );
    expect(problems).toEqual([]);
  });

  it('the check fails on each misalignment it exists to catch', () => {
    const takesBody: Param[] = [
      { name: 'request', type: '{ text?: string }' },
      { name: 'context', type: CONTEXT },
    ];
    const takesNothing: Param[] = [{ name: 'context', type: CONTEXT }];
    const post = { method: 'POST', path: '/x', handler: 'h' } as const;
    const get = { method: 'GET', path: '/x', handler: 'h' } as const;
    expect(misalignments({ ...post, bodyRequired: true }, takesBody)).toEqual([]);
    expect(misalignments(post, takesBody)).toHaveLength(1);
    expect(misalignments({ ...post, bodyRequired: true }, takesNothing)).toHaveLength(1);
    expect(misalignments({ ...get, queryRequired: true }, takesBody)).toEqual([]);
    expect(misalignments(get, takesBody)).toHaveLength(1);
    expect(misalignments({ ...get, queryRequired: true }, takesNothing)).toHaveLength(1);
    // A URL param the handler does not take as a string.
    expect(
      misalignments({ ...post, params: ['id'], bodyRequired: true }, takesBody).length
    ).toBeGreaterThan(0);
    // A primitive payload slot.
    expect(
      misalignments({ ...get, queryRequired: true }, [
        { name: 'limit', type: 'number' },
        { name: 'context', type: CONTEXT },
      ])
    ).toHaveLength(1);
  });
});
