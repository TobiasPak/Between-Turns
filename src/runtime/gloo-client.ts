import type { BetweenTurnsConfig } from "../types/config.js";

const GLOO_TOKEN_URL = "https://platform.ai.gloo.com/oauth2/token";
const GLOO_CHAT_COMPLETIONS_URL = "https://platform.ai.gloo.com/ai/v2/chat/completions";
const GLOO_SEARCH_URL = "https://platform.ai.gloo.com/ai/data/v1/search";

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

export async function getGlooAccessToken(config: BetweenTurnsConfig): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt - 60_000 > now) {
    return tokenCache.accessToken;
  }

  const clientId = process.env[config.gloo.client_id_env];
  const clientSecret = process.env[config.gloo.client_secret_env];
  if (!clientId || !clientSecret) {
    throw new Error(`Missing Gloo credentials: set ${config.gloo.client_id_env} and ${config.gloo.client_secret_env}`);
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(GLOO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: "grant_type=client_credentials&scope=api/access",
  });

  if (!res.ok) {
    throw new Error(`Gloo token exchange failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { accessToken: json.access_token, expiresAt: now + json.expires_in * 1000 };
  return tokenCache.accessToken;
}

export interface ForcedToolResult<T> {
  parsed: T;
  raw: unknown;
}

/**
 * Calls Gloo's /ai/v2/chat/completions with a single tool forced via
 * tool_choice and strict:true. Confirmed (Day 1 live test) that this
 * genuinely enforces the declared JSON schema server-side, including enum
 * constraints, even under an adversarial prompt trying to break out of it.
 *
 * Per OpenAI-compatible strict mode: every object level in parametersSchema
 * must set `additionalProperties: false` explicitly, or the request 400s.
 */
export async function chatCompletionsForcedTool<T>(
  config: BetweenTurnsConfig,
  params: {
    model: string;
    messages: { role: "system" | "user" | "assistant"; content: string }[];
    toolName: string;
    toolDescription: string;
    parametersSchema: Record<string, unknown>;
    temperature?: number;
    maxTokens?: number;
  }
): Promise<ForcedToolResult<T>> {
  const token = await getGlooAccessToken(config);

  const res = await fetch(GLOO_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      tools: [
        {
          type: "function",
          function: {
            name: params.toolName,
            description: params.toolDescription,
            parameters: params.parametersSchema,
            strict: true,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: params.toolName } },
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 500,
    }),
  });

  if (!res.ok) {
    throw new Error(`Gloo chat/completions failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { tool_calls?: { function: { name: string; arguments: string } }[] } }[];
  };
  const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) {
    throw new Error(`Gloo response missing expected tool_call: ${JSON.stringify(json)}`);
  }

  const parsed = JSON.parse(toolCall.function.arguments) as T;
  return { parsed, raw: json };
}

export interface GlooSearchResult {
  data: {
    uuid: string;
    metadata: { certainty: number; distance: number };
    properties: Record<string, unknown>;
    collection: string;
  }[];
  intent: number;
}

export async function glooSearch(
  config: BetweenTurnsConfig,
  params: { query: string; limit?: number; certainty?: number }
): Promise<GlooSearchResult> {
  const token = await getGlooAccessToken(config);

  const res = await fetch(GLOO_SEARCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: params.query,
      collection: config.gloo.collection,
      tenant: config.gloo.tenant,
      certainty: params.certainty ?? 0.5,
      limit: params.limit ?? 10,
    }),
  });

  if (!res.ok) {
    throw new Error(`Gloo search failed: ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as GlooSearchResult;
}
