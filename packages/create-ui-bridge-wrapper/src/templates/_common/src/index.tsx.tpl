/**
 * `{{PACKAGE_NAME}}` — React entry point.
 *
 * Renders `{{PASCAL_NAME}}Wrapper`, which owns a single transport instance,
 * registers action handlers via `registerHandlers(transport)`, and exposes
 * the wrapper's capabilities to UI Bridge via `useUIComponent`.
 *
 * Wrappers are mounted inside a host that already provides the UI Bridge
 * context (runner tab, dev shell, Storybook…). The `WrapperAppShell`
 * renders a minimal header so the transport status is always visible.
 */

import React from 'react';
import { createTransport } from '@qontinui/ui-bridge-wrapper';
import {
  WrapperAppShell,
  useWrapperStatus,
} from '@qontinui/ui-bridge-wrapper/react';
import { useUIComponent } from '@qontinui/ui-bridge';
import { registerHandlers } from './handlers.js';

const transport = createTransport({
  kind: '{{DEFAULT_TRANSPORT}}',
  {{RUNNER_URL_FIELD}}
  appId: 'wrapper-{{NAME}}',
  appName: '{{DISPLAY_NAME}}',
});
registerHandlers(transport);

export function {{PASCAL_NAME}}Wrapper(): React.ReactElement {
  // Surface the current status so callers can choose to re-render or toast.
  const status = useWrapperStatus(transport);

  useUIComponent({
    id: 'wrapper-{{NAME}}',
    name: '{{DISPLAY_NAME}}',
    description:
      'Auto-generated wrapper — edit src/actions/ to add capabilities.',
    state: () => ({ status }),
    actions: [
      {
        id: 'hello',
        label: 'Hello',
        paramSchema: { name: { type: 'string' } },
        handler: (params) => transport.dispatch('hello', params),
      },
    ],
  });

  return (
    <WrapperAppShell transport={transport} title="{{DISPLAY_NAME}}" />
  );
}

export default {{PASCAL_NAME}}Wrapper;
export { transport };
