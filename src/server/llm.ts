/** Minimal client for any OpenAI-compatible chat completions endpoint. Server-only: the key never reaches the browser. */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmClient {
  complete(messages: ChatMessage[]): Promise<string>;
}

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  jsonMode: boolean;
  maxTokens: number;
  timeoutMs: number;
  maxTurns: number;
}

type Env = Record<string, string | undefined>;

/** Null when no key is set: the app then runs in demo mode. */
export function llmConfig(env: Env = process.env): LlmConfig | null {
  const apiKey = env.LLM_API_KEY?.trim();
  if (!apiKey) return null;
  const maxTokens = Number(env.LLM_MAX_TOKENS);
  const timeoutMs = Number(env.LLM_TIMEOUT_MS);
  const maxTurns = Number(env.LLM_MAX_TURNS);
  return {
    apiKey,
    baseUrl: (env.LLM_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, ""),
    model: env.LLM_MODEL?.trim() || "gpt-4o-mini",
    jsonMode: env.LLM_JSON_MODE?.trim().toLowerCase() !== "false",
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? Math.min(maxTokens, 4000) : 700,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 1000 ? Math.min(timeoutMs, 120_000) : 45_000,
    maxTurns: Number.isFinite(maxTurns) && maxTurns >= 3 ? Math.min(Math.floor(maxTurns), 16) : 8,
  };
}

export class LlmError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "LlmError";
  }
}

export function createLlmClient(config: LlmConfig, fetchImpl: typeof fetch = fetch): LlmClient {
  async function call(messages: ChatMessage[], json: boolean): Promise<string> {
    const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.4,
        max_tokens: config.maxTokens,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!response.ok) {
      // Never echo the provider body: it can contain request details. Status is enough to debug.
      throw new LlmError(response.status, `model request failed with status ${response.status}`);
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new LlmError(502, "model returned no text");
    return content;
  }

  return {
    async complete(messages) {
      try {
        return await call(messages, config.jsonMode);
      } catch (error) {
        // Some providers reject response_format. Retry once as plain text; the caller parses JSON itself.
        if (config.jsonMode && error instanceof LlmError && error.status === 400) return call(messages, false);
        throw error;
      }
    },
  };
}
