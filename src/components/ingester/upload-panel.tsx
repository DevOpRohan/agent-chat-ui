"use client";

import {
  AlertTriangle,
  CircleAlert,
  FileJson,
  LoaderCircle,
  Upload,
} from "lucide-react";
import { useCallback, useId, useRef, useState, type DragEvent } from "react";

import { DailyBudget } from "@/components/thread/daily-budget";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { IngestLimitNotice } from "@/hooks/use-ingest-thread";
import { formatBytes } from "@/lib/ingest/format";
import { questionTypeCounts } from "@/lib/ingest/topic-model";
import {
  checkFileMeta,
  checkTopicText,
  describeDifficulty,
  FILE_MESSAGES,
  plural,
  type FileCheck,
} from "@/lib/ingest/topic-file";
import { cn } from "@/lib/utils";

type QuestionTypeCount = ReturnType<typeof questionTypeCounts>[number];

interface Selection {
  file: File | null;
  check: FileCheck;
  types: QuestionTypeCount[];
}

/** The chat composer's drop-zone look: dotted primary border while a file is over it. */
function dropZoneClass(dragging: boolean): string {
  return dragging
    ? "border-primary border-2 border-dotted"
    : "border border-solid";
}

async function checkFile(file: File): Promise<Selection> {
  const early = checkFileMeta(file.name, file.size);
  if (early) return { file, check: early, types: [] };
  let check: FileCheck;
  try {
    check = checkTopicText(await file.text());
  } catch {
    check = {
      ok: false,
      problem: "unreadable",
      message: FILE_MESSAGES.unreadable,
    };
  }
  let types: QuestionTypeCount[] = [];
  if (check.ok) {
    try {
      types = questionTypeCounts(JSON.parse(check.text));
    } catch {
      types = [];
    }
  }
  return { file, check, types };
}

export function UploadPanel({
  starting,
  error,
  limitNotice,
  onIngest,
}: {
  starting: boolean;
  /** Why the last start failed (shown only while the same file is still selected). */
  error: string | null;
  limitNotice: IngestLimitNotice | null;
  onIngest: (file: File, text: string) => Promise<void>;
}) {
  const inputId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [attempted, setAttempted] = useState<File | null>(null);

  const handleFiles = useCallback(async (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    if (list.length > 1) {
      setSelection({
        file: null,
        check: {
          ok: false,
          problem: "multiple_files",
          message: FILE_MESSAGES.oneFile,
        },
        types: [],
      });
      return;
    }
    const file = list[0]!;
    setReading(true);
    try {
      setSelection(await checkFile(file));
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, []);

  const chooseAnother = () => inputRef.current?.click();

  const onDragOver = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = starting ? "none" : "copy";
    if (!starting) setDragging(true);
  };
  const onDragLeave = (event: DragEvent) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null))
      return;
    setDragging(false);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    // Keep the chat composer's window-level drop handler away from the topic file.
    event.stopPropagation();
    setDragging(false);
    if (starting) return;
    void handleFiles(event.dataTransfer.files);
  };

  const submit = async () => {
    if (!selection?.file || !selection.check.ok || starting) return;
    setAttempted(selection.file);
    await onIngest(selection.file, selection.check.text);
  };

  const check = selection?.check;
  const sameAttempt = !!selection?.file && attempted === selection.file;
  const startError = sameAttempt && !starting ? error : null;
  const startLimit = sameAttempt && !starting ? limitNotice : null;

  return (
    <section
      aria-labelledby="ingest-upload-heading"
      className="space-y-4"
      data-testid="ingest-upload"
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div>
        <h1
          id="ingest-upload-heading"
          className="text-2xl font-semibold tracking-tight"
        >
          Upload your topic
        </h1>
        <p className="text-muted-foreground mt-2 leading-relaxed">
          Upload the{" "}
          <strong className="text-foreground font-semibold">.json</strong> file
          your assistant made with the TopicCrafter skill, then select{" "}
          <strong className="text-foreground font-semibold whitespace-nowrap">
            Ingest topic
          </strong>
          . We&apos;ll check it and give you a preview link, or a short report
          to take back to your assistant.
        </p>
      </div>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept=".json,application/json"
        className="peer sr-only"
        aria-label="Choose your topic's .json file"
        aria-describedby={check ? undefined : hintId}
        onChange={(event) => void handleFiles(event.target.files)}
        disabled={starting}
        data-testid="ingest-file-input"
      />

      {!check ? (
        <label
          htmlFor={inputId}
          data-testid="ingest-drop-zone"
          data-dragging={dragging ? "true" : undefined}
          className={cn(
            "bg-muted peer-focus-visible:ring-ring/50 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl px-6 py-10 text-center shadow-xs transition-all peer-focus-visible:ring-[3px] sm:py-14",
            dropZoneClass(dragging),
          )}
        >
          {reading ? (
            <LoaderCircle
              className="text-muted-foreground size-9 animate-spin"
              aria-hidden="true"
            />
          ) : (
            <span className="bg-background flex size-12 items-center justify-center rounded-full border">
              <Upload
                className="size-6"
                aria-hidden="true"
              />
            </span>
          )}
          <span className="text-base font-semibold sm:text-lg">
            {reading
              ? "Reading your file…"
              : dragging
                ? "Drop your file here"
                : "Drag your .json file here"}
          </span>
          <span className="text-muted-foreground text-sm">or</span>
          <span
            className={cn(
              buttonVariants({ variant: "outline" }),
              "pointer-events-none",
            )}
          >
            Choose a file
          </span>
          <span
            id={hintId}
            className="text-muted-foreground mt-1 max-w-sm text-sm"
          >
            One .json file, up to 10 MB. Not the .md: that one is your own
            readable copy.
          </span>
        </label>
      ) : check.ok ? (
        <Card
          aria-labelledby="ingest-summary-heading"
          role="region"
          className={cn(
            "gap-0 px-5 py-5 transition-all sm:px-6",
            dragging && dropZoneClass(true),
          )}
          data-testid="ingest-file-summary"
        >
          <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Ready to ingest
          </p>
          <h2
            id="ingest-summary-heading"
            className="mt-2 text-xl font-semibold tracking-tight break-words"
          >
            {check.summary.topicName}
          </h2>
          <p className="mt-2">
            {plural(check.summary.questionSets, "question set")} and{" "}
            {plural(check.summary.questions, "question")}
            {describeDifficulty(check.summary.difficulty) ? (
              <span className="text-muted-foreground">
                {" "}
                ({describeDifficulty(check.summary.difficulty)})
              </span>
            ) : null}
          </p>
          {selection?.types.length ? (
            <ul
              aria-label="Question types"
              className="mt-3 flex flex-wrap gap-1.5"
              data-testid="ingest-question-types"
            >
              {selection.types.map((type) => (
                <li
                  key={type.type}
                  className="bg-muted rounded-md border px-2 py-0.5 text-xs"
                >
                  {type.label} · {plural(type.sets, "set")}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-muted-foreground mt-3 flex min-w-0 items-center gap-2 text-sm">
            <FileJson
              className="size-4 shrink-0"
              aria-hidden="true"
            />
            <span className="truncate">{selection?.file?.name}</span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">
              {selection?.file ? formatBytes(selection.file.size) : ""}
            </span>
          </p>

          {startError ? (
            <p
              role="alert"
              className="text-destructive mt-4 rounded-md border px-3 py-2 text-sm"
            >
              {startError}
            </p>
          ) : null}
          {startLimit ? (
            <p
              role="alert"
              className="mt-4 flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100"
              data-testid="ingest-limit-notice"
            >
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <span>
                <strong>{startLimit.title}:</strong> {startLimit.description}
              </span>
            </p>
          ) : null}

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                className="flex-1 sm:flex-none"
                onClick={() => void submit()}
                disabled={starting || reading}
              >
                {starting ? (
                  <LoaderCircle
                    className="animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
                {starting ? "Starting the ingestion…" : "Ingest topic"}
              </Button>
              <DailyBudget />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={chooseAnother}
              disabled={starting || reading}
            >
              Choose a different file
            </Button>
          </div>
        </Card>
      ) : (
        <Card
          role="alert"
          aria-labelledby="ingest-file-problem-heading"
          className={cn(
            "gap-0 px-5 py-5 transition-all sm:px-6",
            dragging && dropZoneClass(true),
          )}
          data-testid="ingest-file-problem"
        >
          <div className="flex gap-3">
            <CircleAlert
              className="text-destructive mt-0.5 size-5 shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <h2
                id="ingest-file-problem-heading"
                className="font-semibold"
              >
                We can&apos;t use this file
              </h2>
              <p className="mt-1">{check.message}</p>
              {selection?.file ? (
                <p className="text-muted-foreground mt-2 text-sm">
                  File: <span className="break-all">{selection.file.name}</span>
                </p>
              ) : null}
            </div>
          </div>
          <div className="mt-5">
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={chooseAnother}
              disabled={reading}
            >
              Choose a different file
            </Button>
          </div>
        </Card>
      )}
    </section>
  );
}
