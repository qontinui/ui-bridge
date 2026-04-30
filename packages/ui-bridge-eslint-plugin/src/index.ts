import { requireStateAnnotationRule } from './rules/require-state-annotation';

const rules = {
  'require-state-annotation': requireStateAnnotationRule,
} as const;

const plugin = {
  meta: {
    name: '@qontinui/ui-bridge-eslint-plugin',
    version: '0.1.0',
  },
  rules,
  configs: {
    recommended: {
      plugins: ['ui-bridge'],
      rules: {
        'ui-bridge/require-state-annotation': 'warn',
      },
    },
  },
} as const;

export { requireStateAnnotationRule };
export default plugin;
