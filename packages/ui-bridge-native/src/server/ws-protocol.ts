/**
 * Pure-JS RFC 6455 WebSocket protocol implementation.
 *
 * Provides frame encoding/decoding and handshake utilities for running
 * a WebSocket server on react-native-tcp-socket without native crypto deps.
 */

// ── Constants ───────────────────────────────────────────────────────────────

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export const OPCODE_CONTINUATION = 0x00;
export const OPCODE_TEXT = 0x01;
export const OPCODE_BINARY = 0x02;
export const OPCODE_CLOSE = 0x08;
export const OPCODE_PING = 0x09;
export const OPCODE_PONG = 0x0a;

// ── Types ───────────────────────────────────────────────────────────────────

export interface DecodedFrame {
  opcode: number;
  fin: boolean;
  payload: Uint8Array;
  masked: boolean;
}

export interface DecodeResult {
  frames: DecodedFrame[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  remainder: Uint8Array<any>;
}

// ── SHA-1 (Pure JS) ─────────────────────────────────────────────────────────
// Minimal inline SHA-1 per FIPS 180-4. Used only for the WS handshake.

function sha1Bytes(input: Uint8Array): Uint8Array {
  const ml = input.length * 8;

  // Pre-processing: pad to 512-bit blocks
  const padLen = 64 - ((input.length + 9) % 64);
  const total = input.length + 1 + (padLen === 64 ? 0 : padLen) + 8;
  const msg = new Uint8Array(total);
  msg.set(input);
  msg[input.length] = 0x80;
  // Length in bits as 64-bit big-endian (we only use 32-bit since messages are small)
  const dv = new DataView(msg.buffer);
  dv.setUint32(total - 4, ml, false);

  // Initialize hash values
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Uint32Array(80);

  for (let offset = 0; offset < total; offset += 64) {
    const block = new DataView(msg.buffer, offset, 64);

    for (let i = 0; i < 16; i++) {
      w[i] = block.getUint32(i * 4, false);
    }
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (x << 1) | (x >>> 31);
    }

    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4;

    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }

      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const result = new Uint8Array(20);
  const rdv = new DataView(result.buffer);
  rdv.setUint32(0, h0, false);
  rdv.setUint32(4, h1, false);
  rdv.setUint32(8, h2, false);
  rdv.setUint32(12, h3, false);
  rdv.setUint32(16, h4, false);
  return result;
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Manual base64 encoder — avoids Hermes btoa() which can silently corrupt
 * binary strings containing bytes > 127 (common in SHA-1 output).
 */
function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;

    result += B64_CHARS[(triplet >> 18) & 0x3f];
    result += B64_CHARS[(triplet >> 12) & 0x3f];
    result += i + 1 < len ? B64_CHARS[(triplet >> 6) & 0x3f] : '=';
    result += i + 2 < len ? B64_CHARS[triplet & 0x3f] : '=';
  }
  return result;
}

// ── Handshake ───────────────────────────────────────────────────────────────

/**
 * Compute the Sec-WebSocket-Accept value from the client's Sec-WebSocket-Key.
 */
export function computeAcceptKey(clientKey: string): string {
  const input = clientKey + WS_GUID;
  const encoder = new TextEncoder();
  const hash = sha1Bytes(encoder.encode(input));
  return bytesToBase64(hash);
}

/**
 * Build the HTTP 101 Switching Protocols response for a WebSocket upgrade.
 */
export function buildUpgradeResponse(clientKey: string): string {
  const accept = computeAcceptKey(clientKey);
  return (
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    '\r\n'
  );
}

// ── Frame Encoding (Server → Client, unmasked) ─────────────────────────────

function encodeFrame(opcode: number, payload: Uint8Array): Uint8Array {
  const len = payload.length;
  let headerLen: number;

  if (len < 126) {
    headerLen = 2;
  } else if (len < 65536) {
    headerLen = 4;
  } else {
    headerLen = 10;
  }

  const frame = new Uint8Array(headerLen + len);
  frame[0] = 0x80 | opcode; // FIN + opcode

  if (len < 126) {
    frame[1] = len; // No mask bit (server → client)
  } else if (len < 65536) {
    frame[1] = 126;
    frame[2] = (len >> 8) & 0xff;
    frame[3] = len & 0xff;
  } else {
    frame[1] = 127;
    // For payloads > 65535, use 8-byte length (upper 4 bytes zero for practical sizes)
    const dv = new DataView(frame.buffer, 2, 8);
    dv.setUint32(0, 0, false);
    dv.setUint32(4, len, false);
  }

  frame.set(payload, headerLen);
  return frame;
}

/** Encode a text message as a WebSocket frame. */
export function encodeTextFrame(text: string): Uint8Array {
  const payload = new TextEncoder().encode(text);
  return encodeFrame(OPCODE_TEXT, payload);
}

/** Encode a PING frame with optional payload. */
export function encodePingFrame(payload?: Uint8Array): Uint8Array {
  return encodeFrame(OPCODE_PING, payload ?? new Uint8Array(0));
}

/** Encode a PONG frame with the payload from the PING. */
export function encodePongFrame(payload: Uint8Array): Uint8Array {
  return encodeFrame(OPCODE_PONG, payload);
}

/** Encode a CLOSE frame with optional status code and reason. */
export function encodeCloseFrame(code?: number, reason?: string): Uint8Array {
  if (code === undefined) {
    return encodeFrame(OPCODE_CLOSE, new Uint8Array(0));
  }
  const reasonBytes = reason ? new TextEncoder().encode(reason) : new Uint8Array(0);
  const payload = new Uint8Array(2 + reasonBytes.length);
  payload[0] = (code >> 8) & 0xff;
  payload[1] = code & 0xff;
  payload.set(reasonBytes, 2);
  return encodeFrame(OPCODE_CLOSE, payload);
}

// ── Frame Decoding (Client → Server, masked) ───────────────────────────────

/**
 * Decode one or more WebSocket frames from a byte buffer.
 * Returns decoded frames and any unconsumed bytes (for partial frames).
 */
export function decodeFrames(buffer: Uint8Array): DecodeResult {
  const frames: DecodedFrame[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    // Need at least 2 bytes for the header
    if (buffer.length - offset < 2) break;

    const byte0 = buffer[offset];
    const byte1 = buffer[offset + 1];

    const fin = (byte0 & 0x80) !== 0;
    const opcode = byte0 & 0x0f;
    const masked = (byte1 & 0x80) !== 0;
    let payloadLen = byte1 & 0x7f;

    let headerLen = 2;

    if (payloadLen === 126) {
      if (buffer.length - offset < 4) break;
      payloadLen = (buffer[offset + 2] << 8) | buffer[offset + 3];
      headerLen = 4;
    } else if (payloadLen === 127) {
      if (buffer.length - offset < 10) break;
      const dv = new DataView(buffer.buffer, buffer.byteOffset + offset + 2, 8);
      payloadLen = dv.getUint32(4, false); // Use lower 32 bits only
      headerLen = 10;
    }

    if (masked) {
      headerLen += 4; // 4-byte masking key
    }

    const totalLen = headerLen + payloadLen;
    if (buffer.length - offset < totalLen) break; // Partial frame

    // Extract and unmask payload
    const payload = new Uint8Array(payloadLen);
    const dataStart = offset + headerLen;

    if (masked) {
      const maskOffset = offset + headerLen - 4;
      const mask = buffer.slice(maskOffset, maskOffset + 4);
      for (let i = 0; i < payloadLen; i++) {
        payload[i] = buffer[dataStart + i] ^ mask[i % 4];
      }
    } else {
      payload.set(buffer.slice(dataStart, dataStart + payloadLen));
    }

    frames.push({ opcode, fin, payload, masked });
    offset += totalLen;
  }

  return {
    frames,
    remainder: new Uint8Array(buffer.slice(offset)),
  };
}

/**
 * Decode a text payload from a Uint8Array.
 */
export function decodeTextPayload(payload: Uint8Array): string {
  return new TextDecoder().decode(payload);
}
