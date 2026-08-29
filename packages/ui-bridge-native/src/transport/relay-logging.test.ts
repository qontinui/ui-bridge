import { describe, it, expect } from 'vitest';
import { redactRelayUrl, describeCloseEvent, describeErrorEvent } from './relay-logging';

/**
 * The redaction rule and the two event renderers have exactly one definition,
 * so they are tested here rather than through either of the two diallers that
 * use them (`CloudRelayClient`, `DeviceAnnouncer`). Those two files still assert
 * the rule is actually APPLIED at every log site — that is a different claim.
 */

const RELAY_URL = 'wss://relay.qontinui.io/device-bridge';
const AUTH_TOKEN = 'super-secret-device-token';

describe('redactRelayUrl', () => {
  it('masks the token query parameter', () => {
    expect(redactRelayUrl(`${RELAY_URL}?token=${AUTH_TOKEN}`)).toBe(`${RELAY_URL}?token=<redacted>`);
  });

  it('masks the token when it is not the first parameter, keeping the rest', () => {
    expect(redactRelayUrl(`${RELAY_URL}?v=2&token=${AUTH_TOKEN}&mode=tunnel`)).toBe(
      `${RELAY_URL}?v=2&token=<redacted>&mode=tunnel`
    );
  });

  it('leaves a URL with no credential untouched', () => {
    expect(redactRelayUrl(RELAY_URL)).toBe(RELAY_URL);
    expect(redactRelayUrl(`${RELAY_URL}?mode=tunnel`)).toBe(`${RELAY_URL}?mode=tunnel`);
  });

  it('masks the other credential spellings a future relay URL might use', () => {
    // Not reachable from today's call sites — both build `?token=`. Pinned
    // because this function is the single place the rule lives, so it has to
    // survive the URL being respelled somewhere else.
    for (const name of ['access_token', 'auth', 'authorization', 'key', 'sig']) {
      expect(redactRelayUrl(`${RELAY_URL}?${name}=${AUTH_TOKEN}`)).toBe(
        `${RELAY_URL}?${name}=<redacted>`
      );
    }
  });

  it('masks credentials in the userinfo component', () => {
    expect(redactRelayUrl(`wss://device:${AUTH_TOKEN}@relay.qontinui.io/device-bridge`)).toBe(
      'wss://<redacted>@relay.qontinui.io/device-bridge'
    );
  });

  it('is case-insensitive on the parameter name', () => {
    expect(redactRelayUrl(`${RELAY_URL}?Token=${AUTH_TOKEN}`)).toBe(`${RELAY_URL}?Token=<redacted>`);
  });
});

describe('describeCloseEvent', () => {
  it('renders the fields a real close event carries', () => {
    expect(describeCloseEvent({ code: 1006, reason: 'abnormal closure', wasClean: false })).toBe(
      'code=1006 reason=abnormal closure wasClean=false'
    );
  });

  it('says UNKNOWN rather than printing `undefined` for absent fields', () => {
    // A DOM CloseEvent has no own enumerable properties and React Native
    // delivers a plain object, so "the field is missing" is the normal case,
    // not an error — but it must not read as if the relay told us something.
    const rendered = describeCloseEvent({});
    expect(rendered).toBe('code=unknown reason=(none) wasClean=unknown');
    expect(rendered).not.toContain('undefined');
  });

  it('tolerates null/undefined entirely', () => {
    expect(describeCloseEvent(undefined)).toContain('code=unknown');
    expect(describeCloseEvent(null)).toContain('code=unknown');
  });
});

describe('describeErrorEvent', () => {
  it('prefers the message React Native puts on the event', () => {
    expect(describeErrorEvent({ message: 'Connection reset by peer' })).toBe(
      'message=Connection reset by peer'
    );
  });

  it('unwraps an Error on `error`, and a string one too', () => {
    expect(describeErrorEvent({ error: new Error('tls handshake failed') })).toBe(
      'error=tls handshake failed'
    );
    expect(describeErrorEvent({ error: 'tls handshake failed' })).toBe(
      'error=tls handshake failed'
    );
  });

  it('includes a close code when the error event carries one', () => {
    expect(describeErrorEvent({ message: 'boom', code: 1008 })).toBe('message=boom code=1008');
  });

  it('still says something useful for an event carrying nothing', () => {
    expect(describeErrorEvent({})).toBe('message=(none reported by the transport)');
  });
});
