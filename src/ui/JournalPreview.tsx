"use client";

import { isBalanced } from "@/ledger/journal";
import { money } from "@/lib/format";
import { useWorkspace } from "./WorkspaceProvider";
import { Icon } from "./Icon";

export function JournalPreview() {
  const { state } = useWorkspace();
  if (!state) return null;
  return (
    <section className="glass padded journal-panel">
      <div className="section-heading">
        <div>
          <h2>Briefcase-ready journal</h2>
          <p>
            Map account names to your chart of accounts before posting to
            Briefcase. Built only from verified Stripe operations and the
            fulfilment event.
          </p>
        </div>
        {state.journal.length > 0 && (
          <span className="badge peach">
            <i />
            Ready to post to Briefcase
          </span>
        )}
      </div>
      {state.journal.length === 0 ? (
        <div className="empty-state">
          <Icon name="inbox" />
          <h3>No entries yet</h3>
          <p>
            Entries appear as Stripe operations succeed and fulfilment is
            recorded.
          </p>
        </div>
      ) : (
        state.journal.map((e) => {
          const ok = isBalanced(e);
          return (
            <div className="journal-entry" key={e.key}>
              <div className="section-heading">
                <h3>{e.title}</h3>
                <span className={`badge ${ok ? "green" : "red"}`}>
                  <i />
                  {ok ? "Balanced" : "Not balanced"}
                </span>
              </div>
              <div className="table-scroll">
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
                        <td className="mono">
                          {l.debit ? money(l.debit) : ""}
                        </td>
                        <td className="mono">
                          {l.credit ? money(l.credit) : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
