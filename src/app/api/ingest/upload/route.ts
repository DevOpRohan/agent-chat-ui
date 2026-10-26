/**
 * Ingester mode's upload: a TopicCrafter topic .json (10 MB at most) is saved in the app's GCS
 * bucket as `topic-ingest/<uuid>.json`, and its https link is returned for the `topic_ingest`
 * run. The file is stored in the bucket only; see handler.ts for the checks and responses.
 */
import { handleIngestUpload } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function POST(request: Request) {
  return handleIngestUpload(request);
}
