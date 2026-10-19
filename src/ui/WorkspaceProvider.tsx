"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Action } from "@/engine/actions";
import type { DemoState } from "@/engine/state";
import { shouldContinue } from "./nextStep";

type WorkspaceContextValue = {
  state: DemoState | null;
  busy: boolean;
  error: string | null;
  toast: string | null;
  act: (a: Action) => Promise<boolean>;
  // Runs the action, then keeps advancing until the case reaches a step that needs a person.
  proceed: (first: Action) => Promise<boolean>;
  notify: (message: string) => void;
  retry: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
const KEY = "archos-access-key";

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx)
    throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}

async function errorOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `Request failed (${res.status}).`;
}

async function fetchState(): Promise<DemoState> {
  const res = await fetch("/api/state", { cache: "no-store" });
  if (!res.ok) throw new Error(await errorOf(res));
  return (await res.json()) as DemoState;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [chaining, setChaining] = useState(false);
  const chain = useRef(false);
  const epoch = useRef(0);
  const polling = useRef(false);
  // busy lags one render, so two clicks in the same frame would both post without this.
  const inflight = useRef(false);

  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    const started = epoch.current;
    try {
      const next = await fetchState();
      // A poll that started before the last action finished would overwrite newer state.
      if (started === epoch.current) setState(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      polling.current = false;
    }
  }, []);

  useEffect(() => {
    // setState runs after the fetch resolves, not synchronously in the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void poll();
  }, [poll]);

  const serverBusy = state?.demo.busy ?? false;
  useEffect(() => {
    if (!serverBusy || busy) return;
    const timer = window.setInterval(() => void poll(), 400);
    return () => window.clearInterval(timer);
  }, [serverBusy, busy, poll]);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 4000);
  }, []);

  const send = useCallback(
    async (a: Action): Promise<DemoState | null> => {
      if (inflight.current) return null;
      inflight.current = true;
      setBusy(true);
      const timer = window.setInterval(() => void poll(), 400);
      const post = (key: string | null) =>
        fetch("/api/demo", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(key ? { "x-demo-key": key } : {}),
          },
          body: JSON.stringify(a),
        });
      try {
        let res = await post(window.localStorage.getItem(KEY));
        if (res.status === 401) {
          const key = window.prompt("Access key");
          if (!key) return null;
          window.localStorage.setItem(KEY, key);
          res = await post(key);
        }
        epoch.current += 1;
        if (res.ok) {
          const next = (await res.json()) as DemoState & { notice?: string };
          setState(next);
          setError(null);
          if (next.notice) notify(next.notice);
          return next;
        }
        // A 409 means another click or tab moved the run on: show that state, not an error page.
        notify(await errorOf(res));
        setState(await fetchState());
        setError(null);
        return null;
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        window.clearInterval(timer);
        inflight.current = false;
        setBusy(false);
      }
    },
    [poll, notify],
  );

  const act = useCallback(
    async (a: Action) => !chain.current && (await send(a)) !== null,
    [send],
  );

  const proceed = useCallback(
    async (first: Action) => {
      if (chain.current || inflight.current) return false;
      chain.current = true;
      // Held for the whole chain, so buttons never flicker back on between steps.
      setChaining(true);
      try {
        let next = await send(first);
        while (next && shouldContinue(next))
          next = await send({ action: "advance", step: next.demo.step });
        return next !== null;
      } finally {
        chain.current = false;
        setChaining(false);
      }
    },
    [send],
  );

  const value = useMemo(
    () => ({
      state,
      // The server flag covers steps started by another tab or before a reload.
      busy: busy || chaining || serverBusy,
      error,
      toast,
      act,
      proceed,
      notify,
      retry: poll,
    }),
    [
      state,
      busy,
      chaining,
      serverBusy,
      error,
      toast,
      act,
      proceed,
      notify,
      poll,
    ],
  );
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}
