# Steam Compat - Library Explorer

Discover your Steam games with platform compatibility filters for MacOS and Linux/Steam Deck. Features smart caching and paginated library browsing.

## Features

- 🎮 Browse your complete Steam library
- 🐧 Filter games by Linux/Steam Deck compatibility
- 🍎 Filter games by MacOS compatibility
- ⚡ Smart caching for improved performance
- 📖 Paginated browsing of large libraries
- 🤖 Powered by Google Gemini API

## Prerequisites

- Node.js (v18 or higher)
- A Steam account
- A Google Gemini API key

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

Create a `.env.local` file in the root directory and add your Gemini API key:

```
GEMINI_API_KEY=your_api_key_here
```

### 3. Run the development server

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

## Available Scripts

- `npm run dev` - Start the development server
- `npm run build` - Build for production
- `npm start` - Start the production server
- `npm run clean` - Clean the build directory
- `npm run lint` - Run TypeScript type checking

## Project Structure

```plaintext
├── src/
│   ├── App.tsx          # Main application component
│   ├── main.tsx         # Application entry point
│   └── index.css        # Global styles
├── server.ts            # Express server configuration
├── index.html           # HTML template
├── vite.config.ts       # Vite configuration
└── tsconfig.json        # TypeScript configuration
```

## Technologies Used

- **React** - UI framework
- **TypeScript** - Type-safe JavaScript
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Utility-first CSS framework
- **Google Gemini API** - AI-powered features
- **Express** - Backend server
- **Lucide React** - Icon library

## License

MIT
