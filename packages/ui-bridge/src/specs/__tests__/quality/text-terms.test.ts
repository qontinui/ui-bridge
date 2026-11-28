import { describe, expect, it } from 'vitest';
import { sharedStems, stem, stemsMatch, termStems } from '../../quality/text-terms';

describe('text terms', () => {
  it('stems German inflection to one form', () => {
    expect(stem('bestellungen')).toBe('bestell');
    expect(stem('bestellung')).toBe('bestell');
    expect(stem('projekte')).toBe('projekt');
    expect(stem('lieferadresse')).toBe('lieferadress');
    expect(stem('status')).toBe('statu');
  });

  it('stems English inflection to one form', () => {
    expect(stem('orders')).toBe('order');
    expect(stem('ordering')).toBe('order');
    expect(stem('invoices')).toBe('invoic');
    expect(stem('invoice')).toBe('invoic');
  });

  it('matches a compound to its part, as prefix or suffix', () => {
    expect(stemsMatch('projekt', 'projektnam')).toBe(true);
    expect(stemsMatch('adress', 'lieferadress')).toBe(true);
    expect(stemsMatch('kost', 'kostenstell')).toBe(false); // under 5 characters: equality only
  });

  it('drops tokens under five characters and values', () => {
    expect(termStems('Ihre und die mit the and your')).toEqual([]);
    expect(termStems('Bestellung 16.10.2026 12345 INV-2026-0042 Rechnungen')).toEqual(['bestell', 'rechn']);
  });

  it('lists the shared stems of two texts', () => {
    const subtitle = termStems('Ihre Aufträge mit Lieferungen, Rechnungen und Summen.');
    const intro = termStems(
      'Ihre Aufträge und Lager: Versandadresse, Ihre Bestellnummer, die Lieferungen und, mit Freigabe, die Summen je Auftrag.'
    );
    expect(subtitle).toEqual(['aufträg', 'liefer', 'rechn', 'summ']);
    expect(sharedStems(subtitle, intro)).toEqual(['aufträg', 'liefer', 'summ']);
  });
});
