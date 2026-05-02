import { requireStateAnnotationRule } from './rules/require-state-annotation';
declare const plugin: {
    readonly meta: {
        readonly name: "@qontinui/ui-bridge-eslint-plugin";
        readonly version: "0.1.0";
    };
    readonly rules: {
        readonly 'require-state-annotation': import("@typescript-eslint/utils/ts-eslint").RuleModule<"requireStateAnnotation", import("./rules/require-state-annotation").RuleOptions, unknown, import("@typescript-eslint/utils/ts-eslint").RuleListener> & {
            name: string;
        };
    };
    readonly configs: {
        readonly recommended: {
            readonly plugins: readonly ["ui-bridge"];
            readonly rules: {
                readonly 'ui-bridge/require-state-annotation': "warn";
            };
        };
    };
};
export { requireStateAnnotationRule };
export default plugin;
//# sourceMappingURL=index.d.ts.map