const express = require('express');
const axios = require('axios');
const router = express.Router();
const { requireGuildAdmin } = require('../middleware/guild');
const bot = require('../../bot/executor');
const { requireAuth } = require('../middleware/auth');

const DISCORD_API = 'https://discord.com/api/v10';
const ADMINISTRATOR_BIT = 0x8;

// GET /api/servers
router.get('/servers', async (req, res) => {
    try {
        if (!req.session || !req.session.accessToken) {
            return res.status(401).json({ success: false, error: 'Session expired' });
        }

        let adminGuilds = [];

        if (req.session.serversCache && (Date.now() - req.session.serversCacheTime) < 5 * 60 * 1000) {
            adminGuilds = req.session.serversCache;
        } else {
            const guildsResponse = await axios.get(`${DISCORD_API}/users/@me/guilds`, {
                headers: { Authorization: `${req.session.tokenType} ${req.session.accessToken}` },
                timeout: 10000,
            });

            adminGuilds = guildsResponse.data
                .filter((g) => {
                    const perms = BigInt(g.permissions || 0);
                    return (perms & BigInt(ADMINISTRATOR_BIT)) === BigInt(ADMINISTRATOR_BIT);
                })
                .map((g) => ({
                    id: g.id,
                    name: g.name,
                    icon: g.icon,
                }));

            req.session.serversCache = adminGuilds;
            req.session.serversCacheTime = Date.now();
        }

        const serversWithBotStatus = adminGuilds.map((g) => ({
            ...g,
            botPresent: bot.isBotInGuild(g.id),
        }));

        return res.json({ success: true, servers: serversWithBotStatus });
    } catch (err) {
        console.error('[API] Failed to fetch servers:', err.response?.data || err.message);

        if (req.session.serversCache) {
            const fallbackServers = req.session.serversCache.map((g) => ({
                ...g,
                botPresent: bot.isBotInGuild(g.id),
            }));
            return res.json({ success: true, servers: fallbackServers });
        }

        return res.status(500).json({ success: false, error: 'Failed to fetch servers' });
    }
});

// ── Better Discord error parser ──
function parseGuildEditError(err) {
    const msg = err.message || '';
    if (msg.includes('GUILD_RULES_CHANNEL_REQUIRED') || msg.includes('rules_channel_id'))
        return 'Community requires a Rules Channel to be set.';
    if (msg.includes('GUILD_PUBLIC_UPDATES_CHANNEL_REQUIRED') || msg.includes('public_updates_channel_id'))
        return 'Community requires a Community Updates Channel to be set.';
    if (msg.includes('COMMUNITY_CHANNELS_NOT_TEXT_OR_NEWS'))
        return 'Rules and Updates channels must be regular text channels (not forum/stage/voice).';
    if (msg.includes('verification_level'))
        return 'Community requires Verification Level set to Low or higher.';
    if (msg.includes('explicit_content_filter'))
        return 'Community requires Explicit Content Filter set to "All Members".';
    if (msg.includes('Missing Permissions'))
        return 'Bot is missing permissions to edit server settings.';
    if (msg.includes('system_channel_id'))
        return 'System Messages channel cannot be used as both the System Channel and Rules/Updates Channel at the same time.';
    return msg;
}

// ── Get detailed guild settings ──
router.get('/:guildId/guild-settings', requireAuth, async (req, res) => {
    const result = await bot.getGuildDetailed(req.params.guildId);
    res.json(result);
});

// ── Save general settings ──
router.patch('/:guildId/guild-settings', requireAuth, async (req, res) => {
    try {
        const result = await bot.editGuildGeneral(req.params.guildId, req.body);
        if (!result.success) return res.json({ success: false, error: parseGuildEditError({ message: result.error }) });
        // Clear the server-list cache so icon/name changes appear immediately on /servers
        req.session.serversCache = null;
        req.session.serversCacheTime = 0;
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: parseGuildEditError(e) });
    }
});

// ── Enable Community (wizard) ──
router.post('/:guildId/enable-community', requireAuth, async (req, res) => {
    try {
        const result = await bot.enableCommunity(req.params.guildId, req.body);
        if (!result.success) return res.json({ success: false, error: parseGuildEditError({ message: result.error }) });
        res.json(result);
    } catch (e) {
        res.json({ success: false, error: parseGuildEditError(e) });
    }
});

// ── Disable Community ──
router.post('/:guildId/disable-community', requireAuth, async (req, res) => {
    try {
        const result = await bot.disableCommunity(req.params.guildId);
        if (!result.success) return res.json({ success: false, error: parseGuildEditError({ message: result.error }) });
        res.json(result);
    } catch (e) {
        res.json({ success: false, error: parseGuildEditError(e) });
    }
});

// ── Export ──
router.get('/:guildId/export', requireAuth, async (req, res) => {
    const result = await bot.exportGuildFull(req.params.guildId);
    res.json(result);
});

// ── Import ──
router.post('/:guildId/import', requireAuth, async (req, res) => {
    const { structure, keepExisting } = req.body;
    if (!structure) return res.json({ success: false, error: 'No structure provided' });
    const result = await bot.importGuildFull(req.params.guildId, structure, keepExisting);
    res.json(result);
});

// ── AFK Bot ──
router.post('/:guildId/afk-bot/start', requireAuth, async (req, res) => {
    const { channelId, duration, kickOnExpiry } = req.body;
    if (!channelId) return res.json({ success: false, error: 'Channel ID required' });
    res.setTimeout(20000);
    const result = await bot.startAfkBot(req.params.guildId, channelId, duration || 0, kickOnExpiry || false);
    res.json(result);
});

router.post('/:guildId/afk-bot/stop', requireAuth, async (req, res) => {
    const result = await bot.stopAfkBot(req.params.guildId);
    res.json(result);
});

router.get('/:guildId/afk-bot/status', requireAuth, async (req, res) => {
    res.json({ success: true, data: bot.getAfkStatus(req.params.guildId) });
});

// ========================
// CHANNEL ROUTES
// ========================

// GET /api/:guildId/channels
router.get('/:guildId/channels', requireGuildAdmin, async (req, res) => {
    try {
        const result = await bot.fetchChannels(req.guildId);
        return result.success ? res.json(result) : res.status(400).json(result);
    } catch (err) {
        console.error('[API] fetchChannels error:', err.message);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/:guildId/channels
router.post('/:guildId/channels', requireGuildAdmin, async (req, res) => {
    try {
        const { name, type, parentId } = req.body;
        if (!name || typeof name !== 'string')
            return res.status(400).json({ success: false, error: 'Channel name is required' });

        const cleanName = name.trim().toLowerCase().replace(/\s+/g, '-');
        if (cleanName.length < 1 || cleanName.length > 100)
            return res.status(400).json({ success: false, error: 'Channel name must be 1-100 characters' });

        const VALID_TYPES = ['text', 'voice', 'announcement', 'forum', 'stage'];
        const channelType = VALID_TYPES.includes(type) ? type : 'text';
        const result = await bot.createChannel(req.guildId, cleanName, channelType, parentId || null);

        if (result.success) {
            console.log(`[API] Channel created by ${req.session.user.username}: #${cleanName}`);
            return res.json(result);
        }
        return res.status(400).json(result);
    } catch (err) {
        console.error('[API] createChannel error:', err.message);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// DELETE /api/:guildId/channels/:channelId
router.delete('/:guildId/channels/:channelId', requireGuildAdmin, async (req, res) => {
    try {
        const { channelId } = req.params;
        if (!channelId || !/^\d{17,20}$/.test(channelId))
            return res.status(400).json({ success: false, error: 'Invalid channel ID' });

        const result = await bot.deleteChannel(req.guildId, channelId);
        if (result.success) {
            console.log(`[API] Channel deleted by ${req.session.user.username}`);
            return res.json(result);
        }
        return res.status(400).json(result);
    } catch (err) {
        console.error('[API] deleteChannel error:', err.message);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/:guildId/channels/bulk-delete
router.post('/:guildId/channels/bulk-delete', requireGuildAdmin, async (req, res) => {
    try {
        const { channelIds } = req.body;
        if (!Array.isArray(channelIds) || channelIds.length === 0)
            return res.status(400).json({ success: false, error: 'No channel IDs provided' });

        const invalid = channelIds.find(id => !/^\d{17,20}$/.test(id));
        if (invalid) return res.status(400).json({ success: false, error: `Invalid channel ID: ${invalid}` });

        const results = { deleted: [], failed: [] };
        for (const id of channelIds) {
            const result = await bot.deleteChannel(req.guildId, id);
            if (result.success) results.deleted.push(id);
            else results.failed.push({ id, error: result.error });
        }
        console.log(`[API] Bulk delete by ${req.session.user.username}: ${results.deleted.length} deleted, ${results.failed.length} failed`);
        return res.json({ success: true, ...results });
    } catch (err) {
        console.error('[API] bulkDelete error:', err.message);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// PATCH /api/:guildId/channels/order  ← MUST come before /:channelId
router.patch('/:guildId/channels/order', requireGuildAdmin, async (req, res) => {
    try {
        const { positions } = req.body;
        if (!Array.isArray(positions))
            return res.status(400).json({ success: false, error: 'positions array is required' });

        const result = await bot.reorderChannels(req.guildId, positions);
        if (result.success) {
            console.log(`[API] Channels reordered by ${req.session.user.username}`);
            return res.json(result);
        }
        return res.status(400).json(result);
    } catch (err) {
        console.error('[API] reorderChannels error:', err.message);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// PATCH /api/:guildId/channels/:channelId  ← MUST come after /order
router.patch('/:guildId/channels/:channelId', requireGuildAdmin, async (req, res) => {
    try {
        const { channelId } = req.params;
        const { name, parentId } = req.body;

        if (!channelId || !/^\d{17,20}$/.test(channelId))
            return res.status(400).json({ success: false, error: 'Invalid channel ID' });

        if (parentId !== undefined && name === undefined) {
            const resolvedParent = parentId === null || parentId === '' ? null : parentId;
            if (resolvedParent && !/^\d{17,20}$/.test(resolvedParent))
                return res.status(400).json({ success: false, error: 'Invalid category ID' });
            const result = await bot.moveChannelToCategory(req.guildId, channelId, resolvedParent);
            if (result.success) {
                console.log(`[API] Channel moved by ${req.session.user.username}`);
                return res.json(result);
            }
            return res.status(400).json(result);
        }

        if (!name || typeof name !== 'string')
            return res.status(400).json({ success: false, error: 'New name is required' });

        const cleanName = name.trim().toLowerCase().replace(/\s+/g, '-');
        if (cleanName.length < 1 || cleanName.length > 100)
            return res.status(400).json({ success: false, error: 'Channel name must be 1-100 characters' });

        const result = await bot.renameChannel(req.guildId, channelId, cleanName);
        if (result.success) {
            console.log(`[API] Channel renamed by ${req.session.user.username}: #${cleanName}`);
            return res.json(result);
        }
        return res.status(400).json(result);
    } catch (err) {
        console.error('[API] patchChannel error:', err.message);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/:guildId/categories
router.post('/:guildId/categories', requireGuildAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || typeof name !== 'string')
            return res.status(400).json({ success: false, error: 'Category name is required' });

        const cleanName = name.trim();
        if (cleanName.length < 1 || cleanName.length > 100)
            return res.status(400).json({ success: false, error: 'Category name must be 1-100 characters' });

        const result = await bot.createCategory(req.guildId, cleanName);
        if (result.success) {
            console.log(`[API] Category created by ${req.session.user.username}: ${cleanName}`);
            return res.json(result);
        }
        return res.status(400).json(result);
    } catch (err) {
        console.error('[API] createCategory error:', err.message);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ========================
// ROLE ROUTES
// ========================

// GET /api/:guildId/roles
router.get('/:guildId/roles', requireGuildAdmin, async (req, res) => {
    try {
        const result = await bot.fetchRoles(req.guildId);
        return result.success ? res.json(result) : res.status(400).json(result);
    } catch (err) {
        console.error('[API] fetchRoles error:', err.message);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/:guildId/roles
router.post('/:guildId/roles', requireGuildAdmin, async (req, res) => {
    try {
        const { name, color } = req.body;
        if (!name || typeof name !== 'string')
            return res.status(400).json({ success: false, error: 'Role name is required' });

        const cleanName = name.trim();
        if (cleanName.length < 1 || cleanName.length > 100)
            return res.status(400).json({ success: false, error: 'Role name must be 1-100 characters' });

        let validColor = null;
        if (color && /^#[0-9a-fA-F]{6}$/.test(color)) validColor = color;

        const result = await bot.createRole(req.guildId, cleanName, validColor);
        if (result.success) {
            console.log(`[API] Role created by ${req.session.user.username}: ${cleanName}`);
            return res.json(result);
        }
        return res.status(400).json(result);
    } catch (err) {
        console.error('[API] createRole error:', err.message);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// DELETE /api/:guildId/roles/:roleId
router.delete('/:guildId/roles/:roleId', requireGuildAdmin, async (req, res) => {
    try {
        const { roleId } = req.params;
        if (!roleId || !/^\d{17,20}$/.test(roleId))
            return res.status(400).json({ success: false, error: 'Invalid role ID' });

        const result = await bot.deleteRole(req.guildId, roleId);
        if (result.success) {
            console.log(`[API] Role deleted by ${req.session.user.username}`);
            return res.json(result);
        }
        return res.status(400).json(result);
    } catch (err) {
        console.error('[API] deleteRole error:', err.message);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// PATCH /api/:guildId/roles/order  ← MUST come before /:roleId
router.patch('/:guildId/roles/order', requireGuildAdmin, async (req, res) => {
    try {
        const { positions } = req.body;
        if (!Array.isArray(positions))
            return res.status(400).json({ success: false, error: 'positions array is required' });

        const result = await bot.reorderRoles(req.guildId, positions);
        if (result.success) {
            console.log(`[API] Roles reordered by ${req.session.user.username}`);
            return res.json(result);
        }
        return res.status(400).json(result);
    } catch (err) {
        console.error('[API] reorderRoles error:', err.message);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// PATCH /api/:guildId/roles/:roleId  ← MUST come after /order
router.patch('/:guildId/roles/:roleId', requireGuildAdmin, async (req, res) => {
    try {
        const { roleId } = req.params;
        const { name, color } = req.body;
        if (!roleId || !/^\d{17,20}$/.test(roleId))
            return res.status(400).json({ success: false, error: 'Invalid role ID' });

        const updates = {};
        if (name && typeof name === 'string') {
            const cleanName = name.trim();
            if (cleanName.length < 1 || cleanName.length > 100)
                return res.status(400).json({ success: false, error: 'Role name must be 1-100 characters' });
            updates.name = cleanName;
        }
        if (color && typeof color === 'string') {
            if (!/^#[0-9a-fA-F]{6}$/.test(color))
                return res.status(400).json({ success: false, error: 'Invalid color format. Use #RRGGBB' });
            updates.color = color;
        }
        if (Object.keys(updates).length === 0)
            return res.status(400).json({ success: false, error: 'No changes provided' });

        const result = await bot.editRole(req.guildId, roleId, updates);
        if (result.success) {
            console.log(`[API] Role edited by ${req.session.user.username}`);
            return res.json(result);
        }
        return res.status(400).json(result);
    } catch (err) {
        console.error('[API] editRole error:', err.message);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/:guildId/channels/:channelId/permissions
router.get('/:guildId/channels/:channelId/permissions', requireGuildAdmin, async (req, res) => {
    const result = await bot.getChannelPermissions(req.guildId, req.params.channelId);
    res.json(result);
});

// PUT /api/:guildId/channels/:channelId/permissions/:targetId
router.put('/:guildId/channels/:channelId/permissions/:targetId', requireGuildAdmin, async (req, res) => {
    const { flags } = req.body;
    if (!flags) return res.json({ success: false, error: 'flags required' });
    const result = await bot.setChannelPermission(req.guildId, req.params.channelId, req.params.targetId, flags);
    res.json(result);
});

// DELETE /api/:guildId/channels/:channelId/permissions/:targetId
router.delete('/:guildId/channels/:channelId/permissions/:targetId', requireGuildAdmin, async (req, res) => {
    const result = await bot.deleteChannelPermission(req.guildId, req.params.channelId, req.params.targetId);
    res.json(result);
});

module.exports = router;