/**
 * The one reader of "which CSS animations and transitions are running right
 * now", shared by the timeline recorder (which reports the unsettled ones) and
 * the forced pseudo-state primitive (which waits for them to finish).
 *
 * `available: false` means the platform could not answer: `getAnimations` is
 * absent (jsdom, SSR) or threw. That is UNKNOWN, never "nothing is running",
 * and every caller has to treat it that way.
 */

export interface RunningAnimation {
  /** The live animation object (a `CSSTransition`, `CSSAnimation` or WAAPI animation). */
  animation: Animation;
  /** The element the animation's keyframe effect targets, when there is one. */
  element: Element | null;
}

export interface RunningAnimationsRead {
  animations: RunningAnimation[];
  available: boolean;
}

/**
 * Every document animation whose `playState` is `running`. A transition still
 * inside its `transition-delay` counts as running, which is what a settle wait
 * needs: a `delay-150` fade has not started drawing yet but will.
 *
 * `doc` defaults to the global document; pass an element's `ownerDocument`
 * to read the realm the element lives in (an iframe's).
 *
 * `document.getAnimations()` flushes pending style first (per the Web
 * Animations spec), so a transition created by a class or attribute change made
 * just before the call is included.
 */
export function readRunningAnimations(
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document
): RunningAnimationsRead {
  if (!doc || typeof doc.getAnimations !== 'function') {
    return { animations: [], available: false };
  }
  try {
    const animations: RunningAnimation[] = [];
    for (const animation of doc.getAnimations()) {
      if (animation.playState !== 'running') continue;
      const element = (animation.effect as KeyframeEffect | null)?.target ?? null;
      animations.push({ animation, element });
    }
    return { animations, available: true };
  } catch {
    return { animations: [], available: false };
  }
}
