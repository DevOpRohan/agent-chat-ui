/**
 * Same-origin download of an ingest's topic `.json` or `.md`. It fetches only allow-listed
 * storage links (see guards.ts) and returns them as an attachment; see handler.ts.
 */
import { handleTopicFile } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleTopicFile(request);
}
