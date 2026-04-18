import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const STEAM_API_KEY = process.env.STEAM_API_KEY;

// Cache map: appId -> { platforms, imageUrl }
const gameDetailsCache = new Map<number, any>();

// Global error log buffer
const errorLogs: string[] = [];
function logError(msg: string, err?: any) {
  const timestamp = new Date().toISOString();
  const errorMsg = `${timestamp}: ${msg} ${err?.message || err || ""}`;
  errorLogs.push(errorMsg);
  if (errorLogs.length > 50) errorLogs.shift();
  console.error(errorMsg);
}

// Configuration for batch fetching
const CONCURRENT_BATCHES = 10; // Number of concurrent requests (10 games at once)
const BATCH_DELAY_MS = 100; // Delay between batch groups
const REQUEST_TIMEOUT_MS = 15000;

let isRateLimited = false;
let rateLimitResetTime: number | null = null;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const fetchGameBatch = async (appIds: number[]): Promise<Record<number, any>> => {
  if (appIds.length === 0) return {};

  // Check if we're rate limited
  if (isRateLimited && rateLimitResetTime && Date.now() < rateLimitResetTime) {
    const minutesLeft = Math.ceil((rateLimitResetTime - Date.now()) / 60000);
    console.warn(
      `⚠️ STEAM RATE LIMITED! Will retry in ${minutesLeft} minute(s). Time: ${new Date().toISOString()}`
    );
    throw {
      code: "RATE_LIMITED",
      retryAfter: Math.ceil((rateLimitResetTime - Date.now()) / 1000),
    };
  }

  const results: Record<number, any> = {};
  const promises = appIds.map(async (appId) => {
    const gameStartTime = Date.now();
    
    try {
      const response = await axios.get(
        `https://store.steampowered.com/api/appdetails`,
        {
          params: {
            appids: appId, // Single game
            filters: "platforms",
            cc: "US",
            l: "english",
          },
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
          timeout: REQUEST_TIMEOUT_MS,
        }
      );

      const gameEndTime = Date.now();
      const gameResponse = response.data[appId];
      
      if (gameResponse && gameResponse.success) {
        const platforms = gameResponse.data?.platforms || {};
        const gameInfo = gameResponse.data;
        const imageUrl = gameInfo?.header_image || null;
        const gameName = gameInfo?.name || "Unknown";
        const platformList = Object.keys(platforms).filter(p => platforms[p]).join(", ") || "None";
        
        console.log(`      ⏱️  Game ${appId}: ${gameEndTime - gameStartTime}ms - ✅ ${gameName} | Platforms: ${platformList}`);
        
        // Reset rate limit if successful
        isRateLimited = false;
        rateLimitResetTime = null;
        
        return { appId, data: { platforms, imageUrl } };
      } else {
        console.log(`      ⏱️  Game ${appId}: ${gameEndTime - gameStartTime}ms - ❌ API returned: success=${gameResponse?.success}`);
        return { appId, data: null };
      }
    } catch (error: any) {
      const gameEndTime = Date.now();

      // Handle 429 Too Many Requests
      if (error.response?.status === 429) {
        isRateLimited = true;
        rateLimitResetTime = Date.now() + 5 * 60 * 1000; // 5 minutes
        console.error(
          `🚫 STEAM RATE LIMITED (429) on Game ${appId}! Next retry at ${new Date(rateLimitResetTime).toISOString()}`
        );
        throw {
          code: "RATE_LIMITED",
          retryAfter: 300,
        };
      }

      console.log(`      ❌ Game ${appId}: ${gameEndTime - gameStartTime}ms - Error: ${error.message}`);
      return { appId, data: null };
    }
  });

  const batchResults = await Promise.all(promises);
  
  for (const result of batchResults) {
    if (result.data) {
      results[result.appId] = result.data;
    } else {
      results[result.appId] = null;
    }
  }

  return results;
};

const fetchDetailsUrl = async (appIds: number[]): Promise<Record<number, any>> => {
  if (appIds.length === 0) return {};

  const allResults: Record<number, any> = {};
  const mainStartTime = Date.now();

  console.log(`📦 Fetching ${appIds.length} games with ${CONCURRENT_BATCHES} concurrent requests`);

  // Process with concurrency limit - send CONCURRENT_BATCHES requests at a time
  for (let i = 0; i < appIds.length; i += CONCURRENT_BATCHES) {
    const batchStartIndex = i;
    const batchGroupStartTime = Date.now();
    const batch = appIds.slice(i, i + CONCURRENT_BATCHES);

    console.log(`  📥 Batch ${Math.floor(i / CONCURRENT_BATCHES) + 1}: Processing ${batch.length} games (${batchStartIndex + 1}-${Math.min(batchStartIndex + batch.length, appIds.length)} of ${appIds.length})`);

    try {
      const batchResults = await fetchGameBatch(batch);
      Object.assign(allResults, batchResults);
      
      const batchGroupEndTime = Date.now();
      console.log(`  ✅ Batch completed in ${batchGroupEndTime - batchGroupStartTime}ms`);
    } catch (error: any) {
      if (error.code === "RATE_LIMITED") {
        throw error; // Propagate rate limit error
      }
    }

    // Delay between batches to avoid overwhelming Steam
    if (i + CONCURRENT_BATCHES < appIds.length) {
      console.log(`  ⏸️  Waiting ${BATCH_DELAY_MS}ms before next batch...`);
      await sleep(BATCH_DELAY_MS);
    }
  }

  const mainEndTime = Date.now();
  console.log(`📊 Total API fetch time: ${mainEndTime - mainStartTime}ms`);

  return allResults;
};

app.use(express.json());

// Debug: Get Server Logs
app.get("/api/debug/logs", (req, res) => {
  res.json({ logs: errorLogs, cacheSize: gameDetailsCache.size });
});

// API: Get Owned Games
app.get("/api/steam/owned-games", async (req, res) => {
  let { identifier } = req.query as { identifier: string };

  if (!identifier) {
    return res.status(400).json({ error: "Missing identifier parameter" });
  }

  if (!STEAM_API_KEY) {
    logError("STEAM_API_KEY is missing");
    return res.status(500).json({ error: "STEAM_API_KEY is not configured on the server." });
  }

  try {
    let steamId = identifier.trim();

    // 1. Handle full URLs
    if (steamId.includes("steamcommunity.com")) {
      const idMatch = steamId.match(/\/id\/([^\/]+)/);
      const profileMatch = steamId.match(/\/profiles\/([0-9]+)/);
      
      if (profileMatch) {
        steamId = profileMatch[1];
      } else if (idMatch) {
        steamId = idMatch[1];
      }
    }

    // 2. Resolve Vanity URL if not a pure SteamID64
    const isSteamId64 = /^[0-9]{17}$/.test(steamId);

    if (!isSteamId64) {
      logError(`Resolving vanity URL: ${steamId}`);
      const resolveRes = await axios.get("https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/", {
        params: {
          key: STEAM_API_KEY,
          vanityurl: steamId,
        },
      });

      if (resolveRes.data.response.success === 1) {
        steamId = resolveRes.data.response.steamid;
        logError(`Resolved ${identifier} to ${steamId}`);
      } else {
        logError(`Failed to resolve vanity URL: ${steamId}`);
        return res.status(404).json({ error: "Could not resolve Steam ID. Make sure the profile name or URL is correct." });
      }
    }

    logError(`Fetching games for SteamID: ${steamId}`);
    const response = await axios.get("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/", {
      params: {
        key: STEAM_API_KEY,
        steamid: steamId,
        include_appinfo: true,
        format: "json",
      },
    });

    const games = response.data.response.games || [];
    logError(`Successfully fetched ${games.length} games for ${steamId}`);
    res.json({ games });
  } catch (error: any) {
    logError("Error fetching owned games", error);
    res.status(500).json({ error: `Failed to fetch games: ${error.message || "Steam error"}` });
  }
});

// API: Get Game Details (Platform Info)
app.post("/api/steam/game-details", async (req, res) => {
  const { appIds } = req.body;

  if (!Array.isArray(appIds)) {
    return res.status(400).json({ error: "appIds must be an array." });
  }

  const startTime = Date.now();
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ 🎮 STARTED: Fetching ${appIds.length} games`);
  console.log(`╚═══════════════════════════════════════════════════════════╝`);

  const results: Record<number, any> = {};
  const missingIds: number[] = [];
  const cacheHits: number[] = [];

  // Check cache first - BEFORE requesting anything
  for (const id of appIds) {
    if (gameDetailsCache.has(id)) {
      const cached = gameDetailsCache.get(id);
      results[id] = cached;
      cacheHits.push(id);
    } else {
      missingIds.push(id);
    }
  }

  if (cacheHits.length > 0) {
    console.log(`✓ CACHE: ${cacheHits.length} games from cache`);
  }

  if (missingIds.length > 0) {
    console.log(`⬇️  FETCH: ${missingIds.length} games from Steam API`);
  }

  // Fetch all missing IDs in parallel batches
  if (missingIds.length > 0) {
    try {
      const fetchStartTime = Date.now();
      const data = await fetchDetailsUrl(missingIds);
      const fetchEndTime = Date.now();
      console.log(`⏱️  API TIME: ${fetchEndTime - fetchStartTime}ms\n`);

      for (const id of missingIds) {
        const gameData = data[id];

        if (gameData && gameData.platforms !== undefined) {
          const cacheEntry = {
            platforms: gameData.platforms,
            imageUrl: gameData.imageUrl,
          };

          gameDetailsCache.set(id, cacheEntry);
          results[id] = cacheEntry;
        } else {
          // Cache null result to avoid re-fetching failed requests
          const nullEntry = { platforms: null, imageUrl: null };
          gameDetailsCache.set(id, nullEntry);
          results[id] = nullEntry;
        }
      }
    } catch (error: any) {
      if (error.code === "RATE_LIMITED") {
        console.error(`🚫 Steam rate limited! Retry after ${error.retryAfter} seconds`);
        return res.status(429).json({
          error: "Steam API rate limited. Please retry in 5 minutes.",
          retryAfter: error.retryAfter,
          timestamp: new Date().toISOString(),
        });
      }

      console.error("Error fetching game details:", error.message);
      return res.status(500).json({ error: "Failed to fetch game details" });
    }
  }

  const totalTime = Date.now() - startTime;
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ ✅ COMPLETED: ${totalTime}ms total (${(totalTime / appIds.length).toFixed(1)}ms/game)`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);

  res.json({ details: results });
});

async function startServer() {
  // Always use Vite in development
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
