/** The file filters a `test:smoke` script hands `vitest run`. */
export declare function smokeFilters(script: string | undefined): string[];
/** Whether `npm run test:smoke` runs this test file, by vitest's own filter rule. */
export declare function smokeSelection(testFile: string): {
  packageDir: string | null;
  relativePath: string;
  filters: string[];
  selected: boolean;
};
