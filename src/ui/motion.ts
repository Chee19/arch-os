"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { Flip } from "gsap/Flip";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";

gsap.registerPlugin(useGSAP, Flip, MotionPathPlugin, DrawSVGPlugin);

if (typeof window !== "undefined")
  // Reduced motion: every tween finishes almost instantly instead of each component branching.
  gsap.matchMedia().add("(prefers-reduced-motion: reduce)", () => {
    gsap.globalTimeline.timeScale(50);
    return () => gsap.globalTimeline.timeScale(1);
  });

export { Flip, gsap, useGSAP };
