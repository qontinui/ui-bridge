/**
 * Handler registration for `{{PACKAGE_NAME}}`.
 *
 * Every action the wrapper supports is registered here. The same
 * `registerHandlers(transport)` wiring is called by the React and Node
 * entry points, so handlers are written once and run under every
 * selected transport. `ctx` inside each handler depends on the transport
 * kind — narrow with `if (ctx.kind === 'headless') { ctx.page... }`.
 */

import type { WrapperTransport } from '@qontinui/ui-bridge-wrapper';
import { hello, type HelloParams, type HelloResult } from './actions/hello.js';

export function registerHandlers(transport: WrapperTransport): void {
  transport.register<HelloParams, HelloResult, unknown>(
    'hello',
    (params, ctx) => hello(params, ctx)
  );

  // Add more actions below. A tidy pattern:
  //
  //   import { myAction, type MyActionParams } from './actions/my-action.js';
  //   transport.register<MyActionParams, MyActionResult, unknown>(
  //     'my-action',
  //     (params, ctx) => myAction(params, ctx)
  //   );
}
