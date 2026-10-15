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

type DemoContextValue = {
  state: DemoState | null;
  busy: boolean;
  error: string | null;
  toast: string | null;
  act: (a: Action) => Promise<boolean>;
  notify: (message: string) => void;
  retry: () => Promise<void>;
};

const DemoContext = createContext<DemoContextValue | null>(null);
const KEY = "archos-presenter-key";

export function useDemo(): DemoContextValue {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error("useDemo must be used inside DemoProvider");
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

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
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

  const act = useCallback(
    async (a: Action): Promise<boolean> => {
      if (inflight.current) return false;
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
          const key = window.prompt("Presenter key");
          if (!key) return false;
          window.localStorage.setItem(KEY, key);
          res = await post(key);
        }
        epoch.current += 1;
        if (res.ok) {
          const next = (await res.json()) as DemoState & { notice?: string };
          setState(next);
          setError(null);
          if (next.notice) notify(next.notice);
          return true;
        }
        // A 409 means another click or tab moved the run on: show that state, not an error page.
        notify(await errorOf(res));
        setState(await fetchState());
        setError(null);
        return false;
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        window.clearInterval(timer);
        inflight.current = false;
        setBusy(false);
      }
    },
    [poll, notify],
  );

  const value = useMemo(
    () => ({ state, busy, error, toast, act, notify, retry: poll }),
    [state, busy, error, toast, act, notify, poll],
  );
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}
