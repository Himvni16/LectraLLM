import { respondToAnalysisRun } from "@/lib/analysis-pipeline/http";

export const runtime = "nodejs";
export const maxDuration = 300;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  return respondToAnalysisRun(id);
}
