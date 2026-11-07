import { describe, expect, it } from 'vitest';
import { interpretJsonBody } from './request-body';

// The one body rule every adapter (standalone, Express, Next.js) ends in.
describe('interpretJsonBody', () => {
  it.each([
    ['', 'application/json'],
    ['  \n\t', 'application/json'],
    ['', undefined],
  ])('reads %j (%s) as no body', (text, type) => {
    expect(interpretJsonBody(text, type)).toEqual({ ok: true, body: undefined });
  });

  it.each([
    ['{"a":1}', 'application/json', { a: 1 }],
    ['[1,2]', 'application/vnd.api+json', [1, 2]],
    ['42', null, 42],
    ['null', 'application/json', null],
    ['"s"', 'text/plain', 's'],
  ])('parses %j (%s)', (text, type, body) => {
    expect(interpretJsonBody(text, type)).toEqual({ ok: true, body });
  });

  it.each([['application/json'], ['application/problem+json; charset=utf-8'], [undefined], [null]])(
    'refuses a body that does not parse when declared %s',
    (type) => {
      expect(interpretJsonBody('{oops', type)).toEqual({
        ok: false,
        status: 400,
        message: 'Request body is not valid JSON',
      });
    }
  );

  it('reads an unparseable body declared as another type as no body', () => {
    expect(interpretJsonBody('a=1&b=2', 'application/x-www-form-urlencoded')).toEqual({
      ok: true,
      body: undefined,
    });
  });
});
