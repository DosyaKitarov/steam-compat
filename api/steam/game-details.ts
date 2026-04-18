import axios from "axios";
import { Redis } from "@upstash/redis";

// Initialize Redis for global game details cache
const redis = new Redis({
  url: process.env.KV_REST_API_URL || "",
  token: process.env.KV_REST_API_TOKEN || "",
});

// Cache prefix for game details
const CACHE_PREFIX = "game:";
const CACHE_TTL = 7 * 24 * 60 * 60; // 7 days

// Configuration
const CONCURRENT_BATCHES = 10; // Number of concurrent requests (10 games at once)
const BATCH_DELAY_MS = 100; // Delay between batch groups
const RATE_LIMIT_RETRY_MS = 5 * 60 * 1000; // 5 minutes
const REQUEST_TIMEOUT_MS = 15000;

let isRateLimited = false;
let rateLimitResetTime: number | null = null;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Redis cache helpers
async function getCachedGame(appId: number) {
  try {
    const key = `${CACHE_PREFIX}${appId}`;
    const cached = await redis.get(key);
    return cached as any;
  } catch (err) {
    console.warn(`Redis get error for ${appId}:`, err);
    return null;
  }
}

async function setCachedGame(appId: number, data: any) {
  try {
    const key = `${CACHE_PREFIX}${appId}`;
    await redis.setex(key, CACHE_TTL, JSON.stringify(data));
  } catch (err) {
    console.warn(`Redis set error for ${appId}:`, err);
  }
}

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
        rateLimitResetTime = Date.now() + RATE_LIMIT_RETRY_MS;
        console.error(
          `🚫 STEAM RATE LIMITED (429) on Game ${appId}! Next retry at ${new Date(rateLimitResetTime).toISOString()}`
        );
        throw {
          code: "RATE_LIMITED",
          retryAfter: RATE_LIMIT_RETRY_MS / 1000,
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

// Process multiple batches concurrently
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

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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

  // Check Redis cache first - BEFORE requesting anything
  for (const id of appIds) {
    const cached = await getCachedGame(id);
    if (cached) {
      try {
        results[id] = typeof cached === 'string' ? JSON.parse(cached) : cached;
        cacheHits.push(id);
      } catch (e) {
        missingIds.push(id);
      }
    } else {
      missingIds.push(id);
    }
  }

  if (cacheHits.length > 0) {
    console.log(`✓ CACHE: ${cacheHits.length} games from Redis cache`);
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

          await setCachedGame(id, cacheEntry);
          results[id] = cacheEntry;
        } else {
          // Cache null result to avoid re-fetching failed requests
          const nullEntry = { platforms: null, imageUrl: null };
          await setCachedGame(id, nullEntry);
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
}
