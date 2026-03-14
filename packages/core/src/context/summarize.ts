// context/summarize.ts
// Shared utility — sends a summarization prompt to LLM and collects streamed text

import type { LLMAdapter } from "../llm/types.js";

export interface SummarizeRequest {
  readonly llm: LLMAdapter;
  readonly model: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly temperature: number;
  readonly maxTokens: number;
}

/** Stream an LLM summarization request and return the collected text */
export async function streamSummary(req: SummarizeRequest): Promise<string> {
  const stream = await req.llm.stream({
    model: req.model,
    systemPrompt: req.systemPrompt,
    messages: [{ role: "user", content: req.userPrompt }],
    temperature: req.temperature,
    maxTokens: req.maxTokens,
  });

  let text = "";
  for await (const event of stream) {
    if (event.type === "text-delta") {
      text += event.text;
    }
  }

  return text;
}
