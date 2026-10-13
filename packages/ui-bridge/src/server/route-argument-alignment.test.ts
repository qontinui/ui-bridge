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
 * The expected shape of every route is derived from the route table and from
 * the handler signatures, resolved with the TypeScript checker: a parameter is
 * the context when its type, `undefined` aside, is mutually assignable with
 * `HandlerContext` (so an alias, a union with `undefined` or an inline
 * `{ callerUserId?: string }` all count), and a rest parameter is never
 * accepted. The handler implementations are held to the same signatures. What
 * this does not see is a route or handler outside `UI_BRIDGE_ROUTES` and the
 * three handler factories checked below.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { UI_BRIDGE_ROUTES, type RouteDefinition } from './types';

interface Param {
  name: string;
  /** A rest parameter: the adapters' positional call cannot line up with one. */
  rest: boolean;
  /** Its type, `undefined` aside, is `HandlerContext` up to mutual assignability. */
  context: boolean;
  /** Its type, `undefined` aside, is a string. */
  string: boolean;
  /** Its type, `undefined` aside, is a primitive. */
  primitive: boolean;
  /** The type as written, for messages. */
  text: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/** Read a parameter list with the checker. */
function readParams(
  checker: ts.TypeChecker,
  contextType: ts.Type,
  params: readonly ts.ParameterDeclaration[]
): Param[] {
  return params.map((p) => {
    const declared = checker.getTypeAtLocation(p);
    // `unknown` / `any` say nothing about the slot; `NonNullable<unknown>` would
    // read as `{}`, which every object type, HandlerContext included, accepts.
    const opaque = (declared.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0;
    const type = checker.getNonNullableType(declared);
    const primitive =
      !opaque &&
      (type.flags &
        (ts.TypeFlags.StringLike |
          ts.TypeFlags.NumberLike |
          ts.TypeFlags.BooleanLike |
          ts.TypeFlags.BigIntLike)) !==
        0;
    return {
      name: p.name.getText(),
      rest: p.dotDotDotToken !== undefined,
      context:
        !opaque &&
        (type.flags & ts.TypeFlags.Object) !== 0 &&
        type.getProperty('callerUserId') !== undefined &&
        checker.isTypeAssignableTo(type, contextType) &&
        checker.isTypeAssignableTo(contextType, type),
      string: !opaque && (type.flags & ts.TypeFlags.StringLike) !== 0,
      primitive,
      text: p.type ? p.type.getText().replace(/\s+/g, ' ') : checker.typeToString(type),
    };
  });
}

function functionParams(member: ts.Node): readonly ts.ParameterDeclaration[] | null {
  if (ts.isMethodSignature(member) || ts.isMethodDeclaration(member)) return member.parameters;
  const typeOrInit = ts.isPropertySignature(member)
    ? member.type
    : ts.isPropertyAssignment(member)
      ? member.initializer
      : undefined;
  if (typeOrInit && (ts.isFunctionTypeNode(typeOrInit) || ts.isFunctionLike(typeOrInit))) {
    return (typeOrInit as ts.SignatureDeclaration).parameters;
  }
  return null;
}

/** `interfaceName`'s members -> their parameters, read with the checker. */
function interfaceSignatures(
  program: ts.Program,
  file: string,
  interfaceName: string,
  contextName: string
): { signatures: Map<string, Param[] | null>; contextType: ts.Type } {
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  if (!source) throw new Error(`${file} is not in the program`);
  let iface: ts.InterfaceDeclaration | undefined;
  let context: ts.InterfaceDeclaration | undefined;
  source.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) iface = node;
    if (ts.isInterfaceDeclaration(node) && node.name.text === contextName) context = node;
  });
  if (!iface || !context) throw new Error(`${interfaceName} or ${contextName} not found`);
  const contextType = checker.getTypeAtLocation(context);
  const signatures = new Map<string, Param[] | null>();
  for (const member of iface.members) {
    const name = member.name?.getText();
    if (!name) continue;
    const params = functionParams(member);
    signatures.set(name, params ? readParams(checker, contextType, params) : null);
  }
  return { signatures, contextType };
}

const PRIMITIVE_PAYLOAD = 'the adapters pass an object';

/** Every way `route` disagrees with `params` (its handler's parameter list). */
function misalignments(route: RouteDefinition, params: Param[] | null | undefined): string[] {
  const where = `${route.method} ${route.path} -> ${route.handler}`;
  if (!params) return [`${where}: no function member of the handler interface`];
  const problems: string[] = [];
  const rest = params.filter((p) => p.rest);
  if (rest.length > 0) {
    problems.push(
      `${where}: rest parameter \`${rest[0].name}\` cannot line up with a positional call`
    );
    return problems;
  }
  const urlParams = route.params ?? [];
  urlParams.forEach((url, i) => {
    if (!params[i]?.string || params[i]?.context) {
      problems.push(
        `${where}: URL param \`${url}\` lands in parameter ${i} (\`${params[i]?.name ?? 'none'}\`), ` +
          `which is not a string`
      );
    }
  });
  const after = params.slice(urlParams.length);
  const takesPayload = after.length > 0 && !after[0].context;
  const trailing = takesPayload ? after.slice(1) : after;
  if (trailing.length > 1 || (trailing.length === 1 && !trailing[0].context)) {
    problems.push(
      `${where}: after the URL params the handler takes (${after.map((p) => `${p.name}: ${p.text}`).join(', ')}); ` +
        'only [payload?, context?] lines up with the adapters'
    );
  }
  for (const p of params) {
    if (p.name === 'context' && !p.context) {
      problems.push(`${where}: \`context\` is typed \`${p.text}\`, not HandlerContext`);
    }
  }
  const declared =
    route.method === 'GET' ? route.queryRequired === true : route.bodyRequired === true;
  if (takesPayload !== declared) {
    const flag = route.method === 'GET' ? 'queryRequired' : 'bodyRequired';
    problems.push(
      takesPayload
        ? `${where}: the handler takes \`${after[0].name}\` but the route does not declare ${flag}, so the context lands in that slot`
        : `${where}: the route declares ${flag} but the handler takes no payload, so the payload lands in the context slot`
    );
  }
  if (takesPayload && after[0].primitive) {
    problems.push(
      `${where}: the payload parameter \`${after[0].name}\` is typed \`${after[0].text}\`, but ${PRIMITIVE_PAYLOAD}`
    );
  }
  if (route.method === 'GET' && route.bodyRequired)
    problems.push(`${where}: GET declares bodyRequired`);
  if (route.method !== 'GET' && route.queryRequired)
    problems.push(`${where}: queryRequired outside GET`);
  return problems;
}

/** The program the real signatures and implementations are read from. */
function packageProgram(roots: string[]): ts.Program {
  const configPath = resolve(HERE, '../../tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
  return ts.createProgram({ rootNames: roots, options: { ...parsed.options, noEmit: true } });
}

/**
 * Implementation members whose parameters disagree with the interface: a rest
 * parameter, more parameters than the interface declares, or an annotated
 * parameter whose type differs from the interface's at the same position.
 */
function implementationProblems(
  program: ts.Program,
  file: string,
  factories: string[],
  signatures: Map<string, Param[] | null>,
  contextType: ts.Type
): { problems: string[]; checked: number } {
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file)!;
  const problems: string[] = [];
  let checked = 0;
  const visit = (node: ts.Node, factory: string) => {
    if (ts.isObjectLiteralExpression(node)) {
      const names = node.properties.map((p) => p.name?.getText()).filter(Boolean) as string[];
      if (names.length >= 5 && names.every((n) => signatures.has(n) || n.startsWith('__'))) {
        for (const property of node.properties) {
          const name = property.name?.getText();
          const declared = name ? signatures.get(name) : undefined;
          const params = functionParams(property);
          if (!name || !declared || !params) continue;
          checked++;
          const impl = readParams(checker, contextType, params);
          const where = `${factory}.${name}`;
          if (impl.some((p) => p.rest)) problems.push(`${where}: rest parameter`);
          if (impl.length > declared.length) {
            problems.push(
              `${where}: takes ${impl.length} parameters, the interface ${declared.length}`
            );
          }
          impl.forEach((p, i) => {
            const d = declared[i];
            if (!d || !params[i].type) return;
            if (p.context !== d.context || p.primitive !== d.primitive || p.string !== d.string) {
              problems.push(
                `${where}: parameter ${i} \`${p.name}: ${p.text}\` does not match the interface's \`${d.name}: ${d.text}\``
              );
            }
          });
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, factory));
  };
  source.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name && factories.includes(node.name.text)) {
      visit(node, node.name.text);
    }
  });
  return { problems, checked };
}

describe('route table x handler signatures', () => {
  const typesFile = resolve(HERE, 'types.ts');
  const relayFile = resolve(HERE, 'relay-handlers.ts');
  const handlersFile = resolve(HERE, 'handlers.ts');
  const program = packageProgram([typesFile, relayFile, handlersFile]);
  const { signatures, contextType } = interfaceSignatures(
    program,
    typesFile,
    'UIBridgeServerHandlers',
    'HandlerContext'
  );

  it('reads the whole contract, not an empty one', () => {
    // A parse that found nothing would pass every check below vacuously.
    expect(UI_BRIDGE_ROUTES.length).toBeGreaterThan(150);
    expect([...signatures.values()].filter(Boolean).length).toBeGreaterThan(150);
    expect([...signatures.values()].flat().filter((p) => p?.context).length).toBeGreaterThan(150);
  });

  it('every route hands its handler exactly the arguments its signature names', () => {
    const problems = UI_BRIDGE_ROUTES.flatMap((route) =>
      misalignments(route, signatures.get(route.handler))
    );
    expect(problems).toEqual([]);
  });

  it('every handler implementation takes the parameters its interface member declares', () => {
    const relay = implementationProblems(
      program,
      relayFile,
      ['createRelayHandlers'],
      signatures,
      contextType
    );
    const local = implementationProblems(
      program,
      handlersFile,
      ['createHandlers', 'createAIHandlers'],
      signatures,
      contextType
    );
    expect(relay.checked).toBeGreaterThan(150);
    expect(local.checked).toBeGreaterThan(150);
    expect([...relay.problems, ...local.problems]).toEqual([]);
  });
});

describe('the ratchet fails on each misalignment it exists to catch', () => {
  // The independent review's five synthetic shapes, plus the original cases,
  // compiled in a program of their own.
  const SYNTHETIC = `
    export interface HandlerContext { callerUserId?: string }
    export type ReviewCtx = HandlerContext;
    export interface Shapes {
      aliasCtx: (context?: ReviewCtx) => Promise<unknown>;
      unionCtx: (context?: HandlerContext | undefined) => Promise<unknown>;
      inlineCtx: (context?: { callerUserId?: string }) => Promise<unknown>;
      restArgs: (...args: unknown[]) => Promise<unknown>;
      takesBody: (request: { text?: string }, context?: HandlerContext) => Promise<unknown>;
      takesNothing: (context?: HandlerContext) => Promise<unknown>;
      takesId: (id: string, request: { text?: string }, context?: HandlerContext) => Promise<unknown>;
      numberPayload: (limit?: number, context?: HandlerContext) => Promise<unknown>;
      misnamedContext: (request: { a?: string }, context?: { other: number }) => Promise<unknown>;
    }`;
  const fileName = resolve(HERE, '__synthetic_shapes__.ts');
  const host = ts.createCompilerHost({ strict: true, noEmit: true });
  const realGet = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) =>
    name === fileName
      ? ts.createSourceFile(name, SYNTHETIC, languageVersion, true)
      : realGet(name, languageVersion, onError, shouldCreate);
  const realExists = host.fileExists.bind(host);
  host.fileExists = (name) => name === fileName || realExists(name);
  const program = ts.createProgram({
    rootNames: [fileName],
    options: { strict: true, noEmit: true, types: [] },
    host,
  });
  const { signatures } = interfaceSignatures(program, fileName, 'Shapes', 'HandlerContext');
  const check = (route: Partial<RouteDefinition> & { handler: string }) =>
    misalignments(
      { method: 'POST', path: '/x', ...route } as RouteDefinition,
      signatures.get(route.handler)
    );

  it('accepts a context parameter however its type is spelled', () => {
    expect(check({ handler: 'aliasCtx' })).toEqual([]);
    expect(check({ handler: 'unionCtx' })).toEqual([]);
    expect(check({ handler: 'inlineCtx' })).toEqual([]);
  });

  it('rejects a body flag on a handler whose only parameter is the context, however it is spelled', () => {
    expect(check({ handler: 'aliasCtx', bodyRequired: true })).toHaveLength(1);
    expect(check({ handler: 'unionCtx', bodyRequired: true })).toHaveLength(1);
    expect(check({ handler: 'inlineCtx', bodyRequired: true })).toHaveLength(1);
  });

  it('rejects a rest parameter', () => {
    expect(check({ handler: 'restArgs', bodyRequired: true }).length).toBeGreaterThan(0);
    expect(check({ handler: 'restArgs' }).length).toBeGreaterThan(0);
  });

  it('rejects a missing or a stray flag', () => {
    expect(check({ handler: 'takesBody', bodyRequired: true })).toEqual([]);
    expect(check({ handler: 'takesBody' })).toHaveLength(1);
    expect(check({ handler: 'takesNothing', bodyRequired: true })).toHaveLength(1);
    expect(check({ handler: 'takesBody', method: 'GET', queryRequired: true })).toEqual([]);
    expect(check({ handler: 'takesBody', method: 'GET' })).toHaveLength(1);
  });

  it('rejects a URL param the handler does not take as a string', () => {
    expect(check({ handler: 'takesId', params: ['id'], bodyRequired: true })).toEqual([]);
    expect(
      check({ handler: 'takesBody', params: ['id'], bodyRequired: true }).length
    ).toBeGreaterThan(0);
  });

  it('rejects a primitive payload and a context parameter that is not a context', () => {
    expect(check({ handler: 'numberPayload', method: 'GET', queryRequired: true })).toHaveLength(1);
    expect(check({ handler: 'misnamedContext', bodyRequired: true }).length).toBeGreaterThan(0);
  });
});
