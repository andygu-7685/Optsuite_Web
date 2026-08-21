import { useEffect, useRef } from "react";

/** Scrollable process log. Entries are dummy reports until a backend exists. */
export default function LogPanel({ entries }) {
  const scrollerRef = useRef(null);

  useEffect(() => {
    const node = scrollerRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [entries]);

  return (
    <div className="log-panel" ref={scrollerRef} role="log" aria-live="polite">
      {entries.length === 0 ? (
        <p className="empty-state">Process reports will appear here.</p>
      ) : (
        <ol className="log-list">
          {entries.map((entry) => (
            <li key={entry.id} className={`log-line log-${entry.level}`}>
              <span className="log-time">[{entry.time}]</span> {entry.message}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
