const express = require('express');
const axios = require('axios');
const router = express.Router();
const { requireGuildAdmin } = require('../middleware/guild');
const bot = require('../../bot/executor');

const DISCORD_API = 'https://discord.com/api/v10';
const ADMINISTRATOR_BIT = 0x8;

// GET /api/servers
router.get('/servers', async (req, res) => {
    try {
        if (!req.session || !req.session.accessToken) {
            return res.status(401).json({ success: false, error: 'Session expired' });
        }

        let adminGuilds = [];

        // Cache servers for 5 minutes to avoid rate limits
        if (req.session.serversCache && (Date.now() - req.session.serversCacheTime) < 5 * 60 * 1000) {
            adminGuilds = req.session.serversCache;
        } else {
            const guildsResponse = await axios.get(`${DISCORD_API}/users/@me/guilds`, {
                headers: { Authorization: `${req.session.tokenType} ${req.session.accessToken}` },
                timeout: 10000 // 10 seconds timeout
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

        // Calculate bot presence freshly
        const serversWithBotStatus = adminGuilds.map((g) => ({
            ...g,
            botPresent: bot.isBotInGuild(g.id),
        }));

        return res.json({ success: true, servers: serversWithBotStatus });
    } catch (err) {
        console.error('[API] Failed to fetch servers:', err.response?.data || err.message);
        
        // Fallback to cache if request fails completely
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

// GET /api/:guildId/channels
router.get('/:guildId/channels', requireGuildAdmin, async (req, res) => {
    const result = await bot.fetchChannels(req.guildId);
    return result.success ? res.json(result) : res.status(400).json(result);
});

// POST /api/:guildId/channels
router.post('/:guildId/channels', requireGuildAdmin, async (req, res) => {
    const { name, type, parentId } = req.body;
    if (!name || typeof name !== 'string')
        return res.status(400).json({ success: false, error: 'Channel name is required' });

    // Allow emoji — Discord supports them. Just lowercase + replace spaces with hyphens.
    const cleanName = name.trim().toLowerCase().replace(/\s+/g, '-');
    if (cleanName.length < 1 || cleanName.length > 100)
        return res.status(400).json({ success: false, error: 'Channel name must be 1-100 characters' });

    const channelType = type === 'voice' ? 'voice' : 'text';
    const result = await bot.createChannel(req.guildId, cleanName, channelType, parentId || null);

    if (result.success) {
        console.log(`[API] Channel created by ${req.session.user.username}: #${cleanName}`);
        return res.json(result);
    }
    return res.status(400).json(result);
});

// DELETE /api/:guildId/channels/:channelId
router.delete('/:guildId/channels/:channelId', requireGuildAdmin, async (req, res) => {
    const { channelId } = req.params;
    if (!channelId || !/^\d{17,20}$/.test(channelId))
        return res.status(400).json({ success: false, error: 'Invalid channel ID' });

    const result = await bot.deleteChannel(req.guildId, channelId);
    if (result.success) {
        console.log(`[API] Channel deleted by ${req.session.user.username}`);
        return res.json(result);
    }
    return res.status(400).json(result);
});

// POST /api/:guildId/channels/bulk-delete
router.post('/:guildId/channels/bulk-delete', requireGuildAdmin, async (req, res) => {
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
});

// PATCH /api/:guildId/channels/:channelId
// Supports: rename (name), move to category (parentId), or both
router.patch('/:guildId/channels/:channelId', requireGuildAdmin, async (req, res) => {
    const { channelId } = req.params;
    const { name, parentId } = req.body;

    if (!channelId || !/^\d{17,20}$/.test(channelId))
        return res.status(400).json({ success: false, error: 'Invalid channel ID' });

    // Move to category (parentId can be null to remove from category)
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

    // Rename
    if (!name || typeof name !== 'string')
        return res.status(400).json({ success: false, error: 'New name is required' });

    // Allow emoji and unicode in channel names (Discord supports them)
    const cleanName = name.trim().toLowerCase().replace(/\s+/g, '-');
    if (cleanName.length < 1 || cleanName.length > 100)
        return res.status(400).json({ success: false, error: 'Channel name must be 1-100 characters' });

    const result = await bot.renameChannel(req.guildId, channelId, cleanName);
    if (result.success) {
        console.log(`[API] Channel renamed by ${req.session.user.username}: #${cleanName}`);
        return res.json(result);
    }
    // Pass Discord error details through
    return res.status(400).json(result);
});

// PATCH /api/:guildId/channels/order
router.patch('/:guildId/channels/order', requireGuildAdmin, async (req, res) => {
    const { positions } = req.body;
    if (!Array.isArray(positions)) return res.status(400).json({ success: false, error: 'positions array is required' });
    
    // Convert to the exact format expected by discord.js (.setPositions)
    // format: { channel: channelId, position: pos }
    const result = await bot.reorderChannels(req.guildId, positions);
    if (result.success) {
        console.log(`[API] Channels reordered by ${req.session.user.username}`);
        return res.json(result);
    }
    return res.status(400).json(result);
});

// POST /api/:guildId/categories
router.post('/:guildId/categories', requireGuildAdmin, async (req, res) => {
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
});

// GET /api/:guildId/roles
router.get('/:guildId/roles', requireGuildAdmin, async (req, res) => {
    const result = await bot.fetchRoles(req.guildId);
    return result.success ? res.json(result) : res.status(400).json(result);
});

// POST /api/:guildId/roles
router.post('/:guildId/roles', requireGuildAdmin, async (req, res) => {
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
});

// DELETE /api/:guildId/roles/:roleId
router.delete('/:guildId/roles/:roleId', requireGuildAdmin, async (req, res) => {
    const { roleId } = req.params;
    if (!roleId || !/^\d{17,20}$/.test(roleId))
        return res.status(400).json({ success: false, error: 'Invalid role ID' });

    const result = await bot.deleteRole(req.guildId, roleId);
    if (result.success) {
        console.log(`[API] Role deleted by ${req.session.user.username}`);
        return res.json(result);
    }
    return res.status(400).json(result);
});

// PATCH /api/:guildId/roles/:roleId
router.patch('/:guildId/roles/:roleId', requireGuildAdmin, async (req, res) => {
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
});

// PATCH /api/:guildId/roles/order
router.patch('/:guildId/roles/order', requireGuildAdmin, async (req, res) => {
    const { positions } = req.body;
    if (!Array.isArray(positions)) return res.status(400).json({ success: false, error: 'positions array is required' });
    
    // Convert to exact format { role: roleId, position: pos }
    const result = await bot.reorderRoles(req.guildId, positions);
    if (result.success) {
        console.log(`[API] Roles reordered by ${req.session.user.username}`);
        return res.json(result);
    }
    return res.status(400).json(result);
});

module.exports = router;