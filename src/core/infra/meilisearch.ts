import { MeiliSearch } from "meilisearch";

const globalForMs = globalThis as unknown as { meilisearch: MeiliSearch | undefined };

export const meilisearch =
  globalForMs.meilisearch ??
  new MeiliSearch({
    host:   process.env.MEILISEARCH_URL ?? "http://localhost:7700",
    apiKey: process.env.MEILISEARCH_KEY,
  });

if (process.env.NODE_ENV !== "production") globalForMs.meilisearch = meilisearch;
