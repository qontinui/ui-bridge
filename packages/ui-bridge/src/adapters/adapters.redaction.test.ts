/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { FormikAdapter } from './formik';
import { ReactHookFormAdapter } from './react-hook-form';
import { REDACTED_VALUE } from '../core/redaction';

const SECRET = 'SECRET-adapter-2208';

afterEach(() => {
  document.body.innerHTML = '';
  delete window.__UI_BRIDGE_FORMIK_FORMS__;
  delete window.__UI_BRIDGE_RHF_FORMS__;
});

function formikForms() {
  window.__UI_BRIDGE_FORMIK_FORMS__ = new Map([
    [
      'f',
      {
        values: { email: 'a@b.c', nick: 'n' },
        errors: {},
        touched: {},
        dirty: false,
        isValid: true,
        initialValues: { email: 'a@b.c', nick: 'n' },
      },
    ],
  ]);
  return new FormikAdapter().extractForms();
}

function rhfForms() {
  window.__UI_BRIDGE_RHF_FORMS__ = new Map([
    [
      'f',
      {
        formState: {
          errors: {},
          touchedFields: {},
          dirtyFields: {},
          isValid: true,
          isDirty: false,
        },
        getValues: () => ({ email: 'a@b.c', nick: 'n' }),
      },
    ],
  ]);
  return new ReactHookFormAdapter().extractForms();
}

const FIXTURES: Record<string, () => unknown> = {
  formik: formikForms,
  'react-hook-form': rhfForms,
};

for (const [name, extract] of Object.entries(FIXTURES)) {
  describe(`${name} adapter field labels — redaction boundaries`, () => {
    it('label[for] with a boundary below reads as the sentinel in extractForms()', () => {
      document.body.innerHTML =
        `<label for="email">Email <span data-bridge-redact="true">${SECRET}</span></label>` +
        `<input id="email" name="email" />` +
        `<input id="nick" name="nick" />`;
      const forms = extract() as Array<{ fields: Array<{ id: string; label: string }> }>;
      const field = forms[0].fields.find((f) => f.id === 'email')!;
      expect(field.label).toBe(`Email ${REDACTED_VALUE}`);
      expect(JSON.stringify(forms)).not.toContain(SECRET);
    });

    it('a wrapping label with a boundary below reads as the sentinel', () => {
      document.body.innerHTML =
        `<label>Nick <span data-bridge-redact="true">${SECRET}</span>` +
        `<input id="nick" name="nick" /></label>` +
        `<input id="email" name="email" />`;
      const forms = extract() as Array<{ fields: Array<{ id: string; label: string }> }>;
      const field = forms[0].fields.find((f) => f.id === 'nick')!;
      expect(field.label).toBe(`Nick ${REDACTED_VALUE}`);
      expect(JSON.stringify(forms)).not.toContain(SECRET);
    });

    it('a wrapping label that sits inside a boundary reads as the sentinel', () => {
      document.body.innerHTML =
        `<div data-bridge-redact="true"><label>Nick ${SECRET}` +
        `<input id="nick" name="nick" /></label></div>` +
        `<input id="email" name="email" />`;
      const forms = extract() as Array<{ fields: Array<{ id: string; label: string }> }>;
      const field = forms[0].fields.find((f) => f.id === 'nick')!;
      expect(field.label).toBe(REDACTED_VALUE);
      expect(JSON.stringify(forms)).not.toContain(SECRET);
    });
  });
}
