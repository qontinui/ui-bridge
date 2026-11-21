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
  capabilities: string[];
}

export function buildLiveRelayOptions(loc: { origin: string; href: string }): LiveRelayOptions {
  return {
    // Forward the page's origin and href so the runner's registry surfaces a
    // real URL to the integration tool. Without these, the runner falls back
    // to a synthetic "ws://runner/ui-bridge/ws" placeholder that's useless on
    // the card.
    origin: loc.origin,
    pageUrl: loc.href,
    appType: 'wrapper',
    // The relay registers a `getScreenshot` handler (screenshot-handler.ts),
    // and the runner relays that action only to an app advertising this.
    capabilities: [SCREENSHOT_CAPABILITY],
  };
}
