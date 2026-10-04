# Final local runtime UI review (2026-10-04)

This acceptance branch descends from main `6fb8e44095455eea7ebe67f534788c5b61f5ba63`, including the three completed integration tasks. It targets the local installation; pushing this branch must not trigger the main-only Pages publication workflow.

The floating schematic previously treated a manually selected width of exactly 560 pixels as its responsive default. At a 1366x900 viewport, a real pointer resize to 560 therefore returned to 479 pixels. Explicit responsive-width intent now distinguishes the default from manual geometry. Cancel restores that intent, and reset restores responsive sizing. The isolated Chromium regression covers thirty animation frames after resize, collapse/expand, fullscreen exit, viewport changes, reset, and repeat resize. A functional component test exercises commit, cancel, and reset.

The reference modal's generic selector overrode its intended outer `overflow:hidden`. The more specific selector restores the intended computed style. Initial action buttons were visible in the observed baseline; this review does not claim to have reproduced initial clipping. Browser coverage measures initial geometry and pointer hit testing without prior hover or locator scrolling, then exercises inner scrolling, footer scrolling, and a real mouse action at 1920x1080, 1366x768, and 1024x768 for reference drawings, videos, and course drawings.

Both regressions run in the standard browser suite without conditional skips. Their accounts and course media belong exclusively to a fresh temporary synthetic database. No real accounts, authentication rows, or business database are used. Backend, database schema, persistence contracts, dependency lock, and local startup/build tooling remain unchanged from the previously accepted baseline.

Full extended checks, the twenty original course drawing checks, exact-head CI, and actual installation HTML/JavaScript/CSS byte verification are recorded separately by the coordinator. The local cutover requires an opaque stopped-state backup and preservation checks. No external production deployment or Tunnel configuration change is part of this acceptance.

Known limits remain: dependency advisories in `dependency-review-20261004.md`, finite capacity samples, and the user's final check with an existing real account. Successful CI does not clear those limits.
