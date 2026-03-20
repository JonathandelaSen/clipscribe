import { CreatorAIError } from "./errors";

type LooseRecord = Record<string, unknown>;

function isRecord(value: unknown): value is LooseRecord {
  return !!value && typeof value === "object";
}

function extractAssistantText(payload: unknown): string | null {
  if (!isRecord(payload)) return null;

  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!isRecord(first)) return null;
  const message = first.message;
  if (!isRecord(message)) return null;
  const content = message.content;

  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textParts = content
      .map((part) => {
        if (!isRecord(part)) return "";
        if (part.type !== "text") return "";
        return typeof part.text === "string" ? part.text : "";
      })
      .filter(Boolean);

    return textParts.length ? textParts.join("\n") : null;
  }

  return null;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toOpenAIErrorMessage(status: number, providerMessage: string): string {
  try {
    const parsed = JSON.parse(providerMessage);
    if (parsed?.error?.message) {
      return `OpenAI API Error: ${parsed.error.message}`;
    }
  } catch {}

  if (status === 401) return "OpenAI authentication failed. Check the API key saved in this browser.";
  if (status === 429) return "OpenAI rejected the request because of quota or rate limits.";
  if (status >= 500) return "OpenAI is temporarily unavailable. Please retry in a moment.";
  return providerMessage || `OpenAI request failed (${status}).`;
}

export async function requestOpenAIJson(input: {
  apiKey: string;
  model: string;
  temperature: number;
  messages: Array<{ role: "system" | "user"; content: string }>;
}): Promise<unknown> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      temperature: input.temperature,
      response_format: { type: "json_object" },
      messages: input.messages,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const providerMessage = (await response.text()).slice(0, 400);
    throw new CreatorAIError(toOpenAIErrorMessage(response.status, providerMessage), {
      status: response.status >= 500 ? 502 : response.status,
      code:
        response.status === 401
          ? "openai_auth_error"
          : response.status === 429
            ? "openai_rate_limited"
            : "openai_request_failed",
    });
  }

  const payload = (await response.json()) as unknown;
  const assistantText = extractAssistantText(payload);
  if (!assistantText) {
    throw new CreatorAIError("OpenAI response did not contain assistant content.", {
      status: 502,
      code: "invalid_openai_response",
    });
  }

  const parsed = safeJsonParse(assistantText);
  if (!parsed) {
    throw new CreatorAIError("OpenAI returned malformed JSON.", {
      status: 502,
      code: "invalid_openai_response",
    });
  }

  return parsed;
}
