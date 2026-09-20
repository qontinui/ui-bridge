import { describe, it, expect } from 'vitest';
import { HeadlessTransport } from '../src/transports/headless.js';
import { parseArgs, buildTransportOptions, USAGE } from '../src/inject-cli.js';
import type { TransportConfig } from '../src/types.js';

/**
 * Option pass-through for the headless/injected transports.
 *
 * `parseOptions` is the one place where a caller-supplied option either
 * reaches `launchHeadlessTab` or is silently dropped: it rebuilds the options
 * object field by field, so a field it forgets disappears with no type error
 * (its input is `Record<string, unknown>`). Nothing exercised that before.
 *
 * `forwardConsole` is the field with a contract attached. Since
 * `@qontinui/ui-bridge-headless` 0.5.0 the launcher writes every forwarded
 * `[browser.<type>]` line to stderr, which is what lets `ui-bridge-inject`
 * promise that stdout carries JSON result lines and nothing else (ui-bridge
 * #219). Two halves of that promise are pinned here:
 *
 *   - an explicit `forwardConsole` survives `parseOptions`, so a caller can
 *     still turn forwarding off;
 *   - inject-cli sets none, and an unset value stays `undefined` rather than
 *     being coerced to `false`, so the launcher's own default applies.
 *
 * Both are read through a test-local subclass: `options` is `protected`, and
 * reaching it that way keeps the assertion on the parsed value rather than on
 * a browser launch, which needs Chromium and is skipped in CI.
 */
class OptionProbe extends HeadlessTransport {
  get parsed(): Readonly<Record<string, unknown>> {
    return this.options as unknown as Record<string, unknown>;
  }
}

function probe(options: Record<string, unknown>): OptionProbe {
  return new OptionProbe({ kind: 'headless', options } as TransportConfig);
}

describe('HeadlessTransport option parsing', () => {
  it('keeps forwardConsole undefined when the caller sets none', () => {
    // undefined, NOT false: `launchHeadlessTab` defaults it to true, and the
    // stderr forwarding is the debugging channel every CLI here relies on.
    expect(probe({ targetUrl: 'http://127.0.0.1:1/' }).parsed['forwardConsole']).toBeUndefined();
  });

  it('passes an explicit forwardConsole through, both ways', () => {
    expect(
      probe({ targetUrl: 'http://127.0.0.1:1/', forwardConsole: false }).parsed['forwardConsole']
    ).toBe(false);
    expect(
      probe({ targetUrl: 'http://127.0.0.1:1/', forwardConsole: true }).parsed['forwardConsole']
    ).toBe(true);
  });

  it('ignores a non-boolean forwardConsole instead of forwarding the junk value', () => {
    expect(
      probe({ targetUrl: 'http://127.0.0.1:1/', forwardConsole: 'yes' }).parsed['forwardConsole']
    ).toBeUndefined();
  });

  it('carries the other launcher options through', () => {
    const parsed = probe({
      targetUrl: 'http://127.0.0.1:1/page',
      viewportWidth: 1280,
      viewportHeight: 720,
      uiBridgeBase: 'http://127.0.0.1:3001/api/ui-bridge',
      waitForUiBridgeMs: 5000,
      userAgent: 'probe/1.0',
      launchArgs: ['--disable-gpu'],
      storageStatePath: '/tmp/auth.json',
    }).parsed;
    expect(parsed).toMatchObject({
      targetUrl: 'http://127.0.0.1:1/page',
      viewportWidth: 1280,
      viewportHeight: 720,
      uiBridgeBase: 'http://127.0.0.1:3001/api/ui-bridge',
      waitForUiBridgeMs: 5000,
      userAgent: 'probe/1.0',
      launchArgs: ['--disable-gpu'],
      storageStatePath: '/tmp/auth.json',
    });
  });
});

describe('inject-cli leaves console forwarding at the launcher default', () => {
  it('builds transport options with no forwardConsole key', () => {
    const options = buildTransportOptions(
      parseArgs(['--url', 'https://example.com', '--exec', 'getControlSnapshot {}'])
    );
    expect((options as Record<string, unknown>)['forwardConsole']).toBeUndefined();
    // …and the transport keeps it that way, so the chain
    // inject-cli -> InjectedTransport -> HeadlessTransport -> launchHeadlessTab
    // ends at the launcher's stderr default.
    expect(
      probe(options as unknown as Record<string, unknown>).parsed['forwardConsole']
    ).toBeUndefined();
  });

  it('documents the stream split in --help', () => {
    // The contract a caller parses stdout on is only useful if it is written
    // down where they read it.
    expect(USAGE).toContain('Output streams:');
    expect(USAGE).toMatch(/stdout carries MACHINE OUTPUT ONLY/);
    expect(USAGE).toContain('[browser.<type>]');
  });
});
