// `dom-accessibility-api`'s `package.json` `exports` field does not include
// a `types` condition, so `moduleResolution: bundler` fails to pick up the
// shipped declaration files. Declare the narrow surface this package uses
// so we get proper types rather than implicit `any`.
declare module 'dom-accessibility-api' {
  /** W3C accessible-name algorithm — https://w3c.github.io/accname/ */
  export function computeAccessibleName(node: Element): string;
  /** ARIA role per W3C ARIA-in-HTML mapping (explicit `role=` + implicit). */
  export function getRole(node: Element): string | null;
}
