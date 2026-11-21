/**
 * Build supervisor for ensure-built.mjs:
 *
 *   node ensure-built-runner.mjs <pkgDir> <timeoutMs> <command>
 *
 * Runs `<command>` through the shell in `<pkgDir>` with inherited stdio and
 * exits with its status. When the command outlives `<timeoutMs>`, it kills the
 * command's WHOLE process tree and exits 124: on Windows with
 * `taskkill /T /F /PID <pid>` for the shell it spawned (so npm, tsup and tsc
 * under it go too), elsewhere with SIGKILL to that shell's own process group.
 * It only ever targets the pid it spawned, never an image name.
 *
 * ensureBuilt calls it synchronously (spawnSync), which cannot kill a tree on
 * its own: spawnSync's timeout signals only its direct child.
 */
import { spawn, spawnSync } from 'node:child_process';

const [pkgDir, timeoutArg, command] = process.argv.slice(2);
const timeoutMs = Number(timeoutArg);
if (!pkgDir || !command || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error('usage: ensure-built-runner.mjs <pkgDir> <timeoutMs> <command>');
  process.exit(2);
}

const win = process.platform === 'win32';
const child = spawn(command, {
  cwd: pkgDir,
  shell: true,
  stdio: 'inherit',
  // Its own process group, so the whole tree can be signalled at once.
  detached: !win,
});

let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  if (win) {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}, timeoutMs);

child.on('error', (err) => {
  clearTimeout(timer);
  console.error(`ensure-built-runner: could not start \`${command}\`: ${err.message}`);
  process.exit(127);
});

child.on('exit', (code, signal) => {
  clearTimeout(timer);
  if (timedOut) process.exit(124);
  process.exit(code ?? (signal ? 1 : 0));
});
