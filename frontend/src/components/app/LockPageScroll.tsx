"use client";

import { useEffect } from "react";

// The app frame is exactly one screen tall with its own scroll area. Anything injected after it
// (Privy's hidden frames, legacy providers) must not make the window scroll too, or the page shows
// two scrollbars. The landing page doesn't use the frame, so it keeps normal window scrolling.
export function LockPageScroll() {
  useEffect(() => {
    const root = document.documentElement;
    const previous = { html: root.style.overflow, body: document.body.style.overflow };
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous.html;
      document.body.style.overflow = previous.body;
    };
  }, []);
  return null;
}
