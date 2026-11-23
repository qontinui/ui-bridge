/**
 * `windowLocationPath` — the path form a no-adapter navigation uses (plan
 * 2026-11-08-relayed-ui-bridge-actions-have-no-browser-case, D3). The target is
 * normalized as the URL parser would (outer whitespace / C0 stripped, tabs and
 * newlines removed) and only a BARE ROUTE NAME is prefixed with `/`. Anything
 * else — a path, `//host`, an absolute URL of any scheme — passes through
 * normalized and unprefixed; a non-http scheme is then refused by the gate,
 * which checks this very string (`checkNavigationTarget`).
 */
import { describe, expect, it } from 'vitest';
import { windowLocationPath } from '../navigation-adapter';
import { checkNavigationTarget, navigationPathForm } from '../../core/navigation-url';

describe('windowLocationPath', () => {
  it.each([
    ['settings', '/settings'],
    ['fleet/runs', '/fleet/runs'],
    ['httpbin', '/httpbin'],
    ['https-settings', '/https-settings'],
    ['http', '/http'],
    ['/settings', '/settings'],
    [' /settings', '/settings'],
    [' settings ', '/settings'],
    ['\t/evil.test/x', '/evil.test/x'],
    ['/\t/evil.test/x', '//evil.test/x'],
    ['//cdn.test/x', '//cdn.test/x'],
    ['http://example.test/a', 'http://example.test/a'],
    ['https://example.test/a', 'https://example.test/a'],
    ['HTTPS://example.test/a', 'HTTPS://example.test/a'],
    [' https://example.test/a', 'https://example.test/a'],
    ['mailto:a@b.test', 'mailto:a@b.test'],
    ['javascript:x', 'javascript:x'],
    // Relative references keep their relative meaning (resolved by the gate).
    ['?q=1', '?q=1'],
    ['#section', '#section'],
    ['./x', './x'],
    ['../x', '../x'],
  ])('%j → %j', (target, expected) => {
    expect(windowLocationPath(target)).toBe(expected);
  });

  it('is the path form the navigateByAdapter gate checks', () => {
    for (const target of ['settings', ' /settings', '\t/evil.test/x', 'mailto:x', '//h/x']) {
      expect(windowLocationPath(target)).toBe(navigationPathForm(target));
    }
  });

  it('a non-http scheme passes through unprefixed and the gate refuses it', () => {
    for (const target of ['mailto:a@b.test', 'javascript:x']) {
      expect(checkNavigationTarget(target, 'tauri://localhost/').ok).toBe(false);
      expect(checkNavigationTarget(target, 'http://localhost:3000/').ok).toBe(false);
    }
  });
});
