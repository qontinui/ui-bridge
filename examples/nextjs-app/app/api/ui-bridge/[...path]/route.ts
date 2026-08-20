/**
 * UI Bridge API Route Handler
 *
 * A catch-all App Router route backed by the real Next.js adapter.
 * `createUIBridgeHandler()` wires server-safe stub implementations: reads
 * return well-formed empty payloads and writes return an explicit error,
 * because a Next server process has no access to the browser registry the
 * elements actually live in. To serve real snapshots and actions, pass your
 * own handlers to `createNextRouteHandlers` instead — see
 * docs-site/docs/server/nextjs.md.
 */

import { createUIBridgeHandler } from '@qontinui/ui-bridge-server/nextjs';

const handler = createUIBridgeHandler();

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
