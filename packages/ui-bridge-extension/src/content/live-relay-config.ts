/**
 * The `LiveSessionTransport` options the live relay registers with. Kept out
 * of `live-relay.ts` (which boots on import) so the register frame they produce
 * can be tested against the real wrapper transport.
 */

import { SCREENSHOT_CAPABILITY } from './screenshot-handler';

export interface LiveRelayOptions {
  origin: string;
  pageUrl: string;
  appType: 'wrapper';
  capabilities?: string[];
}

export function buildLiveRelayOptions(
  loc: { origin: string; href: string },
  registered: { screenshot: boolean }
): LiveRelayOptions {
  const options: LiveRelayOptions = {
    // Forward the page's origin and href so the runner's registry surfaces a
    // real URL to the integration tool. Without these, the runner falls back
    // to a synthetic "ws://runner/ui-bridge/ws" placeholder that's useless on
    // the card.
    origin: loc.origin,
    pageUrl: loc.href,
    appType: 'wrapper',
  };
  // Advertised ONLY when the getScreenshot handler was actually registered:
  // the runner relays that action only to an app advertising this, so an
  // advertisement without the handler would read as an app fault (NO_HANDLER).
  if (registered.screenshot) options.capabilities = [SCREENSHOT_CAPABILITY];
  return options;
}
