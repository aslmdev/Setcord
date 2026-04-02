const express = require('express');
const axios = require('axios');
const router = express.Router();
const { requireGuildAdmin } = require('../middleware/guild');
const bot = require('../../bot/executor');

const DISCORD_API = 'https://discord.com/api/v10';
const ADMINISTRATOR_BIT = 0x8;

// ========================
// SERVER LIST
// ========================

/**
 * GET /api/servers
 * Returns the user's guilds where they have ADMINISTRATOR permission
 */
router.get('/servers', async (req, res) => {
    try {
        const guildsResponse = await axios.get(`${DISCORD_API}/users/@me/guilds`, {
            headers: {
                Authorization: `${req.session.tokenType} ${req.session.accessToken}`,
            },
        });

        const adminGuilds = guildsResponse.data
            .filter((g) => {
                const perms = BigInt(g.permissions);
                return (perms & BigInt(ADMINISTRATOR_BIT)) === BigInt(ADMINISTRATOR_BIT);
            })
            .map((g) => ({
                id: g.id,
                name: g.name,
                icon: g.icon,
                botPresent: bot.isBotInGuild(g.id),
            }));

        return res.json({ success: true, servers: adminGuilds });
    } catch (err) {
        console.error('[API] Failed to fetch servers:', err.response?.data || err.message);
        return res.status(500).json({ success: false, error: 'Failed to fetch servers' });
    }
});

// ========================
// CHANNEL OPERATIONS
// All routes below use requireGuildAdmin middleware
// ========================

/**
 * GET /api/:guildId/channels
 * Fetch all channels grouped by category
 */
router.get('/:guildId/channels', requireGuildAdmin, async (req, res) => {
    const result = await bot.fetchChannels(req.guildId);
    if (result.success) {
        return res.json(result);
    }
    return res.status(400).json(result);
});

/**
 * POST /api/:guildId/channels
 * Create a new channel
 * Body: { name: string, type: 'text'|'voice', parentId?: string }
 */
router.post('/:guildId/channels', requireGuildAdmin, async (req, res) => {
    const { name, type, parentId } = req.body;

    // Validate name
    if (!name || typeof name !== 'string') {
        return res.status(400).json({ success: false, error: 'Channel name is required' });
    }

    const cleanName = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_]/g, '');
    if (cleanName.length < 1 || cleanName.length > 100) {
        return res.status(400).json({ success: false, error: 'Channel name must be 1-100 characters' });
    }

    // Validate type
    const channelType = type === 'voice' ? 'voice' : 'text';

    const result = await bot.createChannel(req.guildId, cleanName, channelType, parentId || null);

    if (result.success) {
        console.log(`[API] Channel created by ${req.session.user.username}: #${cleanName}`);
        return res.json(result);
    }
    return res.status(400).json(result);
});

/**
 * DELETE /api/:guildId/channels/:channelId
 * Delete a channel
 */
router.delete('/:guildId/channels/:channelId', requireGuildAdmin, async (req, res) => {
    const { channelId } = req.params;

    if (!channelId || !/^\d{17,20}$/.test(channelId)) {
        return res.status(400).json({ success: false, error: 'Invalid channel ID' });
    }

    const result = await bot.deleteChannel(req.guildId, channelId);

    if (result.success) {
        console.log(`[API] Channel deleted by ${req.session.user.username}`);
        return res.json(result);
    }
    return res.status(400).json(result);
});

/**
 * PATCH /api/:guildId/channels/:channelId
 * Rename a channel
 * Body: { name: string }
 */
router.patch('/:guildId/channels/:channelId', requireGuildAdmin, async (req, res) => {
    const { channelId } = req.params;
    const { name } = req.body;

    if (!channelId || !/^\d{17,20}$/.test(channelId)) {
        return res.status(400).json({ success: false, error: 'Invalid channel ID' });
    }

    if (!name || typeof name !== 'string') {
        return res.status(400).json({ success: false, error: 'New name is required' });
    }

    const cleanName = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_]/g, '');
    if (cleanName.length < 1 || cleanName.length > 100) {
        return res.status(400).json({ success: false, error: 'Channel name must be 1-100 characters' });
    }

    const result = await bot.renameChannel(req.guildId, channelId, cleanName);

    if (result.success) {
        console.log(`[API] Channel renamed by ${req.session.user.username}: #${cleanName}`);
        return res.json(result);
    }
    return res.status(400).json(result);
});

/**
 * POST /api/:guildId/categories
 * Create a new category
 * Body: { name: string }
 */
router.post('/:guildId/categories', requireGuildAdmin, async (req, res) => {
    const { name } = req.body;

    if (!name || typeof name !== 'string') {
        return res.status(400).json({ success: false, error: 'Category name is required' });
    }

    const cleanName = name.trim();
    if (cleanName.length < 1 || cleanName.length > 100) {
        return res.status(400).json({ success: false, error: 'Category name must be 1-100 characters' });
    }

    const result = await bot.createCategory(req.guildId, cleanName);

    if (result.success) {
        console.log(`[API] Category created by ${req.session.user.username}: ${cleanName}`);
        return res.json(result);
    }
    return res.status(400).json(result);
});

// ========================
// ROLE OPERATIONS
// ========================

/**
 * GET /api/:guildId/roles
 * Fetch all roles
 */
router.get('/:guildId/roles', requireGuildAdmin, async (req, res) => {
    const result = await bot.fetchRoles(req.guildId);
    if (result.success) {
        return res.json(result);
    }
    return res.status(400).json(result);
});

/**
 * POST /api/:guildId/roles
 * Create a new role
 * Body: { name: string, color?: string }
 */
router.post('/:guildId/roles', requireGuildAdmin, async (req, res) => {
    const { name, color } = req.body;

    if (!name || typeof name !== 'string') {
        return res.status(400).json({ success: false, error: 'Role name is required' });
    }

    const cleanName = name.trim();
    if (cleanName.length < 1 || cleanName.length > 100) {
        return res.status(400).json({ success: false, error: 'Role name must be 1-100 characters' });
    }

    // Validate color hex
    let validColor = null;
    if (color && typeof color === 'string') {
        if (/^#[0-9a-fA-F]{6}$/.test(color)) {
            validColor = color;
        }
    }

    const result = await bot.createRole(req.guildId, cleanName, validColor);

    if (result.success) {
        console.log(`[API] Role created by ${req.session.user.username}: ${cleanName}`);
        return res.json(result);
    }
    return res.status(400).json(result);
});

/**
 * DELETE /api/:guildId/roles/:roleId
 * Delete a role
 */
router.delete('/:guildId/roles/:roleId', requireGuildAdmin, async (req, res) => {
    const { roleId } = req.params;

    if (!roleId || !/^\d{17,20}$/.test(roleId)) {
        return res.status(400).json({ success: false, error: 'Invalid role ID' });
    }

    const result = await bot.deleteRole(req.guildId, roleId);

    if (result.success) {
        console.log(`[API] Role deleted by ${req.session.user.username}`);
        return res.json(result);
    }
    return res.status(400).json(result);
});

/**
 * PATCH /api/:guildId/roles/:roleId
 * Edit a role (name and/or color)
 * Body: { name?: string, color?: string }
 */
router.patch('/:guildId/roles/:roleId', requireGuildAdmin, async (req, res) => {
    const { roleId } = req.params;
    const { name, color } = req.body;

    if (!roleId || !/^\d{17,20}$/.test(roleId)) {
        return res.status(400).json({ success: false, error: 'Invalid role ID' });
    }

    const updates = {};

    if (name && typeof name === 'string') {
        const cleanName = name.trim();
        if (cleanName.length < 1 || cleanName.length > 100) {
            return res.status(400).json({ success: false, error: 'Role name must be 1-100 characters' });
        }
        updates.name = cleanName;
    }

    if (color && typeof color === 'string') {
        if (/^#[0-9a-fA-F]{6}$/.test(color)) {
            updates.color = color;
        } else {
            return res.status(400).json({ success: false, error: 'Invalid color format. Use #RRGGBB' });
        }
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, error: 'No changes provided' });
    }

    const result = await bot.editRole(req.guildId, roleId, updates);

    if (result.success) {
        console.log(`[API] Role edited by ${req.session.user.username}`);
        return res.json(result);
    }
    return res.status(400).json(result);
});

module.exports = router;
