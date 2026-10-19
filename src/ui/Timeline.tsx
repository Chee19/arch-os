export type TimelineEvent = {
  key: string | number;
  title: string;
  detail?: string;
  time: string;
};

export function Timeline({
  events,
  compact = false,
}: {
  events: TimelineEvent[];
  compact?: boolean;
}) {
  return (
    <ol className={`timeline ${compact ? "compact" : ""}`}>
      {events.map((e) => (
        <li key={e.key}>
          <span className="timeline-dot" />
          <div>
            <strong>{e.title}</strong>
            {!compact && e.detail && <p>{e.detail}</p>}
            <small>{e.time}</small>
          </div>
        </li>
      ))}
    </ol>
  );
}
