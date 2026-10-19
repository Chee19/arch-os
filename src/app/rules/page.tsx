import { HOLD_MINUTES, SUBSIDY_CAP_PENCE } from "@/engine/policy";
import { INCIDENT_BUDGET_PENCE } from "@/engine/incident";
import { money } from "@/lib/format";
import { RulesView } from "@/ui/views/Rules";

export default function Page() {
  return (
    <RulesView
      cap={money(SUBSIDY_CAP_PENCE())}
      budget={money(INCIDENT_BUDGET_PENCE)}
      holdMinutes={HOLD_MINUTES()}
    />
  );
}

export const instant = false;
