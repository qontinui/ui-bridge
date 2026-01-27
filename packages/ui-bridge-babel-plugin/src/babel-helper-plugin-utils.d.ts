/**
 * Type declarations for @babel/helper-plugin-utils
 */
declare module '@babel/helper-plugin-utils' {
  import type { PluginObj } from '@babel/core';

  export function declare<TOptions, TState>(
    factory: (api: {
      assertVersion: (version: number) => void;
      types: typeof import('@babel/types');
    }, options: TOptions) => PluginObj<TState>
  ): (api: any, options: TOptions) => PluginObj<TState>;
}
