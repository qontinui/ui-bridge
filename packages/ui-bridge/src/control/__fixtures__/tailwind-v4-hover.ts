/**
 * Real Tailwind v4 output for the hover-reveal pattern the runner's
 * `ZoneHoverActions` toolbar uses, in the two shapes Tailwind v4 emits it.
 * Consumed by `forced-hover.smoke.test.ts`.
 *
 * PROVENANCE. This repo does not depend on tailwindcss, so the CSS is checked
 * in literally rather than generated at test time. It was generated
 * 2026-10-22 with tailwindcss 4.2.4 / @tailwindcss/node 4.2.4 (the versions
 * qontinui-runner pins) from the input
 *
 *   @layer theme, base, components, utilities;
 *   @import "tailwindcss/utilities" layer(utilities);
 *
 * and the candidates `group opacity-0 pointer-events-none
 * group-hover:opacity-100 group-hover:pointer-events-auto hover:bg-[#ff0000]
 * bg-[#0000ff] [&:hover]:underline transition-opacity duration-200 delay-150`:
 *
 *  - TAILWIND_V4_DEV_CSS is `compile(input).build(candidates)`, unoptimized:
 *    what dev serve emits. `group-hover:` is a NESTED style rule
 *    (`&:is(:where(.group):hover *)`) with the `@media (hover: hover)` nested
 *    INSIDE it, all within `@layer utilities`.
 *  - TAILWIND_V4_BUILD_CSS is `optimize(dev, { minify: false })` from
 *    @tailwindcss/node (Lightning CSS): what a production build ships. The
 *    nesting is flattened to `@layer utilities { @media (hover: hover) {
 *    .x:is(:where(.group):hover *) { … } } }`.
 *
 * Both strings are byte-for-byte the generator's output (String.raw keeps the
 * escaped class-name backslashes). Regenerate rather than hand-edit.
 */

export const TAILWIND_V4_DEV_CSS = String.raw`/*! tailwindcss v4.2.4 | MIT License | https://tailwindcss.com */
@layer properties;
@layer theme, base, components, utilities;
@layer utilities {
  .pointer-events-none {
    pointer-events: none;
  }
  .bg-\[\#0000ff\] {
    background-color: #0000ff;
  }
  .opacity-0 {
    opacity: 0%;
  }
  .transition-opacity {
    transition-property: opacity;
    transition-timing-function: var(--tw-ease, ease);
    transition-duration: var(--tw-duration, 0s);
  }
  .delay-150 {
    transition-delay: 150ms;
  }
  .duration-200 {
    --tw-duration: 200ms;
    transition-duration: 200ms;
  }
  .group-hover\:pointer-events-auto {
    &:is(:where(.group):hover *) {
      @media (hover: hover) {
        pointer-events: auto;
      }
    }
  }
  .group-hover\:opacity-100 {
    &:is(:where(.group):hover *) {
      @media (hover: hover) {
        opacity: 100%;
      }
    }
  }
  .hover\:bg-\[\#ff0000\] {
    &:hover {
      @media (hover: hover) {
        background-color: #ff0000;
      }
    }
  }
  .\[\&\:hover\]\:underline {
    &:hover {
      text-decoration-line: underline;
    }
  }
}
@property --tw-duration {
  syntax: "*";
  inherits: false;
}
@layer properties {
  @supports ((-webkit-hyphens: none) and (not (margin-trim: inline))) or ((-moz-orient: inline) and (not (color:rgb(from red r g b)))) {
    *, ::before, ::after, ::backdrop {
      --tw-duration: initial;
    }
  }
}

`;

export const TAILWIND_V4_BUILD_CSS = String.raw`/*! tailwindcss v4.2.4 | MIT License | https://tailwindcss.com */
@layer properties {
  @supports (((-webkit-hyphens: none)) and (not (margin-trim: inline))) or ((-moz-orient: inline) and (not (color: rgb(from red r g b)))) {
    *, :before, :after, ::backdrop {
      --tw-duration: initial;
    }
  }
}

@layer theme, base, components;

@layer utilities {
  .pointer-events-none {
    pointer-events: none;
  }

  .bg-\[\#0000ff\] {
    background-color: #00f;
  }

  .opacity-0 {
    opacity: 0;
  }

  .transition-opacity {
    transition-property: opacity;
    transition-timing-function: var(--tw-ease, ease);
    transition-duration: var(--tw-duration, 0s);
  }

  .delay-150 {
    transition-delay: .15s;
  }

  .duration-200 {
    --tw-duration: .2s;
    transition-duration: .2s;
  }

  @media (hover: hover) {
    .group-hover\:pointer-events-auto:is(:where(.group):hover *) {
      pointer-events: auto;
    }

    .group-hover\:opacity-100:is(:where(.group):hover *) {
      opacity: 1;
    }

    .hover\:bg-\[\#ff0000\]:hover {
      background-color: red;
    }
  }

  .\[\&\:hover\]\:underline:hover {
    text-decoration-line: underline;
  }
}

@property --tw-duration {
  syntax: "*";
  inherits: false
}

`;
