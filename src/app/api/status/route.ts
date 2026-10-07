import { getModel, hasApiKey } from "@/lib/server/claude";
import { isMockEnabled } from "@/lib/server/mock";

export const dynamic = "force-dynamic";

/** GET /api/status — lets the UI explain up front whether the AI analyst is available. */
export function GET() {
  const mock = isMockEnabled();
  return Response.json({
    ai: mock ? "mock" : hasApiKey() ? "ready" : "missing_api_key",
    model: mock ? "scripted demo" : getModel(),
  });
}
