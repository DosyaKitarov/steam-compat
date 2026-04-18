import axios from "axios";

export default async function handler(req: any, res: any) {
  const { identifier } = req.query;

  if (!identifier || typeof identifier !== "string") {
    return res.status(400).json({ error: "Missing identifier parameter" });
  }

  const STEAM_API_KEY = process.env.STEAM_API_KEY;

  if (!STEAM_API_KEY) {
    return res
      .status(500)
      .json({ error: "STEAM_API_KEY is not configured on the server." });
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
      console.log(`Resolving vanity URL: ${steamId}`);
      const resolveRes = await axios.get(
        "https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/",
        {
          params: {
            key: STEAM_API_KEY,
            vanityurl: steamId,
          },
        }
      );

      if (resolveRes.data.response.success === 1) {
        steamId = resolveRes.data.response.steamid;
        console.log(`Resolved ${identifier} to ${steamId}`);
      } else {
        console.log(`Failed to resolve vanity URL: ${steamId}`);
        return res.status(404).json({
          error:
            "Could not resolve Steam ID. Make sure the profile name or URL is correct.",
        });
      }
    }

    console.log(`Fetching games for SteamID: ${steamId}`);
    const response = await axios.get(
      "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/",
      {
        params: {
          key: STEAM_API_KEY,
          steamid: steamId,
          include_appinfo: true,
          format: "json",
        },
      }
    );

    const games = response.data.response.games || [];
    console.log(`Successfully fetched ${games.length} games for ${steamId}`);
    res.json({ games });
  } catch (error: any) {
    console.error("Error fetching owned games", error);
    res.status(500).json({
      error: `Failed to fetch games: ${error.message || "Steam error"}`,
    });
  }
}
