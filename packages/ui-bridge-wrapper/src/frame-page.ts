/**
 * The page-side frame helpers: what a capture reads off a Playwright-like page
 * and off the PNG it returns. NODE-FREE by contract — no Node builtin, no
 * `Buffer`, no `process` — because the browser-safe `./live` entry imports it
 * (through `screenshot-capture.ts`). `frame-capture.ts` re-exports all of it.
 */

/** The `prefers-color-scheme` a page rendered in. */
export type FrameColorScheme = 'dark' | 'light';

/** What the page says about how it is being rendered. */
export interface PageMetrics {
  devicePixelRatio: number;
  innerWidth: number;
  innerHeight: number;
  colorScheme: FrameColorScheme;
}

/** The slice of a Playwright `Page` frame capture needs. */
export interface FramePage {
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  screenshot(options: { type: 'png'; scale: 'device'; fullPage: false }): Promise<Uint8Array>;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Width and height from a PNG's IHDR chunk. Throws on anything that is not a
 * PNG with an IHDR first — a frame whose size cannot be read cannot be mapped.
 */
export function pngDimensions(buf: Uint8Array): { width: number; height: number } {
  if (buf.length < 24 || PNG_SIGNATURE.some((b, i) => buf[i] !== b)) {
    throw new Error('not a PNG (signature mismatch or truncated header)');
  }
  const chunkType = String.fromCharCode(buf[12]!, buf[13]!, buf[14]!, buf[15]!);
  if (chunkType !== 'IHDR') {
    throw new Error(`PNG does not start with an IHDR chunk (found ${JSON.stringify(chunkType)})`);
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Read the page's own rendering metrics — never the flags that requested them. */
export async function readPageMetrics(page: Pick<FramePage, 'evaluate'>): Promise<PageMetrics> {
  return page.evaluate(() => ({
    devicePixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    colorScheme: (window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light') as FrameColorScheme,
  }));
}
