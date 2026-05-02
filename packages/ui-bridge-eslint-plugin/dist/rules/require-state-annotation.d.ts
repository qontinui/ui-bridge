import { ESLintUtils } from '@typescript-eslint/utils';
export interface Options {
    testGlobs?: string[];
}
export type RuleOptions = [Options?];
export type MessageIds = 'requireStateAnnotation';
export declare const requireStateAnnotationRule: ESLintUtils.RuleModule<"requireStateAnnotation", RuleOptions, unknown, ESLintUtils.RuleListener> & {
    name: string;
};
export default requireStateAnnotationRule;
//# sourceMappingURL=require-state-annotation.d.ts.map