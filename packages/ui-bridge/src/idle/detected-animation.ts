/**
 * One CSS animation or transition, as the idle signals and the interaction
 * timeline report it. A leaf module (no imports) so wire types can depend on it.
 */
export interface DetectedAnimation {
  /** `animationName`, or `transition:<property>` for a CSS transition. */
  name: string;
  /** `ElementFingerprintData.hash` of the animated element, when it could be computed. */
  targetElement?: string;
  /** Duration (ms) when known — the elapsed time at end, or the effect's timing. */
  durationMs?: number;
  /** Whether the animation repeats forever. */
  isInfinite: boolean;
}
