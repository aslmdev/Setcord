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

async function startBot(token) {
    try {
        await client.login(token);
    } catch (err) {
        console.error('[BOT] Failed to login:', err.message);
        process.exit(1);
    }
}

function checkReady() {
    if (!isReady) throw new Error('Bot is not ready yet');
}

async function getGuild(guildId) {
    checkReady();
    const guild = await client.guilds.fetch(guildId);
    if (!guild) throw new Error('Bot is not in this server');
    return guild;
}

// ---- Bot permission helpers ----

function getBotHighestRolePosition(guild) {
    const botMember = guild.members.cache.get(client.user.id);
    if (!botMember) return 0;
    return botMember.roles.highest.position;
}

function canBotManageRole(guild, role) {
    const botHighest = getBotHighestRolePosition(guild);
    return role.position < botHighest;
}

function buildPermissionError(guild, role) {
    const botHighest = getBotHighestRolePosition(guild);
    return `Bot cannot manage the role "${role.name}" (position ${role.position}) ` +
           `because it is at or above the bot's highest role (position ${botHighest}). ` +
           `To fix this: go to Discord Server Settings → Roles and drag the bot's role above all roles you want Setcord to manage.`;
}

// ========================
// CHANNEL OPERATIONS
// ========================

async function fetchChannels(guildId) {
    try {
        const guild = await getGuild(guildId);
        const channels = await guild.channels.fetch();

        const result = { categories: [], uncategorized: [] };
        const categoryMap = new Map();

        channels.forEach((ch) => {
            if (ch && ch.type === ChannelType.GuildCategory) {
                categoryMap.set(ch.id, {
                    id: ch.id,
                    name: ch.name,
                    position: ch.position,
                    channels: [],
                });
            }
        });

        channels.forEach((ch) => {
            if (!ch || ch.type === ChannelType.GuildCategory) return;
            const channelData = {
                id: ch.id,
                name: ch.name,
                type: ch.type === ChannelType.GuildVoice ? 'voice' :
      ch.type === ChannelType.GuildStageVoice ? 'stage' :
      ch.type === ChannelType.GuildAnnouncement ? 'announcement' :
      ch.type === ChannelType.GuildForum ? 'forum' : 'text',
                position: ch.position,
                parentId: ch.parentId,
            };
            if (ch.parentId && categoryMap.has(ch.parentId)) {
                categoryMap.get(ch.parentId).channels.push(channelData);
            } else {
                result.uncategorized.push(channelData);
            }
        });

        categoryMap.forEach((cat) => { cat.channels.sort((a, b) => a.position - b.position); });
        result.categories = Array.from(categoryMap.values()).sort((a, b) => a.position - b.position);
        result.uncategorized.sort((a, b) => a.position - b.position);

        return { success: true, data: result };
    } catch (err) {
        console.error('[BOT] Error fetching channels:', err.message);
        return { success: false, error: err.message };
    }
}

async function createChannel(guildId, channelName, channelType = 'text', parentId = null) {
    try {
        const guild = await getGuild(guildId);
        // In createChannel — replace the single type line with this switch:
let type;
switch (channelType) {
    case 'voice':        type = ChannelType.GuildVoice; break;
    case 'announcement': type = ChannelType.GuildAnnouncement; break;
    case 'forum':        type = ChannelType.GuildForum; break;
    case 'stage':        type = ChannelType.GuildStageVoice; break;
    default:             type = ChannelType.GuildText;
}
        const options = { name: channelName, type, reason: 'Created by Setcord' };
        if (parentId) options.parent = parentId;
        const channel = await guild.channels.create(options);
        console.log(`[BOT] Created channel #${channel.name} in ${guild.name}`);
        return { success: true, channel: { id: channel.id, name: channel.name, type: channelType } };
    } catch (err) {
        console.error('[BOT] Error creating channel:', err.message);
        return { success: false, error: err.message };
    }
}

async function deleteChannel(guildId, channelId) {
    try {
        const guild = await getGuild(guildId);
        const channel = await guild.channels.fetch(channelId);
        if (!channel) return { success: false, error: 'Channel not found' };
        await channel.delete('Deleted by Setcord');
        return { success: true };
    } catch (err) {
        console.error('[BOT] Error deleting channel:', err.message);
        return { success: false, error: err.message };
    }
}

async function renameChannel(guildId, channelId, newName) {
    try {
        const guild = await getGuild(guildId);
        const channel = await guild.channels.fetch(channelId);
        if (!channel) return { success: false, error: 'Channel not found' };
        await channel.setName(newName, 'Renamed by Setcord');
        return { success: true, channel: { id: channel.id, name: newName } };
    } catch (err) {
        console.error('[BOT] Error renaming channel:', err.message);
        return { success: false, error: err.message };
    }
}

async function moveChannelToCategory(guildId, channelId, parentId) {
    try {
        const guild = await getGuild(guildId);
        const channel = await guild.channels.fetch(channelId);
        if (!channel) return { success: false, error: 'Channel not found' };
        await channel.setParent(parentId, { lockPermissions: false, reason: 'Moved by Setcord' });
        return { success: true, channel: { id: channel.id, name: channel.name } };
    } catch (err) {
        console.error('[BOT] Error moving channel:', err.message);
        return { success: false, error: err.message };
    }
}

async function createCategory(guildId, categoryName) {
    try {
        const guild = await getGuild(guildId);
        const category = await guild.channels.create({
            name: categoryName,
            type: ChannelType.GuildCategory,
            reason: 'Created by Setcord',
        });
        return { success: true, category: { id: category.id, name: category.name } };
    } catch (err) {
        console.error('[BOT] Error creating category:', err.message);
        return { success: false, error: err.message };
    }
}

// positions: [{ channel: channelId, position: number }, ...]
async function reorderChannels(guildId, positions) {
    try {
        const guild = await getGuild(guildId);
        await guild.channels.setPositions(positions);
        return { success: true };
    } catch (err) {
        console.error('[BOT] Error reordering channels:', err.message);
        return { success: false, error: err.message };
    }
}

// ========================
// ROLE OPERATIONS
// ========================

async function fetchRoles(guildId) {
    try {
        const guild = await getGuild(guildId);
        await guild.members.fetch(client.user.id).catch(() => null);

        const roles = await guild.roles.fetch();
        const botHighestPosition = getBotHighestRolePosition(guild);

        const roleList = roles
            .filter((r) => r.id !== guild.id)
            .sort((a, b) => b.position - a.position)
            .map((r) => ({
                id: r.id,
                name: r.name,
                color: r.hexColor,
                position: r.position,
                managed: r.managed,
                isAboveBot: r.position >= botHighestPosition,
                canManage: r.position < botHighestPosition,
                memberCount: r.members?.size ?? 0,
            }));

        return {
            success: true,
            roles: roleList,
            botHighestPosition,
        };
    } catch (err) {
        console.error('[BOT] Error fetching roles:', err.message);
        return { success: false, error: err.message };
    }
}

async function createRole(guildId, name, color) {
    try {
        const guild = await getGuild(guildId);
        const role = await guild.roles.create({
            name,
            color: color || '#99AAB5',
            reason: 'Created by Setcord',
        });
        console.log(`[BOT] Created role "${role.name}" in ${guild.name}`);
        return { success: true, role: { id: role.id, name: role.name, color: role.hexColor } };
    } catch (err) {
        console.error('[BOT] Error creating role:', err.message);
        return { success: false, error: err.message };
    }
}

async function deleteRole(guildId, roleId) {
    try {
        const guild = await getGuild(guildId);
        await guild.members.fetch(client.user.id).catch(() => null);
        const role = await guild.roles.fetch(roleId);
        if (!role) return { success: false, error: 'Role not found' };

        if (!canBotManageRole(guild, role)) {
            return { success: false, error: buildPermissionError(guild, role) };
        }

        await role.delete('Deleted by Setcord');
        console.log(`[BOT] Deleted role "${role.name}" in ${guild.name}`);
        return { success: true };
    } catch (err) {
        console.error('[BOT] Error deleting role:', err.message);
        return { success: false, error: err.message };
    }
}

async function editRole(guildId, roleId, updates) {
    try {
        const guild = await getGuild(guildId);
        await guild.members.fetch(client.user.id).catch(() => null);
        const role = await guild.roles.fetch(roleId);
        if (!role) return { success: false, error: 'Role not found' };

        if (!canBotManageRole(guild, role)) {
            return { success: false, error: buildPermissionError(guild, role) };
        }

        const editData = { reason: 'Edited by Setcord' };
        if (updates.name) editData.name = updates.name;
        if (updates.color) editData.color = updates.color;
        await role.edit(editData);

        console.log(`[BOT] Edited role "${role.name}" in ${guild.name}`);
        return { success: true, role: { id: role.id, name: role.name, color: role.hexColor } };
    } catch (err) {
        console.error('[BOT] Error editing role:', err.message);
        return { success: false, error: err.message };
    }
}

// positions: [{ role: roleId, position: number }, ...]
async function reorderRoles(guildId, positions) {
    try {
        const guild = await getGuild(guildId);
        await guild.roles.setPositions(positions);
        return { success: true };
    } catch (err) {
        console.error('[BOT] Error reordering roles:', err.message);
        return { success: false, error: err.message };
    }
}

function isBotInGuild(guildId) {
    if (!isReady) return false;
    return client.guilds.cache.has(guildId);
}

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
    fetchChannels,
    createChannel,
    deleteChannel,
    renameChannel,
    moveChannelToCategory,
    createCategory,
    reorderChannels,
    fetchRoles,
    createRole,
    deleteRole,
    editRole,
    reorderRoles,
};