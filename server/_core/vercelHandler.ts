/**
 * Vercel Serverless Function entrypoint replacing the legacy Manus proxy backend.
 * Bundled into api/index.mjs via esbuild during buildCommand so @shared/* aliases resolve cleanly.
 */
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { getDailyCollectionSources, receiveDailyCollection } from "../dailyCollection";
import { runAiMetadataCompletion } from "../aiMetadataCompletion";
import { getVideoCount } from "../db";

const app = express();

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.get("/api/health", async (_req, res) => {
  try {
    const hasDb = Boolean(process.env.DATABASE_URL);
    const videoCount = hasDb ? await getVideoCount() : 0;
    res.json({ ok: true, runtime: "vercel-serverless", hasDb, videoCount });
  } catch (error) {
    res.status(500).json({
      ok: false,
      runtime: "vercel-serverless",
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

registerOAuthRoutes(app);
app.get("/api/scheduled/daily-video-collection/sources", getDailyCollectionSources);
app.post("/api/scheduled/daily-video-collection", receiveDailyCollection);
app.post("/api/scheduled/ai-metadata-completion", runAiMetadataCompletion);

app.use(
  "/api/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
  }),
);

export default app;
