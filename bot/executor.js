const { Client, GatewayIntentBits, ChannelType, Events } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
    ],
});

let isReady = false;

client.once(Events.ClientReady, () => {
    console.log(`[BOT] Logged in as ${client.user.tag}`);
    isReady = true;
});

/**
 * Start the bot — call this once from server.js
 */
async function startBot(token) {
    try {
        await client.login(token);
    } catch (err) {
        console.error('[BOT] Failed to login:', err.message);
        process.exit(1);
    }
}

/**
 * Check if bot is ready
 */
function checkReady() {
    if (!isReady) throw new Error('Bot is not ready yet');
}

/**
 * Get a guild the bot is in
 */
async function getGuild(guildId) {
    checkReady();
    const guild = await client.guilds.fetch(guildId);
    if (!guild) throw new Error('Bot is not in this server');
    return guild;
}

// ========================
// CHANNEL OPERATIONS
// ========================

/**
 * Fetch all channels in a guild, grouped by category
 */
async function fetchChannels(guildId) {
    try {
        const guild = await getGuild(guildId);
        const channels = await guild.channels.fetch();

        const result = {
            categories: [],
            uncategorized: [],
        };

        // Collect categories
        const categoryMap = new Map();
        channels.forEach((ch) => {
            if (ch.type === ChannelType.GuildCategory) {
                categoryMap.set(ch.id, {
                    id: ch.id,
                    name: ch.name,
                    position: ch.position,
                    channels: [],
                });
            }
        });

        // Assign channels to categories
        channels.forEach((ch) => {
            if (ch.type === ChannelType.GuildCategory) return;

            const channelData = {
                id: ch.id,
                name: ch.name,
                type: ch.type === ChannelType.GuildVoice ? 'voice' :
                      ch.type === ChannelType.GuildStageVoice ? 'stage' : 'text',
                position: ch.position,
                parentId: ch.parentId,
            };

            if (ch.parentId && categoryMap.has(ch.parentId)) {
                categoryMap.get(ch.parentId).channels.push(channelData);
            } else {
                result.uncategorized.push(channelData);
            }
        });

        // Sort channels within categories by position
        categoryMap.forEach((cat) => {
            cat.channels.sort((a, b) => a.position - b.position);
        });

        result.categories = Array.from(categoryMap.values()).sort((a, b) => a.position - b.position);
        result.uncategorized.sort((a, b) => a.position - b.position);

        return { success: true, data: result };
    } catch (err) {
        console.error('[BOT] Error fetching channels:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Create a channel in a guild
 * @param {string} guildId
 * @param {string} channelName
 * @param {string} channelType - 'text' or 'voice'
 * @param {string|null} parentId - category ID (optional)
 */
async function createChannel(guildId, channelName, channelType = 'text', parentId = null) {
    try {
        const guild = await getGuild(guildId);

        const type = channelType === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;

        const options = {
            name: channelName,
            type: type,
            reason: 'Created by Setcord dashboard',
        };

        if (parentId) {
            options.parent = parentId;
        }

        const channel = await guild.channels.create(options);

        console.log(`[BOT] Created channel #${channel.name} in ${guild.name}`);
        return {
            success: true,
            channel: { id: channel.id, name: channel.name, type: channelType },
        };
    } catch (err) {
        console.error('[BOT] Error creating channel:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Delete a channel
 */
async function deleteChannel(guildId, channelId) {
    try {
        const guild = await getGuild(guildId);
        const channel = await guild.channels.fetch(channelId);
        if (!channel) return { success: false, error: 'Channel not found' };

        const name = channel.name;
        await channel.delete('Deleted by Setcord dashboard');

        console.log(`[BOT] Deleted channel #${name} in ${guild.name}`);
        return { success: true };
    } catch (err) {
        console.error('[BOT] Error deleting channel:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Rename a channel
 */
async function renameChannel(guildId, channelId, newName) {
    try {
        const guild = await getGuild(guildId);
        const channel = await guild.channels.fetch(channelId);
        if (!channel) return { success: false, error: 'Channel not found' };

        await channel.setName(newName, 'Renamed by Setcord dashboard');

        console.log(`[BOT] Renamed channel to #${newName} in ${guild.name}`);
        return { success: true, channel: { id: channel.id, name: newName } };
    } catch (err) {
        console.error('[BOT] Error renaming channel:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Create a category
 */
async function createCategory(guildId, categoryName) {
    try {
        const guild = await getGuild(guildId);

        const category = await guild.channels.create({
            name: categoryName,
            type: ChannelType.GuildCategory,
            reason: 'Created by Setcord dashboard',
        });

        console.log(`[BOT] Created category "${category.name}" in ${guild.name}`);
        return {
            success: true,
            category: { id: category.id, name: category.name },
        };
    } catch (err) {
        console.error('[BOT] Error creating category:', err.message);
        return { success: false, error: err.message };
    }
}

// ========================
// ROLE OPERATIONS
// ========================

/**
 * Fetch all roles in a guild
 */
async function fetchRoles(guildId) {
    try {
        const guild = await getGuild(guildId);
        const roles = await guild.roles.fetch();

        const roleList = roles
            .filter((r) => !r.managed && r.id !== guild.id) // Exclude bot roles and @everyone
            .sort((a, b) => b.position - a.position)
            .map((r) => ({
                id: r.id,
                name: r.name,
                color: r.hexColor,
                position: r.position,
                memberCount: r.members.size,
            }));

        return { success: true, roles: roleList };
    } catch (err) {
        console.error('[BOT] Error fetching roles:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Create a role
 */
async function createRole(guildId, name, color) {
    try {
        const guild = await getGuild(guildId);

        const role = await guild.roles.create({
            name: name,
            color: color || '#99AAB5',
            reason: 'Created by Setcord dashboard',
        });

        console.log(`[BOT] Created role "${role.name}" in ${guild.name}`);
        return {
            success: true,
            role: { id: role.id, name: role.name, color: role.hexColor },
        };
    } catch (err) {
        console.error('[BOT] Error creating role:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Delete a role
 */
async function deleteRole(guildId, roleId) {
    try {
        const guild = await getGuild(guildId);
        const role = await guild.roles.fetch(roleId);
        if (!role) return { success: false, error: 'Role not found' };

        const name = role.name;
        await role.delete('Deleted by Setcord dashboard');

        console.log(`[BOT] Deleted role "${name}" in ${guild.name}`);
        return { success: true };
    } catch (err) {
        console.error('[BOT] Error deleting role:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Edit a role (name and/or color)
 */
async function editRole(guildId, roleId, updates) {
    try {
        const guild = await getGuild(guildId);
        const role = await guild.roles.fetch(roleId);
        if (!role) return { success: false, error: 'Role not found' };

        const editData = { reason: 'Edited by Setcord dashboard' };
        if (updates.name) editData.name = updates.name;
        if (updates.color) editData.color = updates.color;

        await role.edit(editData);

        console.log(`[BOT] Edited role "${role.name}" in ${guild.name}`);
        return {
            success: true,
            role: { id: role.id, name: role.name, color: role.hexColor },
        };
    } catch (err) {
        console.error('[BOT] Error editing role:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Check if the bot is in a specific guild
 */
function isBotInGuild(guildId) {
    if (!isReady) return false;
    return client.guilds.cache.has(guildId);
}

/**
 * Get basic guild info for dashboard header
 */
async function getGuildInfo(guildId) {
    try {
        const guild = await getGuild(guildId);
        return {
            success: true,
            guild: {
                id: guild.id,
                name: guild.name,
                icon: guild.iconURL({ size: 64 }),
                memberCount: guild.memberCount,
            },
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    client,
    startBot,
    isBotInGuild,
    getGuildInfo,
    // Channels
    fetchChannels,
    createChannel,
    deleteChannel,
    renameChannel,
    createCategory,
    // Roles
    fetchRoles,
    createRole,
    deleteRole,
    editRole,
};
