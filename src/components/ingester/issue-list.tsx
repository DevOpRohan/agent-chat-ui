import type { IssueGroup } from "@/lib/ingest/plain-issues";

/** The open issues in plain words, grouped as "CT N, variant M" (the creator's .md headings). */
export function IssueList({ groups }: { groups: readonly IssueGroup[] }) {
  return (
    <ul
      className="divide-y"
      data-testid="ingest-issue-list"
    >
      {groups.map((group) => (
        <li
          key={group.key}
          className="py-3 first:pt-0 last:pb-0"
          data-testid="ingest-issue-group"
        >
          <p className="font-semibold">
            <span className="whitespace-nowrap">{group.label}</span>
            {group.ctKey ? (
              <span className="text-muted-foreground mt-0.5 block font-mono text-xs font-normal break-all sm:mt-0 sm:ml-2 sm:inline">
                {group.ctKey}
              </span>
            ) : null}
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {group.issues.map((issue, index) => (
              <li
                key={index}
                className="flex gap-2 text-sm leading-relaxed"
              >
                <span
                  aria-hidden="true"
                  className="text-muted-foreground"
                >
                  •
                </span>
                <span>
                  {issue.optional ? (
                    <span className="text-muted-foreground">Optional: </span>
                  ) : null}
                  {issue.text}
                  {issue.where ? (
                    <span className="text-muted-foreground">
                      {" "}
                      ({issue.where})
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
