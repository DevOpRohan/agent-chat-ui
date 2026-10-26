import { Download, ExternalLink } from "lucide-react";

import { Card } from "@/components/ui/card";
import { SKILL_LINK, type SkillLink } from "@/lib/ingest/skill-link";

const STEPS = [
  "Add the TopicCrafter skill to your ChatGPT or Claude.",
  "Ask it for a topic and approve its plan.",
  "Upload the .json it gives you here.",
];

const INGEST_STEPS = [
  {
    title: "We check every question",
    body: "The same checks your assistant runs, plus one more on how maths is written.",
  },
  {
    title: "If needed, we fix small formatting issues",
    body: "Things like maths formatting or punctuation. We never change the meaning or the answers.",
  },
  {
    title: "You get a preview link",
    body: "Or, if something needs your attention, a report to take back to your assistant.",
  },
];

const LINK_CLASS =
  "inline-flex items-center gap-1.5 text-sm font-medium rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function SkillAnchor({ skill }: { skill: SkillLink }) {
  if (skill.kind === "external")
    return (
      <a
        href={skill.href}
        target="_blank"
        rel="noopener noreferrer"
        className={`${LINK_CLASS} underline underline-offset-4`}
      >
        Get the TopicCrafter skill
        <ExternalLink
          className="size-3.5"
          aria-hidden="true"
        />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  return (
    <a
      href={skill.href}
      download
      className={`${LINK_CLASS} flex-wrap`}
      data-testid="ingest-skill-download"
    >
      <Download
        className="size-3.5"
        aria-hidden="true"
      />
      <span className="underline underline-offset-4">
        Download the TopicCrafter skill
      </span>
      <span className="text-muted-foreground font-normal whitespace-nowrap">
        (v{skill.version}, .zip)
      </span>
    </a>
  );
}

/** "New here?": the three steps from an idea to an upload, with the TopicCrafter skill. */
export function OnboardingPanel({ skill = SKILL_LINK }: { skill?: SkillLink }) {
  return (
    <Card
      aria-labelledby="ingest-onboarding-heading"
      className="gap-0 px-5 py-5 shadow-none sm:px-6"
      data-testid="ingest-onboarding"
      role="region"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <h2
          id="ingest-onboarding-heading"
          className="font-semibold"
        >
          New here?
        </h2>
        <SkillAnchor skill={skill} />
      </div>
      <ol className="mt-4 grid gap-3 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li
            key={step}
            className="flex gap-3"
          >
            <span
              className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <span className="text-sm leading-relaxed">{step}</span>
          </li>
        ))}
      </ol>
      {skill.kind === "download" ? (
        <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
          To add it: in Claude, go to Settings → Capabilities → Skills and
          upload the .zip. In ChatGPT, upload it as a skill or attach it to your
          chat. Turn on code execution in both.
        </p>
      ) : null}
    </Card>
  );
}

/** "What happens when you ingest": the three things the platform does with the file. */
export function IngestStepsPanel() {
  return (
    <section
      aria-labelledby="ingest-next-heading"
      data-testid="ingest-what-happens"
    >
      <h2
        id="ingest-next-heading"
        className="text-sm font-semibold"
      >
        What happens when you ingest
      </h2>
      <ol className="mt-3 grid gap-3 sm:grid-cols-3">
        {INGEST_STEPS.map((step, index) => (
          <li
            key={step.title}
            className="bg-card rounded-xl border p-4"
          >
            <span
              className="text-muted-foreground text-xs font-semibold"
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <p className="mt-1 text-sm font-semibold">{step.title}</p>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
