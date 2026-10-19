"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { gsap } from "./motion";

export function Modal({
  open,
  onClose,
  labelledBy,
  className = "dialog",
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  className?: "dialog" | "dialog wide" | "drawer";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      const from = className === "drawer" ? { x: 40 } : { y: 8, scale: 0.98 };
      gsap.fromTo(
        el,
        { autoAlpha: 0, ...from },
        {
          autoAlpha: 1,
          x: 0,
          y: 0,
          scale: 1,
          duration: 0.22,
          ease: "power2.out",
        },
      );
    }
    if (!open && el.open) el.close();
  }, [open, className]);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && children}
    </dialog>
  );
}
