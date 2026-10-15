"use client";

import { useRef } from "react";
import { gsap, useGSAP } from "./motion";

export function CountUp({
  value,
  format,
}: {
  value: number;
  format: (n: number) => string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  useGSAP(
    () => {
      const counter = { v: shown.current };
      gsap.to(counter, {
        v: value,
        duration: 1.2,
        ease: "power2.out",
        onUpdate: () => {
          shown.current = counter.v;
          if (ref.current)
            ref.current.textContent = format(Math.round(counter.v));
        },
      });
    },
    { dependencies: [value] },
  );
  return <span ref={ref}>{format(value)}</span>;
}
