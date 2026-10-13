/**
 * The canonical find filter's media / content / scope surface and its typed
 * refusals, over plain serialized rows — plan
 * 2026-10-13-image-generation-and-visual-judgment, Phase 5.
 */

import { describe, it, expect } from 'vitest';
import {
  applyCanonicalFindFilter,
  FindRefusalError,
  isFindRefusalError,
  type CanonicalFindCriteria,
  type CanonicalFindContext,
  type FindFilterableElement,
} from './find-filter';
import { Observation, type UnknownCode } from '../observation/observation';
import type { MediaFacts, MediaFactsDimension } from './types';

function observed(facts: MediaFacts, unmeasured: Array<[MediaFactsDimension, UnknownCode]> = []) {
  return Observation.measured(
    facts,
    Observation.provenance({
      producer: { id: 'test/media', version: '0' },
      observedAt: Date.now(),
      coverage: {
        considered: 1,
        measured: unmeasured.length ? 0 : 1,
        unmeasured: unmeasured.map(([dimension, code]) => ({ dimension, count: 1, code })),
      },
    })
  );
}

function mediaRow(id: string, facts: Partial<MediaFacts>, extra: Partial<FindFilterableElement> = {}, unmeasured: Array<[MediaFactsDimension, UnknownCode]> = []): FindFilterableElement {
  return {
    id,
    type: 'image',
    category: 'media',
    state: { visible: true },
    mediaMetadata: observed(
      {
        mediaType: 'image',
        isDecorative: false,
        renderedWidth: 100,
        renderedHeight: 100,
        loadingState: 'loaded',
        ...facts,
      },
      unmeasured
    ),
    ...extra,
  };
}

const button: FindFilterableElement = { id: 'save', type: 'button', actions: ['click'], category: 'interactive', state: { visible: true } };
const heading: FindFilterableElement = { id: 'title', type: 'heading', category: 'content', kind: 'content', contentMetadata: { contentRole: 'heading' } };

function filterIds(rows: FindFilterableElement[], criteria: CanonicalFindCriteria, ctx?: CanonicalFindContext): string[] {
  return applyCanonicalFindFilter(rows, criteria, ctx).map((r) => r.id!);
}

function refusal(fn: () => unknown) {
  try {
    fn();
  } catch (err) {
    if (isFindRefusalError(err)) return err.refusal;
    throw err;
  }
  throw new Error('expected a FindRefusalError');
}

describe('null means absent', () => {
  it('a runner-style request of explicit nulls filters nothing', () => {
    const rows = [button, heading, mediaRow('hero', {})];
    const criteria = {
      testId: null,
      mediaType: null,
      srcPattern: null,
      oversizeThreshold: null,
      limit: null,
      root: null,
      selector: null,
      includeMedia: null,
      interactive_only: null,
    } as unknown as CanonicalFindCriteria;
    expect(filterIds(rows, criteria)).toEqual(['save', 'title', 'hero']);
  });
});

describe('a media-fact filter never passes a row it cannot evaluate — and says which', () => {
  const rows = [
    mediaRow('sharp', { effectiveResolution: 3 }),
    mediaRow('exact', { effectiveResolution: 1 }),
    mediaRow('loading', {}, {}, [['effectiveResolution', 'input_missing']]),
    mediaRow('vector', { mediaType: 'svg' }),
  ];

  it('oversizeThreshold returns only the proven match, and REPORTS the unmeasured row', () => {
    const ctx: CanonicalFindContext = {};
    expect(filterIds(rows, { oversizeThreshold: 2 }, ctx)).toEqual(['sharp']);
    // The vector SVG does not apply (no pixel density) — a plain miss, not a report.
    expect(ctx.unevaluated).toEqual([
      { id: 'loading', option: 'oversizeThreshold', code: 'input_missing' },
    ]);
  });

  it('a request every row could answer reports an EMPTY unevaluated list', () => {
    const ctx: CanonicalFindContext = {};
    filterIds([mediaRow('a', { effectiveResolution: 3 })], { oversizeThreshold: 2 }, ctx);
    expect(ctx.unevaluated).toEqual([]);
  });

  it('a request with no media-fact filter carries no unevaluated list at all', () => {
    const ctx: CanonicalFindContext = {};
    filterIds(rows, { mediaOnly: true }, ctx);
    expect(ctx.unevaluated).toBeUndefined();
  });

  it('brokenOnly reports an unmeasured loading state and misses a not-applicable one', () => {
    const bg = mediaRow('bg', { mediaType: 'background-image', loadingState: undefined }, {}, [['loadingState', 'input_missing']]);
    const role = mediaRow('role-img', { loadingState: undefined });
    const broken = mediaRow('broken', { loadingState: 'error' });
    const ctx: CanonicalFindContext = {};
    expect(filterIds([bg, role, broken], { brokenOnly: true }, ctx)).toEqual(['broken']);
    expect(ctx.unevaluated).toEqual([{ id: 'bg', option: 'brokenOnly', code: 'input_missing' }]);
  });

  it('a row whose capture failed is reported under every fact predicate, with the capture\'s code', () => {
    const failed: FindFilterableElement = {
      id: 'failed',
      category: 'media',
      mediaMetadata: Observation.unknown(
        'producer_failed',
        'media capture threw TypeError',
        Observation.provenance({ producer: { id: 'test/media', version: '0' } })
      ),
    };
    const ctx: CanonicalFindContext = {};
    expect(filterIds([failed], { brokenOnly: true, mediaType: 'svg' }, ctx)).toEqual([]);
    expect(ctx.unevaluated).toEqual([
      { id: 'failed', option: 'mediaType', code: 'producer_failed' },
      { id: 'failed', option: 'brokenOnly', code: 'producer_failed' },
    ]);
  });

  it('a definite miss on one predicate decides the row — nothing is reported for it', () => {
    const ctx: CanonicalFindContext = {};
    const unsure = mediaRow('unsure', { mediaType: 'video' }, {}, [['effectiveResolution', 'input_missing']]);
    expect(filterIds([unsure], { mediaType: 'image', oversizeThreshold: 2 }, ctx)).toEqual([]);
    expect(ctx.unevaluated).toEqual([]);
  });

  it('a row another (decidable) predicate drops is not reported either', () => {
    const ctx: CanonicalFindContext = {};
    const unsure = mediaRow('unsure', {}, { label: 'Banner' }, [['effectiveResolution', 'input_missing']]);
    expect(filterIds([unsure], { oversizeThreshold: 2, label: 'logo' }, ctx)).toEqual([]);
    expect(ctx.unevaluated).toEqual([]);
  });

  it('srcPattern does not pass a row with no src (an inline SVG)', () => {
    const svg = mediaRow('chart', { mediaType: 'svg' });
    expect(filterIds([svg], { srcPattern: '.*' })).toEqual([]);
  });

  it('every fact predicate selects media rows only', () => {
    expect(filterIds([button, heading, mediaRow('hero', { mediaType: 'image' })], { mediaType: 'image' })).toEqual(['hero']);
  });
});

describe('srcPattern reads the §4.6-scrubbed src', () => {
  it('cannot probe a URL inside a redaction boundary', () => {
    const redacted = mediaRow(
      'secret',
      { src: 'https://cdn.example/totp?token=abc' },
      { state: { visible: true, redaction: { content: true } } }
    );
    const open = mediaRow('public', { src: 'https://cdn.example/logo.png' });
    expect(filterIds([redacted, open], { srcPattern: 'token=abc' })).toEqual([]);
    expect(filterIds([redacted, open], { srcPattern: 'cdn\\.example' })).toEqual(['public']);
  });
});

describe('content options and limit', () => {
  it('contentOnly / contentRole / includeContent', () => {
    const rows = [button, heading, mediaRow('hero', {})];
    expect(filterIds(rows, { contentOnly: true })).toEqual(['title']);
    expect(filterIds(rows, { contentRole: 'heading' })).toEqual(['title']);
    expect(filterIds(rows, { contentRole: 'caption' })).toEqual([]);
    expect(filterIds(rows, { includeContent: false })).toEqual(['save', 'hero']);
  });

  it('limit caps AFTER filtering; 0 means no cap', () => {
    const rows = [button, mediaRow('a', {}), mediaRow('b', {}), mediaRow('c', {})];
    expect(filterIds(rows, { mediaOnly: true, limit: 2 })).toEqual(['a', 'b']);
    expect(filterIds(rows, { mediaOnly: true, limit: 0 })).toEqual(['a', 'b', 'c']);
  });
});

describe('typed refusals', () => {
  it('carry the transport and the options they are about', () => {
    const r = refusal(() =>
      applyCanonicalFindFilter([button], { mediaOnly: true, interactiveOnly: true }, { transport: 'server' })
    );
    expect(r).toMatchObject({ code: 'UB-VALIDATION-ERROR', transport: 'server' });
    expect(r.options).toEqual(['interactiveOnly', 'mediaOnly']);
  });

  it.each<[string, CanonicalFindCriteria]>([
    ['includeMedia:false with a media filter', { includeMedia: false, brokenOnly: true }],
    ['includeContent:false with contentOnly', { includeContent: false, contentOnly: true }],
    ['content and media at once', { contentOnly: true, mediaOnly: true }],
    ['interactiveOnly with contentRole', { interactiveOnly: true, contentRole: 'heading' }],
  ])('%s is a contradiction', (_name, criteria) => {
    expect(refusal(() => applyCanonicalFindFilter([button], criteria)).code).toBe('UB-VALIDATION-ERROR');
  });

  it.each<[string, Record<string, unknown>]>([
    ['types not an array', { types: 'button' }],
    ['a negative limit', { limit: -1 }],
    ['a zero threshold', { oversizeThreshold: 0 }],
    ['a non-string srcPattern', { srcPattern: 7 }],
    ['a non-boolean mediaOnly', { mediaOnly: 'yes' }],
  ])('%s is invalid', (_name, criteria) => {
    expect(refusal(() => applyCanonicalFindFilter([button], criteria as CanonicalFindCriteria)).code).toBe(
      'UB-VALIDATION-ERROR'
    );
  });

  it('root / selector over rows with no DOM are capability_unavailable_in_build', () => {
    const r = refusal(() =>
      applyCanonicalFindFilter([button], { selector: 'button' }, { transport: 'relay-cache', liveDom: false })
    );
    expect(r).toMatchObject({
      code: 'UB-OBS-CAPABILITY-UNAVAILABLE-IN-BUILD',
      unknownCode: 'capability_unavailable_in_build',
      options: ['selector'],
      transport: 'relay-cache',
    });
  });

  it('a media question over an empty registry is producer_not_run', () => {
    const r = refusal(() => applyCanonicalFindFilter([], { mediaType: 'image' }, { registrySize: 0 }));
    expect(r).toMatchObject({ code: 'UB-OBS-PRODUCER-NOT-RUN', unknownCode: 'producer_not_run' });
  });

  it('a non-media question over an empty registry is just empty', () => {
    expect(filterIds([], { interactiveOnly: true }, { registrySize: 0 })).toEqual([]);
  });

  it('a media-fact filter over a legacy (non-envelope) media row is refused', () => {
    const legacy: FindFilterableElement = {
      id: 'old',
      category: 'media',
      mediaMetadata: { mediaType: 'image', loadingState: 'error', isDecorative: false },
    };
    const r = refusal(() => applyCanonicalFindFilter([legacy], { brokenOnly: true }));
    expect(r.code).toBe('UB-OBS-CAPABILITY-UNAVAILABLE-IN-BUILD');
    // mediaOnly needs only the category — still answerable.
    expect(filterIds([legacy], { mediaOnly: true })).toEqual(['old']);
  });

  it('FindRefusalError is an Error with the code on it', () => {
    const err = new FindRefusalError({ code: 'UB-VALIDATION-ERROR', options: [], transport: 'direct', detail: 'x' });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('UB-VALIDATION-ERROR');
    expect(isFindRefusalError(err)).toBe(true);
    expect(isFindRefusalError(new Error('x'))).toBe(false);
  });
});
