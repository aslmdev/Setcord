const axios = require('axios');
const { isBotInGuild } = require('../../bot/executor');

const DISCORD_API = 'https://discord.com/api/v10';
const ADMINISTRATOR_BIT = 0x8;

/**
 * Validate that a string looks like a Discord snowflake ID
 */
function isValidSnowflake(id) {
    return typeof id === 'string' && /^\d{17,20}$/.test(id);
}

/**
 * Middleware: Validate guildId, check ADMINISTRATOR permission, check bot presence
 * Attaches `req.guildId` on success for downstream use
 */
async function requireGuildAdmin(req, res, next) {
    try {
        const guildId = req.params.guildId;

        // 1. Validate guildId format
        if (!guildId || !isValidSnowflake(guildId)) {
            return res.status(400).json({ success: false, error: 'Invalid server ID' });
        }

        // 2. Fetch user's guilds from Discord (with caching and timeout)
        let guilds;
        try {
            if (req.session.serversCache && (Date.now() - req.session.serversCacheTime) < 5 * 60 * 1000) {
                guilds = req.session.serversCache;
            } else {
                const guildsResponse = await axios.get(`${DISCORD_API}/users/@me/guilds`, {
                    headers: {
                        Authorization: `${req.session.tokenType} ${req.session.accessToken}`,
                    },
                    timeout: 10000 // 10 second timeout
                });
                guilds = guildsResponse.data;
                req.session.serversCache = guilds;
                req.session.serversCacheTime = Date.now();
            }
        } catch (err) {
            console.error('[GUILD] Failed to fetch user guilds:', err.response?.data || err.message);
            // Fallback to cache if request timed out or rate limited
            if (req.session.serversCache) {
                guilds = req.session.serversCache;
            } else {
                return res.status(401).json({
                    success: false,
                    error: 'Session expired or Discord API rate limit. Please re-login.',
                });
            }
        }

        // 3. Find target guild and check ADMINISTRATOR
        const targetGuild = guilds.find((g) => g.id === guildId);
        if (!targetGuild) {
            return res.status(403).json({ success: false, error: 'You are not a member of this server' });
        }

        const userPermissions = BigInt(targetGuild.permissions);
        const hasAdmin = (userPermissions & BigInt(ADMINISTRATOR_BIT)) === BigInt(ADMINISTRATOR_BIT);
        if (!hasAdmin) {
            return res.status(403).json({
                success: false,
                error: 'You do not have ADMINISTRATOR permission on this server',
            });
        }

        // 4. Check bot is in the guild
        if (!isBotInGuild(guildId)) {
            return res.status(400).json({
                success: false,
                error: 'Bot is not in this server. Please invite the bot first.',
            });
        }

        // All checks passed
        req.guildId = guildId;
        next();
    } catch (err) {
        console.error('[GUILD] Unexpected middleware error:', err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

module.exports = { requireGuildAdmin, isValidSnowflake };
