# Setcord Phase 1 — Bot + Auth + Channel Creation

## Goal

Build the foundational working system:
1. Discord bot goes online
2. Backend server with Discord OAuth login
3. Dashboard page with a "Create Channel" button
4. Backend verifies user has ADMINISTRATOR permission on the target server
5. Backend tells the bot to create a text channel called "setcord"

**Priority: Security & stability over design.**

---

## User Review Required

> [!IMPORTANT]
> You need to create a **Discord Application** at https://discord.com/developers/applications and provide the following values for your `.env` file:
> - `CLIENT_ID` — Your Discord app's Client ID
> - `CLIENT_SECRET` — Your Discord app's Client Secret
> - `BOT_TOKEN` — Already exists in your `.env`
> - `REDIRECT_URI` — Will be `http://localhost:3000/auth/discord/callback`
>
> You also need to add this redirect URI in your Discord Developer Portal under **OAuth2 → Redirects**.

> [!WARNING]
> Your bot token is currently exposed in the `.env` file. Make sure `.env` is in `.gitignore` (it is ✅). **Never commit tokens to git.**

---

## Architecture

```
User Browser
    │
    ├── GET /login               → Login page (login.ejs)
    ├── GET /auth/discord        → Redirect to Discord OAuth
    ├── GET /auth/discord/callback → Exchange code for token, save session
    ├── GET /dashboard           → Dashboard page (requires auth)
    └── POST /api/create-channel → Create channel (requires auth + ADMIN perm check)
            │
            ▼
      Backend (Express.js, port 3000)
            │
            ├── Validates session
            ├── Checks ADMINISTRATOR permission via Discord API
            └── Tells the bot process to create the channel
                    │
                    ▼
              Bot Process (discord.js, separate process OR same process)
                    │
                    └── Creates "setcord" text channel via Discord API
```

---

## Proposed Changes

### Architecture Decision: Single Process

The bot and backend will run in a **single Node.js process** for simplicity at this stage. The Express server and Discord.js client will both start from a single entry point (`server.js`). The bot client instance is shared in-memory — no IPC needed.

---

### Root Config

#### [NEW] [package.json](file:///c:/My%20Projects/SaaS/Setcord/package.json)
- Dependencies: `express`, `discord.js`, `dotenv`, `express-session`, `axios`, `ejs`
- Start script: `node server.js`

#### [MODIFY] [.env](file:///c:/My%20Projects/SaaS/Setcord/.env)
- Add `CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI`, `SESSION_SECRET`
- Keep existing `BOT_TOKEN`

#### [MODIFY] [.gitignore](file:///c:/My%20Projects/SaaS/Setcord/.gitignore)
- Add `node_modules/` pattern

---

### Bot Layer

#### [MODIFY] [bot/executor.js](file:///c:/My%20Projects/SaaS/Setcord/bot/executor.js)  
- Initialize `discord.js` Client with required intents (`Guilds`, `GuildMembers`)
- Login with `BOT_TOKEN`
- Export the client instance so the backend can use it
- Export a `createChannel(guildId, channelName)` function

---

### Backend Layer

#### [NEW] [server.js](file:///c:/My%20Projects/SaaS/Setcord/server.js)
- Main entry point
- Initialize Express app
- Configure EJS view engine (views in `frontend/pages`)
- Configure session middleware (secure, httpOnly cookies)
- Mount routes
- Start the bot
- Listen on port 3000

#### [NEW] [backend/routes/auth.js](file:///c:/My%20Projects/SaaS/Setcord/backend/routes/auth.js)
- `GET /auth/discord` — Redirect to Discord OAuth2 authorize URL with `identify` + `guilds` scopes
- `GET /auth/discord/callback` — Exchange code for access token, fetch user info, save to session
- `GET /auth/logout` — Destroy session

#### [NEW] [backend/routes/api.js](file:///c:/My%20Projects/SaaS/Setcord/backend/routes/api.js)
- `POST /api/create-channel` — Protected route:
  1. Check user is authenticated (session)
  2. Receive `guildId` from request body
  3. Fetch user's guilds from Discord API using stored access token
  4. Find the target guild, check `permissions` has ADMINISTRATOR bit (`0x8`)
  5. Check bot is in the guild
  6. Call `createChannel(guildId, "setcord")`
  7. Return success/error response

#### [NEW] [backend/middleware/auth.js](file:///c:/My%20Projects/SaaS/Setcord/backend/middleware/auth.js)
- `requireAuth` middleware — checks session, redirects to `/login` if not authenticated

---

### Frontend Layer

#### [MODIFY] [frontend/pages/login.ejs](file:///c:/My%20Projects/SaaS/Setcord/frontend/pages/login.ejs)
- Simple page with "Login with Discord" button
- Links to `/auth/discord`

#### [MODIFY] [frontend/pages/dashboard.ejs](file:///c:/My%20Projects/SaaS/Setcord/frontend/pages/dashboard.ejs)
- Shows logged-in user info (username, avatar)
- Dropdown/list of servers where user is ADMIN
- "Create setcord Channel" button
- JavaScript to call `POST /api/create-channel` with selected guildId
- Display success/error message

---

## Security Measures

| Concern | Solution |
|---|---|
| Session hijacking | `httpOnly: true`, `secure: true` in production, `sameSite: 'lax'` |
| CSRF on API calls | Server validates session + Discord permission on every request |
| Token exposure | Access tokens stored server-side in session only, never sent to client |
| Bot token exposure | Only in `.env`, never in client code |
| Permission bypass | Backend re-checks ADMINISTRATOR permission from Discord API on every action |
| Input validation | guildId validated as a Discord snowflake before use |

---

## Open Questions

> [!IMPORTANT]
> 1. Do you already have a Discord Application created? If not, you need to create one at https://discord.com/developers/applications
> 2. What is your Discord Application's **Client ID** and **Client Secret**? (I'll need them for the `.env`)
> 3. Do you want the bot and backend running as a single process (simpler) or separate processes (more scalable)?
>    - **Recommendation**: Single process for now, split later when needed.

---

## Verification Plan

### Automated Tests
- Start the server with `node server.js`
- Verify bot comes online (console log)
- Verify Express is listening on port 3000

### Manual Verification
1. Visit `http://localhost:3000` → see login page
2. Click "Login with Discord" → redirected to Discord, authorize, come back
3. See dashboard with server list
4. Select a server where you're admin + bot is present
5. Click "Create setcord Channel" → channel appears in Discord server


User Browser
    │
    ├── GET /login               → Login page (login.ejs)
    ├── GET /auth/discord        → Redirect to Discord OAuth
    ├── GET /auth/discord/callback → Exchange code for token, save session
    ├── GET /dashboard           → Dashboard page (requires auth)
    └── POST /api/create-channel → Create channel (requires auth + ADMIN perm check)
            │
            ▼
      Backend (Express.js, port 3000)
            │
            ├── Validates session
            ├── Checks ADMINISTRATOR permission via Discord API
            └── Tells the bot process to create the channel
                    │
                    ▼
              Bot Process (discord.js, separate process OR same process)
                    │
                    └── Creates "setcord" text channel via Discord API
