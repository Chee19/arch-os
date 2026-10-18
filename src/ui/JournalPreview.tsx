"use client";

import { isBalanced } from "@/ledger/journal";
import { money } from "@/lib/format";
import { useDemo } from "./DemoProvider";

export function JournalPreview() {
  const { state } = useDemo();
  if (!state) return null;
  return (
    <section className="panel">
      <div className="panel-head between">
        <h2>Briefcase-ready journal</h2>
        <span className="badge amber">
          <i className="dot" />
          Ready to post to Briefcase
        </span>
      </div>
      <p className="journal-note">
        Map account names to your chart of accounts before posting. Built only
        from verified Stripe operations and the fulfilment event.
      </p>
      {state.journal.length === 0 ? (
        <p className="panel-body muted">
          Entries appear as Stripe operations succeed and fulfilment is
          recorded.
        </p>
      ) : (
        state.journal.map((e) => {
          const ok = isBalanced(e);
          return (
            <div className="journal-entry" key={e.key}>
              <div className="between">
                <h3>{e.title}</h3>
                <span className={`badge ${ok ? "green" : "red"}`}>
                  <i className="dot" />
                  {ok ? "Balanced" : "Not balanced"}
                </span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Debit</th>
                    <th>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {e.lines.map((l, i) => (
                    <tr key={`${l.account}-${i}`}>
                      <td>{l.account}</td>
                      <td className="mono">{l.debit ? money(l.debit) : ""}</td>
                      <td className="mono">
                        {l.credit ? money(l.credit) : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="minor">
                Source: <span className="mono">{e.source}</span>
              </p>
            </div>
          );
        })
      )}
    </section>
  );
}
