/**
 * Error raised by inject-cli argument / payload validation. The thin CLI
 * wrapper catches this and calls `die()`; tests assert on it WITHOUT
 * triggering `process.exit`.
 *
 * Its own module so the helpers inject-cli composes (`./network-throttle.js`,
 * `./timeline-capture.js`) can throw it without importing the CLI entry.
 */
export class InjectCliArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InjectCliArgError';
  }
}
