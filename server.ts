import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import pThrottle from "p-throttle";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const STEAM_API_KEY = process.env.STEAM_API_KEY;

// Cache map: appId -> { windows: boolean, mac: boolean, linux: boolean }
const gameDetailsCache = new Map<number, any>();

// Steam Store API is very sensitive. 
// We throttle batch requests. 1 request every 1.5 seconds should be safe.
const throttle = pThrottle({
  limit: 1,
  interval: 1500,
});

// Global error log buffer
const errorLogs: string[] = [];
function logError(msg: string, err?: any) {
  const timestamp = new Date().toISOString();
  const errorMsg = `${timestamp}: ${msg} ${err?.message || err || ""}`;
  errorLogs.push(errorMsg);
  if (errorLogs.length > 50) errorLogs.shift();
  console.error(errorMsg);
}

const throttledFetchDetails = throttle(async (appId: number) => {
  try {
    const response = await axios.get(`https://store.steampowered.com/api/appdetails`, {
      params: {
        appids: appId,
        filters: "platforms",
        cc: "US", // Use US country code for better availability
        l: "english",
      },
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      timeout: 10000,
    });
    return response.data;
  } catch (error: any) {
    logError(`Error fetching details for app ${appId}`, error);
    return null;
  }
});

app.use(express.json());

// Debug: Get Server Logs
app.get("/api/debug/logs", (req, res) => {
  res.json({ logs: errorLogs, cacheSize: gameDetailsCache.size });
});

// API: Get Owned Games
app.get("/api/steam/owned-games/:identifier", async (req, res) => {
  let { identifier } = req.params;

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
  const { appIds } = req.body; // Array of numbers

  if (!Array.isArray(appIds)) {
    return res.status(400).json({ error: "appIds must be an array." });
  }

  const results: Record<number, any> = {};
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
    // Process one by one with throttling to avoid 400 Bad Request
    for (const id of missingIds) {
      const data = await throttledFetchDetails(id);
      
      if (data && data[id]) {
        if (data[id].success && data[id].data.platforms) {
          const platforms = data[id].data.platforms;
          gameDetailsCache.set(id, platforms);
          results[id] = platforms;
        } else {
          // Cache failed results as null to prevent re-fetching broken IDs
          gameDetailsCache.set(id, null);
          results[id] = null;
        }
      } else {
        // If query failed completely (e.g. timeout or actual 400), return null but don't cache forever
        // so we can try again on next session if it was a transient error.
        results[id] = null;
      }
    }
  }

  res.json({ details: results });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
