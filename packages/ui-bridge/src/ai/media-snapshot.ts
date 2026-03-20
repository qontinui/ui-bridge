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
    const ctxA = canvasA.getContext('2d')!;
    ctxA.drawImage(imgA, 0, 0);
    const dataA = ctxA.getImageData(0, 0, width, height);

    const canvasB = document.createElement('canvas');
    canvasB.width = width;
    canvasB.height = height;
    const ctxB = canvasB.getContext('2d')!;
    ctxB.drawImage(imgB, 0, 0);
    const dataB = ctxB.getImageData(0, 0, width, height);

    // Compare pixels
    const diffCanvas = document.createElement('canvas');
    diffCanvas.width = width;
    diffCanvas.height = height;
    const diffCtx = diffCanvas.getContext('2d')!;
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
