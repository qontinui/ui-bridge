/**
 * Media Snapshot
 *
 * On-demand visual snapshot capture and pixel-level comparison for media elements.
 * Never called during discovery — only when explicitly requested via API.
 */

/**
 * Captured media snapshot
 */
export interface MediaSnapshotData {
  /** Base64-encoded image data */
  data: string;
  /** Width of the captured image */
  width: number;
  /** Height of the captured image */
  height: number;
  /** MIME type */
  mediaType: 'image/png' | 'image/svg+xml';
  /** Element ID this snapshot was taken from */
  elementId: string;
  /** Timestamp of capture */
  timestamp: number;
}

/**
 * Result of comparing two media snapshots
 */
export interface MediaComparisonResult {
  /** Whether the images are identical */
  identical: boolean;
  /** Percentage of pixels that differ (0-100), or -1 if comparison not supported */
  diffPercentage: number;
  /** Bounding box of the region with differences */
  diffRegion?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Base64-encoded diff image highlighting differences in red */
  diffImage?: string;
  /** Error message if comparison could not be performed */
  error?: string;
}

/**
 * Capture a visual snapshot of a media element as a base64 PNG.
 *
 * - For <img>: draws the image onto a canvas
 * - For <video>: draws the current frame onto a canvas
 * - For <canvas>: reads directly via toDataURL
 * - For <svg>: serializes to XML and renders via Image
 *
 * @param element The media DOM element to capture
 * @param maxSize Maximum dimension (width or height) to resize to (default: 512)
 * @returns Base64 PNG data or null if capture fails
 */
export function captureMediaSnapshot(
  element: HTMLElement,
  elementId: string,
  maxSize: number = 512
): MediaSnapshotData | null {
  try {
    const tag = element.tagName.toLowerCase();
    let canvas: HTMLCanvasElement;
    let width: number;
    let height: number;

    if (tag === 'canvas') {
      const sourceCanvas = element as HTMLCanvasElement;
      width = sourceCanvas.width;
      height = sourceCanvas.height;
      // Scale down if needed
      const scale = Math.min(1, maxSize / Math.max(width, height));
      const scaledW = Math.round(width * scale);
      const scaledH = Math.round(height * scale);
      canvas = document.createElement('canvas');
      canvas.width = scaledW;
      canvas.height = scaledH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(sourceCanvas, 0, 0, scaledW, scaledH);
      width = scaledW;
      height = scaledH;
    } else if (tag === 'img') {
      const img = element as HTMLImageElement;
      if (!img.complete || img.naturalWidth === 0) return null;
      width = img.naturalWidth;
      height = img.naturalHeight;
      const scale = Math.min(1, maxSize / Math.max(width, height));
      const scaledW = Math.round(width * scale);
      const scaledH = Math.round(height * scale);
      canvas = document.createElement('canvas');
      canvas.width = scaledW;
      canvas.height = scaledH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, scaledW, scaledH);
      width = scaledW;
      height = scaledH;
    } else if (tag === 'video') {
      const video = element as HTMLVideoElement;
      if (video.readyState < 2) return null;
      width = video.videoWidth;
      height = video.videoHeight;
      const scale = Math.min(1, maxSize / Math.max(width, height));
      const scaledW = Math.round(width * scale);
      const scaledH = Math.round(height * scale);
      canvas = document.createElement('canvas');
      canvas.width = scaledW;
      canvas.height = scaledH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, scaledW, scaledH);
      width = scaledW;
      height = scaledH;
    } else if (tag === 'svg') {
      return captureSvgSnapshot(element as unknown as SVGElement, elementId, maxSize);
    } else {
      return null;
    }

    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');

    return {
      data: base64,
      width,
      height,
      mediaType: 'image/png',
      elementId,
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Capture SVG as a rasterized PNG snapshot
 */
function captureSvgSnapshot(
  svg: SVGElement,
  elementId: string,
  maxSize: number
): MediaSnapshotData | null {
  try {
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);

    const rect = svg.getBoundingClientRect();
    let width = rect.width || 100;
    let height = rect.height || 100;
    const scale = Math.min(1, maxSize / Math.max(width, height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);

    // Return the SVG as base64 — the caller (AI model) can interpret SVG directly
    return {
      data: btoa(unescape(encodeURIComponent(svgString))),
      width,
      height,
      mediaType: 'image/svg+xml',
      elementId,
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Compare two media snapshots pixel-by-pixel.
 *
 * Both snapshots must be base64 PNG data. Returns diff percentage and
 * optional diff image highlighting changed pixels in red.
 *
 * Note: This function is async because it needs to decode base64 images.
 */
export async function compareMediaSnapshots(
  a: MediaSnapshotData,
  b: MediaSnapshotData
): Promise<MediaComparisonResult> {
  // SVG snapshots cannot be compared pixel-by-pixel
  if (a.mediaType === 'image/svg+xml' || b.mediaType === 'image/svg+xml') {
    return { identical: false, diffPercentage: -1, error: 'SVG comparison not supported' };
  }

  try {
    const imgA = await loadBase64Image(a.data);
    const imgB = await loadBase64Image(b.data);

    // Use the larger dimensions
    const width = Math.max(imgA.width, imgB.width);
    const height = Math.max(imgA.height, imgB.height);

    const canvasA = document.createElement('canvas');
    canvasA.width = width;
    canvasA.height = height;
    const ctxA = canvasA.getContext('2d');
    if (!ctxA) return { identical: false, diffPercentage: -1, error: 'Failed to get 2d context' };
    ctxA.drawImage(imgA, 0, 0);
    const dataA = ctxA.getImageData(0, 0, width, height);

    const canvasB = document.createElement('canvas');
    canvasB.width = width;
    canvasB.height = height;
    const ctxB = canvasB.getContext('2d');
    if (!ctxB) return { identical: false, diffPercentage: -1, error: 'Failed to get 2d context' };
    ctxB.drawImage(imgB, 0, 0);
    const dataB = ctxB.getImageData(0, 0, width, height);

    // Compare pixels
    const diffCanvas = document.createElement('canvas');
    diffCanvas.width = width;
    diffCanvas.height = height;
    const diffCtx = diffCanvas.getContext('2d');
    if (!diffCtx)
      return { identical: false, diffPercentage: -1, error: 'Failed to get 2d context' };
    const diffData = diffCtx.createImageData(width, height);

    let diffCount = 0;
    let minX = width,
      minY = height,
      maxX = 0,
      maxY = 0;
    const totalPixels = width * height;
    const threshold = 10; // Color difference threshold

    for (let i = 0; i < dataA.data.length; i += 4) {
      const rDiff = Math.abs(dataA.data[i] - dataB.data[i]);
      const gDiff = Math.abs(dataA.data[i + 1] - dataB.data[i + 1]);
      const bDiff = Math.abs(dataA.data[i + 2] - dataB.data[i + 2]);

      if (rDiff > threshold || gDiff > threshold || bDiff > threshold) {
        diffCount++;
        const px = (i / 4) % width;
        const py = Math.floor(i / 4 / width);
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);

        // Highlight diff in red
        diffData.data[i] = 255;
        diffData.data[i + 1] = 0;
        diffData.data[i + 2] = 0;
        diffData.data[i + 3] = 200;
      } else {
        // Copy original with reduced opacity
        diffData.data[i] = dataA.data[i];
        diffData.data[i + 1] = dataA.data[i + 1];
        diffData.data[i + 2] = dataA.data[i + 2];
        diffData.data[i + 3] = 80;
      }
    }

    diffCtx.putImageData(diffData, 0, 0);
    const diffPercentage = (diffCount / totalPixels) * 100;

    return {
      identical: diffCount === 0,
      diffPercentage: Math.round(diffPercentage * 100) / 100,
      diffRegion:
        diffCount > 0
          ? {
              x: minX,
              y: minY,
              width: maxX - minX + 1,
              height: maxY - minY + 1,
            }
          : undefined,
      diffImage:
        diffCount > 0
          ? diffCanvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
          : undefined,
    };
  } catch {
    return { identical: false, diffPercentage: 100 };
  }
}

/**
 * Load a base64-encoded image into an HTMLImageElement
 */
function loadBase64Image(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/png;base64,${base64}`;
  });
}

// =============================================================================
// Element-level visual capture
// =============================================================================

/**
 * Options for capturing an arbitrary DOM element as an image.
 */
export interface ElementCaptureOptions {
  /** Maximum dimension (width or height) to scale to (default: 1024) */
  maxSize?: number;
  /** Background color to render behind the element (default: 'white') */
  background?: string;
  /** Padding in pixels around the element (default: 0) */
  padding?: number;
}

/**
 * Capture any DOM element as a base64 PNG screenshot using a foreign-object SVG approach.
 *
 * This works for arbitrary elements (divs, sections, forms, etc.) — not just media elements.
 * It serializes the element's outer HTML into an SVG foreignObject, renders it to a canvas,
 * and returns the result as a base64 PNG.
 *
 * Limitations:
 * - External images may not render (tainted canvas / CORS)
 * - Some CSS features (backdrop-filter, clip-path) may not render correctly
 * - iframes and cross-origin content are excluded
 *
 * @param element The DOM element to capture
 * @param elementId The element's identifier string
 * @param options Capture options
 */
export async function captureElementScreenshot(
  element: HTMLElement,
  elementId: string,
  options: ElementCaptureOptions = {}
): Promise<MediaSnapshotData | null> {
  const { maxSize = 1024, background = 'white', padding = 0 } = options;

  try {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const captureW = Math.ceil(rect.width) + padding * 2;
    const captureH = Math.ceil(rect.height) + padding * 2;

    // Scale to fit within maxSize
    const scale = Math.min(1, maxSize / Math.max(captureW, captureH));
    const scaledW = Math.round(captureW * scale);
    const scaledH = Math.round(captureH * scale);

    // Clone and inline computed styles for accurate rendering
    const clone = element.cloneNode(true) as HTMLElement;
    inlineComputedStyles(element, clone);

    // Build SVG foreignObject
    const serialized = new XMLSerializer().serializeToString(clone);
    const svgMarkup = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${captureW}" height="${captureH}">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml" style="
            width: ${captureW}px;
            height: ${captureH}px;
            padding: ${padding}px;
            background: ${background};
            overflow: hidden;
          ">${serialized}</div>
        </foreignObject>
      </svg>
    `;

    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
      });

      const canvas = document.createElement('canvas');
      canvas.width = scaledW;
      canvas.height = scaledH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, scaledW, scaledH);
      ctx.drawImage(img, 0, 0, scaledW, scaledH);

      const data = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
      return {
        data,
        width: scaledW,
        height: scaledH,
        mediaType: 'image/png',
        elementId,
        timestamp: Date.now(),
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

/**
 * Deep-copy computed styles from a source element to a cloned element,
 * ensuring visual fidelity when rendered outside the live DOM.
 */
function inlineComputedStyles(source: HTMLElement, target: HTMLElement): void {
  const computed = window.getComputedStyle(source);
  for (let i = 0; i < computed.length; i++) {
    const prop = computed[i];
    target.style.setProperty(prop, computed.getPropertyValue(prop));
  }

  // Recurse into children
  const sourceChildren = source.children;
  const targetChildren = target.children;
  for (let i = 0; i < sourceChildren.length && i < targetChildren.length; i++) {
    if (sourceChildren[i] instanceof HTMLElement && targetChildren[i] instanceof HTMLElement) {
      inlineComputedStyles(sourceChildren[i] as HTMLElement, targetChildren[i] as HTMLElement);
    }
  }
}

// =============================================================================
// Visual regression comparison
// =============================================================================

/**
 * Options for visual regression comparison.
 * Inspired by jest-image-snapshot's dual-threshold model.
 */
export interface VisualRegressionOptions {
  /** Per-pixel color difference threshold (0-255). Differences below this are ignored.
   *  Helps with antialiasing and subpixel rendering. Default: 10 */
  pixelThreshold?: number;
  /** Maximum allowed percentage of differing pixels (0-100). Default: 0.1 (0.1%) */
  failureThreshold?: number;
  /** Whether failure threshold is a 'percent' of total pixels or an absolute 'pixel' count.
   *  Default: 'percent' */
  failureThresholdType?: 'percent' | 'pixel';
  /** Apply a Gaussian-like blur to both images before comparison to reduce
   *  noise from antialiasing. Radius in pixels. Default: 0 (disabled) */
  blur?: number;
}

/**
 * Result of a visual regression comparison.
 */
export interface VisualRegressionResult {
  /** Whether the images pass the regression check (within thresholds) */
  pass: boolean;
  /** Number of pixels that differ beyond the pixel threshold */
  diffPixelCount: number;
  /** Percentage of pixels that differ (0-100) */
  diffPercentage: number;
  /** Total number of pixels compared */
  totalPixels: number;
  /** Bounding box of the diff region */
  diffRegion?: { x: number; y: number; width: number; height: number };
  /** Base64-encoded diff image (red = different, dimmed = same) */
  diffImage?: string;
  /** Dimensions used for comparison */
  dimensions: { width: number; height: number };
}

/**
 * Compare two snapshots for visual regression with configurable thresholds.
 *
 * Uses a dual-threshold model inspired by jest-image-snapshot:
 * - pixelThreshold: per-pixel color tolerance (handles antialiasing/subpixel)
 * - failureThreshold: overall tolerance for total differing pixels
 *
 * @param baseline The reference/expected snapshot
 * @param current The current/actual snapshot
 * @param options Comparison options
 */
export async function compareVisualRegression(
  baseline: MediaSnapshotData,
  current: MediaSnapshotData,
  options: VisualRegressionOptions = {}
): Promise<VisualRegressionResult> {
  const {
    pixelThreshold = 10,
    failureThreshold = 0.1,
    failureThresholdType = 'percent',
    blur = 0,
  } = options;

  try {
    const imgA = await loadBase64Image(baseline.data);
    const imgB = await loadBase64Image(current.data);

    const width = Math.max(imgA.width, imgB.width);
    const height = Math.max(imgA.height, imgB.height);
    const totalPixels = width * height;

    const canvasA = document.createElement('canvas');
    canvasA.width = width;
    canvasA.height = height;
    const ctxA = canvasA.getContext('2d');
    if (!ctxA) {
      return {
        pass: false,
        diffPixelCount: 0,
        diffPercentage: 100,
        totalPixels: 0,
        dimensions: { width: 0, height: 0 },
      };
    }
    if (blur > 0) ctxA.filter = `blur(${blur}px)`;
    ctxA.drawImage(imgA, 0, 0);
    const dataA = ctxA.getImageData(0, 0, width, height);

    const canvasB = document.createElement('canvas');
    canvasB.width = width;
    canvasB.height = height;
    const ctxB = canvasB.getContext('2d');
    if (!ctxB) {
      return {
        pass: false,
        diffPixelCount: 0,
        diffPercentage: 100,
        totalPixels: 0,
        dimensions: { width: 0, height: 0 },
      };
    }
    if (blur > 0) ctxB.filter = `blur(${blur}px)`;
    ctxB.drawImage(imgB, 0, 0);
    const dataB = ctxB.getImageData(0, 0, width, height);

    // Diff canvas for visualization
    const diffCanvas = document.createElement('canvas');
    diffCanvas.width = width;
    diffCanvas.height = height;
    const diffCtx = diffCanvas.getContext('2d');
    if (!diffCtx) {
      return {
        pass: false,
        diffPixelCount: 0,
        diffPercentage: 100,
        totalPixels: 0,
        dimensions: { width: 0, height: 0 },
      };
    }
    const diffData = diffCtx.createImageData(width, height);

    let diffCount = 0;
    let minX = width,
      minY = height,
      maxX = 0,
      maxY = 0;

    for (let i = 0; i < dataA.data.length; i += 4) {
      const rDiff = Math.abs(dataA.data[i] - dataB.data[i]);
      const gDiff = Math.abs(dataA.data[i + 1] - dataB.data[i + 1]);
      const bDiff = Math.abs(dataA.data[i + 2] - dataB.data[i + 2]);

      if (rDiff > pixelThreshold || gDiff > pixelThreshold || bDiff > pixelThreshold) {
        diffCount++;
        const px = (i / 4) % width;
        const py = Math.floor(i / 4 / width);
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);

        // Red highlight
        diffData.data[i] = 255;
        diffData.data[i + 1] = 0;
        diffData.data[i + 2] = 0;
        diffData.data[i + 3] = 200;
      } else {
        // Dimmed original
        diffData.data[i] = dataA.data[i];
        diffData.data[i + 1] = dataA.data[i + 1];
        diffData.data[i + 2] = dataA.data[i + 2];
        diffData.data[i + 3] = 80;
      }
    }

    diffCtx.putImageData(diffData, 0, 0);
    const diffPercentage = (diffCount / totalPixels) * 100;

    // Check against failure threshold
    let pass: boolean;
    if (failureThresholdType === 'percent') {
      pass = diffPercentage <= failureThreshold;
    } else {
      pass = diffCount <= failureThreshold;
    }

    return {
      pass,
      diffPixelCount: diffCount,
      diffPercentage: Math.round(diffPercentage * 100) / 100,
      totalPixels,
      diffRegion:
        diffCount > 0
          ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
          : undefined,
      diffImage:
        diffCount > 0
          ? diffCanvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
          : undefined,
      dimensions: { width, height },
    };
  } catch {
    // Return a failing result if comparison could not be performed
    return {
      pass: false,
      diffPixelCount: 0,
      diffPercentage: 100,
      totalPixels: 0,
      dimensions: { width: 0, height: 0 },
    };
  }
}
