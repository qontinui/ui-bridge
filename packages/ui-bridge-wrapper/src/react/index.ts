/**
 * `@qontinui/ui-bridge-wrapper/react`
 *
 * React-specific entry point. Separate from the core entry so that
 * wrappers running in pure-Node contexts (CLI-ish `ui-bridge-tab` shells,
 * CI scripts…) can import `@qontinui/ui-bridge-wrapper` without pulling
 * React into the bundle.
 */

export { WrapperAppShell } from './WrapperAppShell.js';
export type { WrapperAppShellProps } from './WrapperAppShell.js';
export { useWrapperStatus } from './useWrapperStatus.js';
export {
  useTransportSelector,
  type UseTransportSelectorOptions,
  type UseTransportSelectorReturn,
} from './useTransportSelector.js';
