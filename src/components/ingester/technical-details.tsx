import { ChevronRight } from "lucide-react";

import type {
  IngestResult,
  ValidationSummary,
} from "@/lib/ingest/ingest-types";

import { formatFixingCost } from "./ingest-helpers";

function Counts({ summary }: { summary?: ValidationSummary }) {
  if (!summary) return null;
  const rows: Array<[string, number | undefined]> = [
    ["Questions", summary.questions],
    ["Errors", summary.errorCount],
    ["Warnings", summary.warningCount],
    ["Checks that couldn't run", summary.infrastructureFailures],
  ];
  const shown = rows.filter(([, value]) => value !== undefined);
  if (!shown.length) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold">Check results</h3>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        {shown.map(([label, value]) => (
          <div
            key={label}
            className="contents"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Everything a developer or the Cerebry team may need. Closed by default. */
export function TechnicalDetails({
  threadId,
  result,
  reason,
}: {
  threadId: string;
  result?: IngestResult;
  reason?: string;
}) {
  return (
    <details
      className="group bg-card rounded-xl border"
      data-testid="ingest-technical-details"
    >
      <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium sm:px-6 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        Technical details
      </summary>
      <div className="space-y-5 border-t px-4 py-4 text-sm sm:px-6">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
          <dt className="text-muted-foreground">Thread ID</dt>
          <dd className="font-mono break-all">
            {result?.technical.threadId ?? threadId}
          </dd>
          {result ? (
            <>
              <dt className="text-muted-foreground">Status</dt>
              <dd
                className="font-mono break-all"
                data-testid="ingest-technical-status"
              >
                {result.status}
              </dd>
              {result.message ? (
                <>
                  <dt className="text-muted-foreground">Message</dt>
                  <dd className="break-words">{result.message}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Automatic fixing cost</dt>
              <dd
                className="tabular-nums"
                data-testid="ingest-technical-cost"
              >
                {formatFixingCost(result.technical.cost)}
              </dd>
            </>
          ) : null}
          {reason ? (
            <>
              <dt className="text-muted-foreground">Reason</dt>
              <dd>{reason}</dd>
            </>
          ) : null}
        </dl>

        {result ? (
          <>
            <Counts summary={result.technical.validation} />

            {result.warnings.length ? (
              <div>
                <h3 className="text-sm font-semibold">Warnings</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-xs break-words">
                  {result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {result.technical.findings.length ? (
              <div>
                <h3 className="text-sm font-semibold">Findings</h3>
                <ul className="mt-2 space-y-2">
                  {result.technical.findings.map((f, index) => (
                    <li
                      key={index}
                      className="bg-muted rounded-md px-3 py-2 font-mono text-xs break-words"
                    >
                      <span className="font-semibold">
                        {f.severity.toUpperCase()}
                      </span>
                      {f.code ? ` [${f.code}]` : ""}
                      {f.ctKey ? ` ${f.ctKey}` : ""}
                      {f.questionNo !== undefined
                        ? ` / variant ${f.questionNo}`
                        : ""}
                      {f.field ? ` · ${f.field}` : ""}
                      <span className="mt-1 block whitespace-pre-wrap">
                        {f.message}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </details>
  );
}
