import { useEffect, useRef, type ReactNode } from "react";

/** A manual popover stays above panels without taking focus or blocking the map. */
export function LocationNotice({ children, isError }: { children: ReactNode; isError: boolean }) {
  const noticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const notice = noticeRef.current;
    if (!notice?.showPopover) return;
    notice.setAttribute("popover", "manual");

    const bringToFront = () => {
      if (notice.matches(":popover-open")) notice.hidePopover();
      notice.showPopover();
    };
    bringToFront();
    // Modal dialogs and fullscreen elements also enter the browser's top layer.
    const observer = new MutationObserver(bringToFront);
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
    document.addEventListener("fullscreenchange", bringToFront);
    return () => {
      observer.disconnect();
      document.removeEventListener("fullscreenchange", bringToFront);
      if (notice.matches(":popover-open")) notice.hidePopover();
    };
  }, []);

  return <p ref={noticeRef} className={`map-location-notice${isError ? " is-error" : ""}`} role="status" aria-atomic="true">{children}</p>;
}
