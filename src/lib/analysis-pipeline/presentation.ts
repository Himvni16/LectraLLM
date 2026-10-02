export const ANALYSIS_STATUS_LABELS: Readonly<Record<string, string>> = {
  UPLOADED: "Preparing analysis",
  TRANSCRIBING: "Transcribing lecture",
  EXTRACTING_PDF: "Reading PDF",
  EXTRACTING_TOPICS: "Extracting topics",
  COMPARING: "Comparing lecture and PDF",
  COMPLETED: "Analysis complete",
  FAILED: "Analysis failed",
};

export function getAnalysisStatusLabel(status: string): string {
  return ANALYSIS_STATUS_LABELS[status] ?? "Analyzing your lecture";
}

export function isTerminalAnalysisStatus(status: string): boolean {
  return status === "COMPLETED" || status === "FAILED";
}

export function shouldPollAnalysis(status: string): boolean {
  return !isTerminalAnalysisStatus(status);
}
