import type { BetweenTurnsConfig } from "../types/config.js";
import { getGlooAccessToken } from "../runtime/gloo-client.js";

const GLOO_INGESTION_URL = "https://platform.ai.gloo.com/ingestion/v2/files";

export interface IngestResult {
  success: boolean;
  ingesting: string[];
  duplicates: string[];
}

/**
 * Uploads one small text item to Gloo, attributed to our publisher.
 * Per Day-1 findings, producer_id is one-to-one only -- one file per
 * request. filename is what shows up as `properties.filename` on later
 * Search results, so it's used as the join key back to our osis_ref.
 */
export async function ingestTextItem(
  config: BetweenTurnsConfig,
  params: { filename: string; content: string; producerId: string }
): Promise<IngestResult> {
  const token = await getGlooAccessToken(config);

  const form = new FormData();
  form.append("publisher_id", config.gloo.publisher_id);
  form.append("producer_id", params.producerId);
  form.append("files", new Blob([params.content], { type: "text/plain" }), params.filename);

  const res = await fetch(GLOO_INGESTION_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Gloo ingestion failed for ${params.filename}: ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as IngestResult;
}
