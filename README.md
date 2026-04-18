# Steam Compat

A web utility to check the platform compatibility (Windows, macOS, Linux/Steam Deck) of your entire Steam game library. Just enter your Steam ID, custom URL, or profile link to get started.

## ✨ Features

-   **Instant Library Loading**: Enter your Steam ID (custom URL, profile link, or SteamID64) to see all your games.
-   **Platform Compatibility**: Instantly see which games run on Windows, macOS, and Linux/Steam Deck with clear icons.
-   **Smart Filtering**: Filter your library by one or more platforms to find exactly what you can play.
-   **Fast Caching**: Game data is cached using Redis, so subsequent loads for any user are lightning-fast.
-   **Efficient API Usage**: Fetches game data in parallel batches to be quick and respectful of the Steam API.
-   **Responsive Design**: Works great on desktop and mobile.

## 🛠️ Tech Stack

-   **Frontend**: React, Vite, TypeScript, Tailwind CSS, Framer Motion
-   **Backend**: Node.js, Express.js
-   **Caching**: Upstash Redis
-   **API**: Steam Web API

## 🚀 Getting Started

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/DosyaKitarov/steam-compat.git
    cd steam-compat
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Set up environment variables:**
    Create a `.env` file in the root directory and add your keys:
    ```env
    STEAM_API_KEY=YOUR_STEAM_API_KEY
    KV_REST_API_URL=YOUR_UPSTASH_REDIS_URL
    KV_REST_API_TOKEN=YOUR_UPSTASH_REDIS_TOKEN
    ```

4.  **Run the development server:**
    ```bash
    npm run dev
    ```
    The application will be available at `http://localhost:3000`.
