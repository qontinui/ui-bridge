/**
 * `WrapperAppShell`
 *
 * Very small default chrome for wrapper apps — shows the wrapper title, the
 * transport kind, and the current status. Designed to be rendered by a
 * wrapper's root React component; wrappers that want richer chrome should
 * skip this and build their own.
 *
 * Intentionally unstyled (inline minimal styles only) so a wrapper's
 * stylesheet can target the class names.
 */

import type { ReactElement, ReactNode } from 'react';
import type { WrapperTransport } from '../types.js';
import { useWrapperStatus } from './useWrapperStatus.js';

export interface WrapperAppShellProps {
  transport: WrapperTransport;
  title: string;
  /** Optional child content rendered inside `<main>`. */
  children?: ReactNode;
  /** Override the header class name. */
  headerClassName?: string;
  /** Override the main class name. */
  mainClassName?: string;
}

export function WrapperAppShell(props: WrapperAppShellProps): ReactElement {
  const { transport, title, children, headerClassName, mainClassName } = props;
  const status = useWrapperStatus(transport);

  return (
    <div className="qontinui-wrapper-shell" data-status={status}>
      <header
        className={headerClassName ?? 'qontinui-wrapper-shell__header'}
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '0.75rem',
          padding: '0.5rem 1rem',
          borderBottom: '1px solid rgba(0,0,0,0.1)',
        }}
      >
        <h1 className="qontinui-wrapper-shell__title" style={{ fontSize: '1rem', margin: 0 }}>
          {title}
        </h1>
        <span className="qontinui-wrapper-shell__meta" style={{ fontSize: '0.8rem', opacity: 0.7 }}>
          transport: <code>{transport.kind}</code> · status: <code>{status}</code>
        </span>
      </header>
      <main className={mainClassName ?? 'qontinui-wrapper-shell__main'}>{children}</main>
    </div>
  );
}
