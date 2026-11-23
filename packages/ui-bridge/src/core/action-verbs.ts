/**
 * The built-in element-action verbs: what `DefaultActionExecutor` (and the
 * page dispatcher's `executeElementAction`) run without a custom handler.
 *
 * One list, shared by the executor's unknown-verb check and the element-action
 * event producer (`./element-action-events.ts`), which records a verb only when
 * it is one of these or a custom action the element registered.
 */
export const BUILT_IN_ACTION_VERBS: ReadonlySet<string> = new Set<string>([
  'click',
  'hoverClick',
  'doubleClick',
  'rightClick',
  'middleClick',
  'type',
  'sendKeys',
  'clear',
  'select',
  'focus',
  'blur',
  'hover',
  'unhover',
  'scroll',
  'scrollIntoView',
  'check',
  'uncheck',
  'toggle',
  'drag',
  'setValue',
  'submit',
  'reset',
  'autocomplete',
]);
