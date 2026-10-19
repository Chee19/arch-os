import { Icon, type IconName } from "../Icon";
import { PageHeading } from "../PageHeading";

type Rule = {
  icon: IconName;
  tone: string;
  title: string;
  limit: string;
  text: string;
};

export function RulesView({
  cap,
  budget,
  holdMinutes,
}: {
  cap: string;
  budget: string;
  holdMinutes: number;
}) {
  const rules: Rule[] = [
    {
      icon: "wallet",
      tone: "purple",
      title: "Spend within a real budget",
      limit: `${cap} per booking · ${budget} per incident`,
      text: "Funds must be available before any commitment. Expected commission is not available cash.",
    },
    {
      icon: "people",
      tone: "blue",
      title: "Let customers choose",
      limit: "New provider? New acceptance.",
      text: "Show timing, scope, price and refund together. Declining a replacement remains a valid outcome.",
    },
    {
      icon: "clock",
      tone: "peach",
      title: "Respect the clock",
      limit: `${holdMinutes}-minute provider holds`,
      text: "An expired hold cannot be accepted. Recovery cannot postpone the customer's rightful remedy.",
    },
    {
      icon: "shield",
      tone: "mint",
      title: "Verify before calling it done",
      limit: "Offered → secured → fulfilled → settled",
      text: "Check the booking and each money movement independently. Every exception has a named owner.",
    },
  ];
  return (
    <>
      <PageHeading
        eyebrow="YOUR GUARDRAILS"
        title="Helpful autonomy. Clear limits."
        subtitle="Your workspace rules apply to every recovery. The agent can propose a solution; it cannot grant itself permission."
      />
      <div className="policy-grid">
        {rules.map((r) => (
          <section className="glass padded policy-card" key={r.title}>
            <span className={`tile-icon ${r.tone}`}>
              <Icon name={r.icon} />
            </span>
            <h2>{r.title}</h2>
            <strong>{r.limit}</strong>
            <p>{r.text}</p>
          </section>
        ))}
      </div>
    </>
  );
}
