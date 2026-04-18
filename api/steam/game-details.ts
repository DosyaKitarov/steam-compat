import axios from "axios";
import pThrottle from "p-throttle";

// Store cache in memory for the serverless function's lifetime
const gameDetailsCache = new Map<number, any>();

// Steam Store API throttling: 1 request every 1.5 seconds
const throttle = pThrottle({
  limit: 1,
  interval: 1500,
});

const throttledFetchDetails = throttle(async (appId: number) => {
  try {
    const response = await axios.get(
      `https://store.steampowered.com/api/appdetails`,
      {
        params: {
          appids: appId,
          filters: "platforms",
          cc: "US",
          l: "english",
        },
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        timeout: 10000,
      }
    );
    return response.data;
  } catch (error: any) {
    console.error(`Error fetching details for app ${appId}`, error.message);
    return null;
  }
});

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { appIds } = req.body;

  if (!Array.isArray(appIds)) {
    return res.status(400).json({ error: "appIds must be an array." });
  }

  const results: Record<number, any> = {};
  const _missingIds: number[] = [];
  const missingIds: number[] = [];

  // Check cache first
  for (const id of appIds) {
    if (gameDetailsCache.has(id)) {
      results[id] = gameDetailsCache.get(id);
    } else {
      missingIds.push(id);
    }
  }

  if (missingIds.length > 0) {
    // Process one by one with throttling
    for (const id of missingIds) {
      const data = await throttledFetchDetails(id);

      if (data && data[id]) {
        if (data[id].success && data[id].data.platforms) {
          const platforms = data[id].data.platforms;
          gameDetailsCache.set(id, platforms);
          results[id] = platforms;
        } else {
          gameDetailsCache.set(id, null);
          results[id] = null;
        }
      } else {
        results[id] = null;
      }
    }
  }

  res.json({ details: results });
}
