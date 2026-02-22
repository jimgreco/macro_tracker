# Macro Tracker Web App

A web app for tracking macros with:
- SQLite database backend
- ChatGPT natural-language meal parsing
- Quick-add saved items/meals
- Daily grouping and totals
- Previous day totals
- Running 7-day average based on prior week
- Google-only login

## Requirements
- Node.js 18+
- Google OAuth credentials (Client ID + Client Secret)

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create env file:
   ```bash
   cp .env.example .env
   ```
3. Configure `.env` values:
   - `OPENAI_API_KEY`
   - `SESSION_SECRET`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_CALLBACK_URL` (default: `http://localhost:3000/auth/google/callback`)

4. In Google Cloud Console:
   - Create an OAuth Client ID (Web application)
   - Add Authorized redirect URI:
     - `http://localhost:3000/auth/google/callback`

5. Start the app:
   ```bash
   npm start
   ```
6. Open [http://localhost:3000](http://localhost:3000)

## Notes
- Login is required for all app/API usage.
- If Google OAuth env vars are missing, login will show an auth configuration error.
- If `OPENAI_API_KEY` is missing, parsing works in fallback mode with placeholder macros.
- Data is stored in `data/macros.db`.

## API Endpoints
- `GET /api/me`
- `POST /api/parse-meal`
- `POST /api/entries/bulk`
- `PUT /api/entries/:id`
- `DELETE /api/entries/:id`
- `GET /api/saved-items`
- `POST /api/saved-items`
- `PUT /api/saved-items/:id`
- `DELETE /api/saved-items/:id`
- `POST /api/quick-add`
- `GET /api/dashboard`
