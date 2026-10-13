/**
 * The ONE JSON serializer for payloads that cross a wire: the relay client's
 * POST back to the relay, the Next.js route responses, the standalone server's
 * responses.
 *
 * Command results can hold DOM nodes (a component's `getState()`, an action
 * handler's return) and objects that contain themselves (React's
 * `__reactFiber$` back-references), and `JSON.stringify` throws on a cycle. So
 * a node becomes `[HTMLDivElement]`, a function is dropped, and a TRUE cycle —
 * an object reached again from inside itself — becomes `[Circular]`.
 *
 * A SHARED reference is not a cycle. The three copies this replaces kept one
 * `WeakSet` of every object seen anywhere in the payload, so the second time
 * the same object appeared — in a sibling field, a different row — it was
 * written as the string `[Circular]`. A media row carries the same
 * observation in `state.mediaMetadata` and in its top-level `mediaMetadata`,
 * so every unredacted media row reached the runner with its top-level
 * observation replaced by that string. Here the guard is the chain of objects
 * the value currently sits INSIDE, which is exactly what a cycle is.
 */
export function safeJsonStringify(value: unknown): string {
  // The objects the value being written sits inside, outermost first.
  // JSON.stringify walks depth-first and calls the replacer with `this` bound
  // to the object HOLDING the value, so unwinding to `this` keeps the chain
  // exact.
  const ancestors: object[] = [];
  return JSON.stringify(value, function (this: unknown, _key: string, val: unknown) {
    if (val !== null && typeof val === 'object') {
      if (typeof Node !== 'undefined' && val instanceof Node) {
        return `[${val.constructor.name}]`;
      }
      while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
        ancestors.pop();
      }
      if (ancestors.includes(val)) return '[Circular]';
      ancestors.push(val);
    }
    if (typeof val === 'function') return undefined;
    return val;
  });
}
