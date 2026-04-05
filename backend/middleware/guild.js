const axios = require('axios');
const { isBotInGuild } = require('../../bot/executor');

const DISCORD_API = 'https://discord.com/api/v10';
const ADMINISTRATOR_BIT = 0x8;

function isValidSnowflake(id) {
    return typeof id === 'string' && /^\d{17,20}$/.test(id);
}

/**
 * Middleware: Validate guildId, check ADMINISTRATOR permission, check bot presence.
 *
 * IMPORTANT: Always fetches fresh guild list from Discord — never uses the
 * stripped serversCache (which has no permissions field).
 * Uses a separate guildsWithPermsCache keyed differently.
 */
async function requireGuildAdmin(req, res, next) {
    try {
        const guildId = req.params.guildId;

        if (!guildId || !isValidSnowflake(guildId)) {
            return res.status(400).json({ success: false, error: 'Invalid server ID' });
        }

        // Fetch full guild list with permissions
        // Use a separate cache key — never share with the stripped serversCache
        let guilds;
        const cacheKey = 'guildsWithPermsCache';
        const cacheTimeKey = 'guildsWithPermsCacheTime';
        const CACHE_TTL = 3 * 60 * 1000; // 3 minutes

        const cacheValid =
            req.session[cacheKey] &&
            req.session[cacheTimeKey] &&
            (Date.now() - req.session[cacheTimeKey]) < CACHE_TTL;

        if (cacheValid) {
            guilds = req.session[cacheKey];
        } else {
            try {
                const guildsResponse = await axios.get(`${DISCORD_API}/users/@me/guilds`, {
                    headers: {
                        Authorization: `${req.session.tokenType} ${req.session.accessToken}`,
                    },
                    timeout: 10000,
                });
                guilds = guildsResponse.data; // Full list WITH permissions
                req.session[cacheKey] = guilds;
                req.session[cacheTimeKey] = Date.now();
            } catch (err) {
                console.error('[GUILD] Failed to fetch user guilds:', err.response?.data || err.message);
                // Fall back to cache even if stale, rather than failing
                if (req.session[cacheKey]) {
                    guilds = req.session[cacheKey];
                } else {
                    return res.status(401).json({
                        success: false,
                        error: 'Session expired or Discord API unavailable. Please re-login.',
                    });
                }
            }
        }

        // Find target guild in the full list
        const targetGuild = guilds.find((g) => g.id === guildId);
        if (!targetGuild) {
            return res.status(403).json({ success: false, error: 'You are not a member of this server' });
        }

        // Permissions field must exist — if not, something is very wrong
        if (targetGuild.permissions === undefined || targetGuild.permissions === null) {
            console.error('[GUILD] permissions field missing on guild:', targetGuild.id, targetGuild.name);
            return res.status(500).json({
                success: false,
                error: 'Could not verify your permissions — Discord API returned incomplete data. Please re-login.',
            });
        }

        const userPermissions = BigInt(targetGuild.permissions);
        const hasAdmin = (userPermissions & BigInt(ADMINISTRATOR_BIT)) === BigInt(ADMINISTRATOR_BIT);
        if (!hasAdmin) {
            return res.status(403).json({
                success: false,
                error: 'You do not have ADMINISTRATOR permission on this server',
            });
        }

        if (!isBotInGuild(guildId)) {
            return res.status(400).json({
                success: false,
                error: 'Bot is not in this server. Please invite the bot first.',
            });
        }

        req.guildId = guildId;
        next();
    } catch (err) {
        console.error('[GUILD] Unexpected middleware error:', err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

module.exports = { requireGuildAdmin, isValidSnowflake };