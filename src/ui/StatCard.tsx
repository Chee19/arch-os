import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

// Tones follow the badge palette: purple, blue, mint, peach.
export type StatTone = "purple" | "blue" | "mint" | "peach";

export function StatCard({
  icon,
  tone,
  title,
  value,
  note,
}: {
  icon: IconName;
  tone: StatTone;
  title: string;
  value: ReactNode;
  note: string;
}) {
  return (
    <div className={`stat-card glass ${tone}`}>
      <div className="stat-top">
        <span>{title}</span>
        <span className={`tile-icon ${tone}`}>
          <Icon name={icon} />
        </span>
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
