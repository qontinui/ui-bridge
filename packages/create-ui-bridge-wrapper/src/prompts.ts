/**
 * Interactive prompts for `create-ui-bridge-wrapper`.
 *
 * A thin wrapper around `@inquirer/prompts` that only fires when the CLI
 * doesn't already have a definitive answer from flags. Every prompt is
 * tolerant of `--yes`: the caller sets `skipPrompts: true` to accept
 * defaults without asking.
 */

import { checkbox, confirm, input } from '@inquirer/prompts';

/** Transport kinds mirror the runtime's `WrapperTransportKind`. */
export type TransportKind = 'api' | 'headless' | 'headed' | 'live';

export const ALL_TRANSPORTS: readonly TransportKind[] = [
  'api',
  'headless',
  'headed',
  'live',
] as const;

export interface PromptAnswers {
  name: string;
  transports: TransportKind[];
  includeUi: boolean;
  monorepo: boolean;
}

export interface PromptInputs {
  nameFromCli: string | null;
  transportsFromCli: TransportKind[] | null;
  includeUiFromCli: boolean | null;
  monorepoFromCli: boolean | null;
  skipPrompts: boolean;
}

export async function gatherAnswers(inputs: PromptInputs): Promise<PromptAnswers> {
  const name = await resolveName(inputs);
  const transports = await resolveTransports(inputs);
  const includeUi = await resolveIncludeUi(inputs, transports);
  const monorepo = await resolveMonorepo(inputs);
  return { name, transports, includeUi, monorepo };
}

async function resolveName(inputs: PromptInputs): Promise<string> {
  if (inputs.nameFromCli !== null) return inputs.nameFromCli;
  if (inputs.skipPrompts) {
    throw new Error(
      '--yes requires a wrapper name positional argument (e.g. `create-ui-bridge-wrapper my-wrapper --yes`)'
    );
  }
  const answer = await input({
    message: 'Wrapper name (kebab-case):',
    validate: (value) =>
      /^[a-z0-9][a-z0-9-]*$/.test(value)
        ? true
        : 'Use lowercase letters, digits, and hyphens (e.g. my-wrapper)',
  });
  return answer.trim();
}

async function resolveTransports(inputs: PromptInputs): Promise<TransportKind[]> {
  if (inputs.transportsFromCli !== null) return inputs.transportsFromCli;
  if (inputs.skipPrompts) return ['api'];
  const answer = await checkbox<TransportKind>({
    message: 'Which transports should this wrapper support?',
    choices: ALL_TRANSPORTS.map((kind) => ({
      name: describeTransport(kind),
      value: kind,
      checked: kind === 'api',
    })),
    validate: (values) => (values.length > 0 ? true : 'Select at least one transport'),
  });
  return answer;
}

async function resolveIncludeUi(
  inputs: PromptInputs,
  transports: TransportKind[]
): Promise<boolean> {
  if (inputs.includeUiFromCli !== null) return inputs.includeUiFromCli;
  if (inputs.skipPrompts) return false;
  const suggestsUi = transports.includes('live');
  return confirm({
    message: suggestsUi
      ? 'Include a React UI (WrapperAppShell)? Recommended for live transports.'
      : 'Include a React UI (WrapperAppShell)?',
    default: suggestsUi,
  });
}

async function resolveMonorepo(inputs: PromptInputs): Promise<boolean> {
  if (inputs.monorepoFromCli !== null) return inputs.monorepoFromCli;
  if (inputs.skipPrompts) return false;
  return confirm({
    message: 'Drop this into the qontinui-wrappers monorepo under packages/?',
    default: false,
  });
}

function describeTransport(kind: TransportKind): string {
  switch (kind) {
    case 'api':
      return 'api       — direct SDK / REST calls, no browser';
    case 'headless':
      return 'headless  — Playwright Chromium (no window, CI-friendly)';
    case 'headed':
      return 'headed    — Playwright Chromium (visible, for debugging)';
    case 'live':
      return 'live      — qontinui runner over WebSocket';
  }
}

/** Parse a `--transports a,b,c` value into a validated list. */
export function parseTransportsFlag(raw: string): TransportKind[] {
  const parts = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  const out: TransportKind[] = [];
  for (const part of parts) {
    if (!isTransportKind(part)) {
      throw new Error(
        `--transports: unknown transport '${part}'. Valid: ${ALL_TRANSPORTS.join(', ')}`
      );
    }
    if (!out.includes(part)) out.push(part);
  }
  if (out.length === 0) {
    throw new Error('--transports: at least one transport required');
  }
  return out;
}

function isTransportKind(value: string): value is TransportKind {
  return (ALL_TRANSPORTS as readonly string[]).includes(value);
}
