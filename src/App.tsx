import React, { useState, useEffect, useMemo } from "react";
import { 
  Search, 
  Monitor, 
  Apple, 
  Cpu, 
  ChevronLeft, 
  ChevronRight, 
  Filter, 
  Gamepad2, 
  ExternalLink,
  Loader2,
  Trash2,
  HelpCircle,
  Info
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface Game {
  appid: number;
  name: string;
  playtime_forever: number;
  img_icon_url?: string;
}

interface Platforms {
  windows: boolean;
  mac: boolean;
  linux: boolean;
}

const GAMES_PER_PAGE = 15;

export default function App() {
  const [steamId, setSteamId] = useState("");
  const [ownedGames, setOwnedGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [platformsCache, setPlatformsCache] = useState<Record<number, Platforms>>({});
  const [rateLimitError, setRateLimitError] = useState<{message: string; retryTime: string} | null>(null);
  
  // Filters
  const [filters, setFilters] = useState({
    mac: false,
    linux: false,
    windows: false,
  });

  // Load state from local storage
  useEffect(() => {
    const savedId = localStorage.getItem("steam_id");
    if (savedId) setSteamId(savedId);
  }, []);

  const fetchGames = async () => {
    if (!steamId) return;
    setLoading(true);
    setError(null);
    setOwnedGames([]);
    setCurrentPage(1);
    // DON'T clear platformsCache - it's shared across all users (server-side cached)
    setSearchQuery(""); // Clear search when loading new profile
    setFilters({ windows: true, mac: true, linux: true }); // Reset filters
    
    try {
      localStorage.setItem("steam_id", steamId);
      const response = await fetch(`/api/steam/owned-games?identifier=${encodeURIComponent(steamId)}`);
      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      const games = data.games || [];
      setOwnedGames(games);
      setLoading(false); // Show games immediately!

      // Fetch ALL game details in BACKGROUND (don't wait for it)
      if (games.length > 0) {
        const appIds = games.map((g: Game) => g.appid);
        fetch("/api/steam/game-details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appIds }),
        })
          .then(res => {
            if (res.status === 429) {
              return res.json().then(data => {
                const retryTime = new Date(Date.now() + (data.retryAfter * 1000)).toLocaleTimeString();
                setRateLimitError({
                  message: data.error || "Steam API rate limited",
                  retryTime,
                });
                throw new Error("Rate limited");
              });
            }
            return res.json();
          })
          .then(detailsData => {
            setRateLimitError(null);
            // Extract platforms from { platforms, imageUrl, refused } structure
            const platformsOnly = Object.entries(detailsData.details || {}).reduce((acc, [key, value]: [string, any]) => {
              if (!value) {
                acc[parseInt(key)] = null;
              } else if (value.refused) {
                // Mark as refused explicitly
                acc[parseInt(key)] = { windows: false, mac: false, linux: false, refused: true };
              } else if (value.platforms) {
                acc[parseInt(key)] = value.platforms;
              } else {
                acc[parseInt(key)] = null;
              }
              return acc;
            }, {} as Record<number, any>);
            setPlatformsCache(platformsOnly);
          })
          .catch(err => {
            if (err.message !== "Rate limited") {
              console.error("Failed to fetch game details", err);
            }
          });
      }
    } catch (err: any) {
      setError(err.message || "Failed to fetch games");
      setLoading(false);
    }
  };

  const filteredGames = useMemo(() => {
    return ownedGames.filter((game) => {
      const matchesSearch = game.name.toLowerCase().includes(searchQuery.toLowerCase());
      const platforms = platformsCache[game.appid];
      const isLoading = !platformsCache.hasOwnProperty(game.appid);
      
      // If we don't have the platform data yet, we don't filter it out
      if (isLoading) return matchesSearch;

      // If Steam refused to give data, always show it (don't filter by platform)
      if (platforms && (platforms as any).refused) return matchesSearch;

      // If we have no platform data (null), only filter by search
      if (!platforms) return matchesSearch;

      const matchesMac = !filters.mac || (platforms && platforms.mac);
      const matchesLinux = !filters.linux || (platforms && platforms.linux);
      const matchesWindows = !filters.windows || (platforms && platforms.windows);
      
      return matchesSearch && matchesMac && matchesLinux && matchesWindows;
    });
  }, [ownedGames, searchQuery, filters, platformsCache]);

  const totalPages = Math.ceil(filteredGames.length / GAMES_PER_PAGE);
  const currentViewGames = filteredGames.slice(
    (currentPage - 1) * GAMES_PER_PAGE,
    currentPage * GAMES_PER_PAGE
  );

  const clearSession = () => {
    setSteamId("");
    setOwnedGames([]);
    setPlatformsCache({});
    localStorage.removeItem("steam_id");
  };

  return (
    <div className="min-h-screen bg-[#0b0c10] text-[#c5c6c7] font-sans selection:bg-[#66fcf1] selection:text-[#0b0c10]">
      {/* Rate Limit Alert */}
      {rateLimitError && (
        <div className="fixed bottom-4 right-4 z-50 animate-in fade-in slide-in-from-bottom-2">
          <div className="bg-red-900/90 backdrop-blur-md border border-red-500/50 rounded-lg p-4 max-w-sm shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="text-red-400 text-xl mt-0.5">⚠️</div>
              <div className="flex-1">
                <h3 className="font-bold text-red-200 mb-1">Steam API Rate Limited!</h3>
                <p className="text-red-100 text-sm mb-2">{rateLimitError.message}</p>
                <p className="text-red-300 text-xs font-mono">🕐 Retry at: {rateLimitError.retryTime}</p>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Navigation / Header */}
      <header className="border-b border-[#1f2833] bg-[#0b0c10]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#66fcf1] rounded flex items-center justify-center">
              <Gamepad2 className="w-5 h-5 text-[#0b0c10]" />
            </div>
            <h1 className="font-bold text-xl tracking-tight text-[#f5f5f5] hidden sm:block">
              Steam Compat
            </h1>
          </div>

          <div className="flex-1 max-w-md mx-4">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#45a29e] transition-colors group-focus-within:text-[#66fcf1]" />
              <input
                type="text"
                placeholder="Search your library..."
                className="w-full bg-[#1f2833] border-none rounded-full py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-[#66fcf1] transition-all outline-none text-[#f5f5f5]"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            {ownedGames.length > 0 && (
              <button 
                onClick={() => {
                  setSteamId("");
                  clearSession();
                }}
                className="px-4 py-2 hover:bg-[#1f2833] rounded-full transition-colors text-[#45a29e] hover:text-[#66fcf1] text-sm font-medium border border-[#45a29e]/30 hover:border-[#66fcf1]"
                title="Switch profile"
              >
                Switch Profile
              </button>
            )}
            <button 
              onClick={clearSession}
              className="p-2 hover:bg-[#1f2833] rounded-full transition-colors text-[#45a29e] hover:text-[#66fcf1]"
              title="Clear session"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Connection Tool */}
        {!ownedGames.length && !loading && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center min-h-[60vh] text-center"
          >
            <div className="bg-[#1f2833] p-8 rounded-3xl border border-[#45a29e]/20 max-w-lg w-full">
              <div className="mb-6 inline-flex p-4 bg-[#66fcf1]/10 rounded-2xl">
                <Cpu className="w-12 h-12 text-[#66fcf1]" />
              </div>
              <h2 className="text-3xl font-bold text-[#f5f5f5] mb-2">Connect your Library</h2>
              <p className="text-[#45a29e] mb-8">Enter your Steam Custom URL, Profile Link, or ID to explore compatibility.</p>
              
              <div className="space-y-4">
                <input
                  type="text"
                  placeholder="e.g. kitarov, 76561198..., or full link"
                  className="w-full bg-[#0b0c10] border border-[#45a29e]/30 rounded-xl py-4 px-6 text-lg focus:ring-2 focus:ring-[#66fcf1] transition-all outline-none text-[#f5f5f5] placeholder:text-[#45a29e]/50"
                  value={steamId}
                  onChange={(e) => setSteamId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && fetchGames()}
                />
                <button
                  onClick={fetchGames}
                  className="w-full bg-[#66fcf1] hover:bg-[#45a29e] text-[#0b0c10] font-bold py-4 rounded-xl transition-all shadow-[0_0_20px_rgba(102,252,241,0.2)]"
                >
                  Retrieve Library
                </button>
                
                <div className="flex items-center justify-center gap-4 text-xs text-[#45a29e]">
                  <a href="https://steamid.io/" target="_blank" className="hover:text-[#66fcf1] flex items-center gap-1">
                    <HelpCircle className="w-3 h-3" /> Find your Steam ID
                  </a>
                  <span className="opacity-30">|</span>
                  <div className="flex items-center gap-1 cursor-help group relative">
                    <Info className="w-3 h-3" /> 
                    <span>Privacy Notice</span>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-2 bg-[#1f2833] rounded text-white invisible group-hover:visible w-48 text-center shadow-xl border border-[#45a29e]/30">
                      We only fetch public library data. Your ID is saved locally.
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {error && (
              <motion.p 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-4 text-[#ff4444] text-sm"
              >
                {error}
              </motion.p>
            )}
          </motion.div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex flex-col items-center justify-center min-h-[60vh]">
            <Loader2 className="w-12 h-12 text-[#66fcf1] animate-spin mb-4" />
            <p className="text-[#45a29e] animate-pulse">Syncing with Steam servers...</p>
          </div>
        )}

        {/* Content */}
        {ownedGames.length > 0 && (
          <div className="space-y-8">
            {/* Toolbar */}
            <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
              <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 no-scrollbar">
                <button
                  onClick={() => { setFilters(f => ({ ...f, mac: !f.mac })); setCurrentPage(1); }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all text-sm whitespace-nowrap ${
                    filters.mac 
                    ? "bg-[#66fcf1] border-[#66fcf1] text-[#0b0c10] shadow-[0_0_15px_rgba(102,252,241,0.3)]" 
                    : "border-[#45a29e]/30 text-[#45a29e] hover:border-[#66fcf1]/50"
                  }`}
                >
                  <Apple className="w-4 h-4" /> MacOS
                </button>
                <button
                  onClick={() => { setFilters(f => ({ ...f, linux: !f.linux })); setCurrentPage(1); }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all text-sm whitespace-nowrap ${
                    filters.linux 
                    ? "bg-[#66fcf1] border-[#66fcf1] text-[#0b0c10] shadow-[0_0_15px_rgba(102,252,241,0.3)]" 
                    : "border-[#45a29e]/30 text-[#45a29e] hover:border-[#66fcf1]/50"
                  }`}
                >
                  <Cpu className="w-4 h-4" /> Linux / Steam Deck
                </button>
                <button
                  onClick={() => { setFilters(f => ({ ...f, windows: !f.windows })); setCurrentPage(1); }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all text-sm whitespace-nowrap ${
                    filters.windows 
                    ? "bg-[#66fcf1] border-[#66fcf1] text-[#0b0c10] shadow-[0_0_15px_rgba(102,252,241,0.3)]" 
                    : "border-[#45a29e]/30 text-[#45a29e] hover:border-[#66fcf1]/50"
                  }`}
                >
                  <Monitor className="w-4 h-4" /> Windows
                </button>
              </div>

              <div className="text-sm text-[#45a29e]">
                Showing <span className="text-[#66fcf1] font-bold">{filteredGames.length}</span> games
              </div>
            </div>

            {/* Grid */}
            <motion.div 
              layout
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 xxl:grid-cols-5 gap-6"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              key={`page-${currentPage}`}
            >
              <AnimatePresence mode="wait">
                {currentViewGames.map((game, index) => (
                  <motion.div
                    key={game.appid}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ 
                      duration: 0.2,
                      delay: index * 0.02
                    }}
                  >
                    <GameCard 
                      game={game} 
                      platforms={platformsCache[game.appid]}
                      isLoading={!platformsCache.hasOwnProperty(game.appid)}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 mt-12 pb-12">
                <button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(p => p - 1)}
                  className="p-3 rounded-xl bg-[#1f2833] border border-[#45a29e]/20 disabled:opacity-30 disabled:cursor-not-allowed hover:border-[#66fcf1] transition-all"
                >
                  <ChevronLeft className="w-5 h-5 text-[#66fcf1]" />
                </button>
                
                <div className="flex items-center gap-2">
                  <span className="text-[#f5f5f5] font-bold">{currentPage}</span>
                  <span className="text-[#45a29e]">of</span>
                  <span className="text-[#45a29e]">{totalPages}</span>
                </div>

                <button
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(p => p + 1)}
                  className="p-3 rounded-xl bg-[#1f2833] border border-[#45a29e]/20 disabled:opacity-30 disabled:cursor-not-allowed hover:border-[#66fcf1] transition-all"
                >
                  <ChevronRight className="w-5 h-5 text-[#66fcf1]" />
                </button>
              </div>
            )}

            {filteredGames.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center py-20 bg-[#1f2833]/30 rounded-3xl border border-dashed border-[#45a29e]/20">
                <Filter className="w-12 h-12 text-[#45a29e]/30 mb-4" />
                <p className="text-[#45a29e]">No games match your current filters.</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer Info */}
      <footer className="py-12 px-4 border-t border-[#1f2833]">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-6">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-bold text-[#f5f5f5]">Steam Compat</p>
              <p className="text-xs text-[#45a29e]">Check game platform compatibility for your Steam library</p>
            </div>
            
            <div className="flex gap-6 text-xs">
              <a 
                href="https://steamcommunity.com/id/kitare"
                target="_blank"
                rel="noreferrer"
                className="text-[#45a29e] hover:text-[#66fcf1] transition-colors flex items-center gap-1"
              >
                Steam
              </a>
              <a 
                href="https://github.com/DosyaKitarov"
                target="_blank"
                rel="noreferrer"
                className="text-[#45a29e] hover:text-[#66fcf1] transition-colors flex items-center gap-1"
              >
                GitHub
              </a>
            </div>
          </div>

          <div className="text-center border-t border-[#1f2833] pt-6 text-xs text-[#45a29e]">
            <p>© 2026 Steam Compat. Made by <span className="text-[#66fcf1] font-semibold">DosyaKitarov</span></p>
            <p className="mt-2">Steam and the Steam logo are trademarks of Valve Corporation.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

interface GameCardProps {
  game: Game;
  platforms?: Platforms;
  isLoading?: boolean;
}

const GameCard: React.FC<GameCardProps> = ({ game, platforms, isLoading }) => {
  const headerUrl = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.appid}/header.jpg`;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="group bg-[#1f2833] rounded-2xl overflow-hidden border border-[#45a29e]/10 hover:border-[#66fcf1]/40 transition-all hover:shadow-[0_10px_30px_rgba(0,0,0,0.3)] flex flex-col"
    >
      <div className="relative aspect-[460/215] overflow-hidden">
        <img 
          src={headerUrl} 
          alt={game.name}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
          referrerPolicy="no-referrer"
          onError={(e) => {
            (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${game.appid}/460/215`;
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#1f2833] via-transparent to-transparent opacity-60" />
        
        <div className="absolute top-2 right-2 flex gap-1">
          <a 
            href={`https://store.steampowered.com/app/${game.appid}`}
            target="_blank"
            className="p-1.5 bg-[#0b0c10]/80 rounded-lg hover:bg-[#66fcf1] hover:text-[#0b0c10] text-[#66fcf1] transition-all"
            rel="noreferrer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      <div className="p-4 flex-1 flex flex-col justify-between">
        <div className="mb-4">
          <h3 className="font-bold text-[#f5f5f5] line-clamp-1 group-hover:text-[#66fcf1] transition-colors" title={game.name}>
            {game.name}
          </h3>
          <p className="text-[10px] text-[#45a29e] uppercase tracking-wider font-mono mt-1">
            {game.playtime_forever > 0 
              ? `${Math.round(game.playtime_forever / 60)}h played`
              : "Not played"}
          </p>
        </div>

        <div className="flex items-center justify-between border-t border-[#0b0c10]/30 pt-4">
          <div className="flex gap-3">
            {isLoading ? (
              <div className="flex items-center gap-2 text-[10px] text-[#45a29e]/50 italic">
                <Loader2 className="w-3 h-3 animate-spin" />
                Checking compatibility...
              </div>
            ) : (platforms as any)?.refused ? (
              <div className="flex items-center gap-2 text-[10px] text-red-400/70 italic">
                <Info className="w-3 h-3" />
                Steam refused data
              </div>
            ) : !platforms ? (
              <div className="text-[10px] text-[#45a29e]/50 italic">
                No platform data
              </div>
            ) : (
              <>
                <Monitor className={`w-4 h-4 ${platforms.windows ? "text-[#66fcf1]" : "text-[#45a29e]/20"}`} />
                <Apple className={`w-4 h-4 ${platforms.mac ? "text-[#66fcf1]" : "text-[#45a29e]/20"}`} />
                <Cpu className={`w-4 h-4 ${platforms.linux ? "text-[#66fcf1]" : "text-[#45a29e]/20"}`} />
              </>
            )}
          </div>
          <div className="text-[10px] font-mono text-[#45a29e]/40">
            ID: {game.appid}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
