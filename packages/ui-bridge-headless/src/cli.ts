#!/usr/bin/env node
/**
 * `ui-bridge-tab` — launch a Chromium tab for UI Bridge testing.
 *
 * Usage:
 *
 *   ui-bridge-tab --url http://localhost:3001/vga/builder
 *   ui-bridge-tab --url <url> --headless --ui-bridge http://localhost:3001/api/ui-bridge
 *   ui-bridge-tab --url <url> --keep-alive 300        # auto-exit after 5 min
 *
 * The process stays alive (holding the tab open) until SIGINT / SIGTERM
 * or `--keep-alive <seconds>` elapses. On exit, the browser is closed.
 */

import { launchHeadlessTab, type LaunchHeadlessTabResult } from './launcher.js';

interface CliArgs {
  url: string;
  headless: boolean;
  uiBridgeBase: string | null;
  waitForUiBridgeMs: number;
  keepAliveSecs: number | null;
  viewportWidth: number;
  viewportHeight: number;
  userAgent: string | undefined;
  quiet: boolean;
  help: boolean;
}

const USAGE = `ui-bridge-tab — launch a Chromium tab for UI Bridge testing

Required:
  --url <url>                  URL to open. Must start with http:// or https://

Optional:
  --headless                   Launch without a visible window (default: visible)
  --ui-bridge <base>           Poll this UI Bridge base until a tab registers.
                               Example: http://localhost:3001/api/ui-bridge
  --wait-ms <ms>               Max wait for UI Bridge registration (default 30000)
  --keep-alive <secs>          Auto-close after this many seconds (default: until SIGINT)
  --viewport <WxH>             Viewport size, e.g. 1280x720 (default 1280x720)
  --user-agent <ua>            Override the default Chromium user agent
  --quiet                      Suppress the browser's console/page-error forwarding
  --help                       Print this help and exit

Examples:
  ui-bridge-tab --url http://localhost:3001/vga/builder \\
    --ui-bridge http://localhost:3001/api/ui-bridge

  ui-bridge-tab --url http://localhost:9876 --headless \\
    --ui-bridge http://localhost:9876/ui-bridge --keep-alive 120
`;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    url: '',
    headless: false,
    uiBridgeBase: null,
    waitForUiBridgeMs: 30_000,
    keepAliveSecs: null,
    viewportWidth: 1280,
    viewportHeight: 720,
    userAgent: undefined,
    quiet: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--headless':
        args.headless = true;
        break;
      case '--quiet':
        args.quiet = true;
        break;
      case '--url':
        args.url = argv[++i] ?? '';
        break;
      case '--ui-bridge':
        args.uiBridgeBase = argv[++i] ?? null;
        break;
      case '--wait-ms': {
        const raw = argv[++i];
        const n = raw === undefined ? NaN : Number.parseInt(raw, 10);
        if (!Number.isFinite(n) || n <= 0) {
          die(`--wait-ms expects a positive integer (got ${raw ?? '<missing>'})`);
        }
        args.waitForUiBridgeMs = n;
        break;
      }
      case '--keep-alive': {
        const raw = argv[++i];
        const n = raw === undefined ? NaN : Number.parseInt(raw, 10);
        if (!Number.isFinite(n) || n <= 0) {
          die(`--keep-alive expects a positive integer (got ${raw ?? '<missing>'})`);
        }
        args.keepAliveSecs = n;
        break;
      }
      case '--viewport': {
        const raw = argv[++i];
        const match = raw?.match(/^(\d+)x(\d+)$/);
        if (!match) die(`--viewport expects WxH (got ${raw ?? '<missing>'})`);
        args.viewportWidth = Number.parseInt(match![1]!, 10);
        args.viewportHeight = Number.parseInt(match![2]!, 10);
        break;
      }
      case '--user-agent':
        args.userAgent = argv[++i];
        break;
      default:
        if (arg !== undefined && arg.startsWith('--')) {
          die(`Unknown flag: ${arg}\n\n${USAGE}`);
        }
        break;
    }
  }

  if (!args.help && !args.url) {
    die(`--url is required\n\n${USAGE}`);
  }
  if (!args.help && !/^https?:\/\//i.test(args.url)) {
    die(`--url must start with http:// or https:// (got ${args.url})`);
  }
  return args;
}

function die(msg: string): never {
  process.stderr.write(`${msg}\n`);
  process.exit(2);
}

function log(quiet: boolean, msg: string) {
  if (!quiet) process.stdout.write(`${msg}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  log(args.quiet, `[ui-bridge-tab] launching Chromium (${args.headless ? 'headless' : 'headful'})`);
  log(args.quiet, `[ui-bridge-tab] url: ${args.url}`);

  let tab: LaunchHeadlessTabResult;
  try {
    tab = await launchHeadlessTab({
      url: args.url,
      headless: args.headless,
      uiBridgeBase: args.uiBridgeBase ?? undefined,
      waitForUiBridgeMs: args.waitForUiBridgeMs,
      viewportWidth: args.viewportWidth,
      viewportHeight: args.viewportHeight,
      userAgent: args.userAgent,
      forwardConsole: !args.quiet,
      onPageUrl: args.quiet
        ? undefined
        : (url: string) => {
            process.stdout.write(`[ui-bridge-tab] navigated: ${url}\n`);
          },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[ui-bridge-tab] launch failed: ${msg}\n`);
    process.exit(1);
  }

  if (args.uiBridgeBase) {
    if (tab.uiBridgeRegistered) {
      log(args.quiet, `[ui-bridge-tab] UI Bridge tab registered: ${tab.tabId ?? '(id unknown)'}`);
    } else {
      process.stderr.write(
        `[ui-bridge-tab] WARN: UI Bridge did not report a registered tab within ${args.waitForUiBridgeMs}ms. ` +
          `Verify the app at ${args.url} loads @qontinui/ui-bridge.\n`
      );
    }
  }
  log(args.quiet, `[ui-bridge-tab] ready at ${tab.finalUrl} — press Ctrl+C to exit`);

  // Stay alive until SIGINT/SIGTERM or the keep-alive timer elapses.
  let shuttingDown = false;
  const shutdown = async (reason: string, exitCode: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(args.quiet, `[ui-bridge-tab] shutting down (${reason})`);
    await tab.close();
    process.exit(exitCode);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT', 130);
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM', 143);
  });

  if (args.keepAliveSecs !== null) {
    setTimeout(() => {
      void shutdown(`keep-alive expired after ${args.keepAliveSecs}s`, 0);
    }, args.keepAliveSecs * 1000);
  }

  // Park the event loop. The process stays alive because of the browser
  // process and signal listeners.
}

void main();
