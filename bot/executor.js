const { Client, GatewayIntentBits, ChannelType, Events } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
    ],
    rest: {
        timeout: 30000,
        retries: 3,
    },
});

let isReady = false;

client.once(Events.ClientReady, () => {
    console.log(`[BOT] Logged in as ${client.user.tag}`);
    isReady = true;
});

// ========================
// GUILD JOIN — Welcome Message
// ========================

client.on(Events.GuildCreate, async (guild) => {
    try {
        const fullGuild = await guild.fetch();
        await fullGuild.members.fetch(client.user.id).catch(() => null);

        const dashboardUrl = process.env.DASHBOARD_URL || `http://localhost:${process.env.PORT || 3000}`;

        let targetChannel = fullGuild.systemChannel;

        if (!targetChannel || !targetChannel.permissionsFor(fullGuild.members.me)?.has('SendMessages')) {
            targetChannel = fullGuild.channels.cache.find(
                ch => ch.type === ChannelType.GuildText &&
                    ch.permissionsFor(fullGuild.members.me)?.has('SendMessages') &&
                    ch.permissionsFor(fullGuild.members.me)?.has('ViewChannel')
            ) || null;
        }

        if (!targetChannel) {
            console.log(`[BOT] No suitable channel found in ${fullGuild.name} to send welcome message`);
            return;
        }

        await targetChannel.send({
            flags: 1 << 15,
            components: [
                {
                    type: 17,
                    accent_color: 0x7c3aed,
                    components: [
                        {
                            type: 9,
                            components: [
                                {
                                    type: 10,
                                    content: `# 👋 Setcord has arrived!\nThanks for adding me to **${fullGuild.name}**. Your server management dashboard is ready.`,
                                }
                            ],
                            accessory: {
                                type: 11,
                                media: { url: client.user.displayAvatarURL({ size: 128 }) }
                            }
                        },
                        { type: 14, divider: true, spacing: 1 },
                        {
                            type: 10,
                            content: `## What Setcord can do for you\n` +
                                `-# Everything you need to manage your server from a clean web dashboard.\n\n` +
                                `**💬 Channel Manager**\nCreate, rename, delete and organize channels and categories.\n\n` +
                                `**🛡️ Roles Manager**\nBuild your role hierarchy, set colors, and manage permissions.\n\n` +
                                `**⚡ Fast Setup**\nOne-click channel templates in multiple styles.\n\n` +
                                `**🧪 Test Mode**\nQueue up changes and preview them before publishing to Discord.`,
                        },
                        { type: 14, divider: true, spacing: 1 },
                        {
                            type: 9,
                            components: [{ type: 10, content: `**Ready to get started?**\n-# Open the dashboard, select this server, and start managing.` }],
                        },
                        {
                            type: 1,
                            components: [
                                { type: 2, style: 5, label: 'Open Dashboard', url: dashboardUrl, emoji: { name: '🚀' } },
                                { type: 2, style: 5, label: 'Invite Setcord', url: `https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot`, emoji: { name: '➕' } },
                            ],
                        },
                        { type: 10, content: `-# Setcord — Discord Server Management Dashboard` },
                    ],
                },
            ],
        });

        console.log(`[BOT] Sent welcome message in ${fullGuild.name} (#${targetChannel.name})`);
    } catch (err) {
        console.error(`[BOT] Failed to send welcome message in ${guild.name}:`, err.message);
    }
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

async function withRetry(fn, retries = 3, delay = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err) {
            const isTimeout = err.message?.includes('Timeout') || err.code === 'ECONNRESET';
            if (isTimeout && i < retries - 1) {
                console.warn(`[BOT] Timeout, retrying (${i + 1}/${retries})...`);
                await new Promise(r => setTimeout(r, delay));
            } else {
                throw err;
            }
        }
    }
}

async function fetchChannels(guildId) {
    try {
        const guild = await getGuild(guildId);
        await guild.fetch();
        const rulesChannelId = guild.rulesChannelId;
        const publicUpdatesChannelId = guild.publicUpdatesChannelId;

        const channels = await withRetry(() => guild.channels.fetch());

        const result = { categories: [], uncategorized: [] };
        const categoryMap = new Map();

        // ── Step 1: Build category buckets, sorted by rawPosition ──
        [...channels.values()]
            .filter(ch => ch && ch.type === ChannelType.GuildCategory)
            .sort((a, b) => a.rawPosition - b.rawPosition)
            .forEach(ch => {
                categoryMap.set(ch.id, {
                    id: ch.id,
                    name: ch.name,
                    position: ch.rawPosition,
                    channels: [],
                });
            });

        // ── Step 2: Bucket non-category channels, sorted by rawPosition ──
        // Sorting by rawPosition here guarantees text channels inserted before
        // voice channels when they share a category, matching Discord's actual layout.
        [...channels.values()]
            .filter(ch => ch && ch.type !== ChannelType.GuildCategory)
            .sort((a, b) => a.rawPosition - b.rawPosition)
            .forEach(ch => {
                const channelData = {
                    id: ch.id,
                    name: ch.name,
                    type: ch.type === ChannelType.GuildVoice ? 'voice' :
                        ch.type === ChannelType.GuildStageVoice ? 'stage' :
                            ch.type === ChannelType.GuildAnnouncement ? 'announcement' :
                                ch.type === ChannelType.GuildForum ? 'forum' : 'text',
                    position: ch.rawPosition,
                    parentId: ch.parentId,
                    isProtected: ch.id === rulesChannelId || ch.id === publicUpdatesChannelId,
                };
                if (ch.parentId && categoryMap.has(ch.parentId)) {
                    categoryMap.get(ch.parentId).channels.push(channelData);
                } else {
                    result.uncategorized.push(channelData);
                }
            });

        // ── Step 3: Categories are already ordered; channels within each are too ──
        result.categories = [...categoryMap.values()];
        result.uncategorized.sort((a, b) => a.position - b.position);

        return {
            success: true,
            data: result,
            rulesChannelId,
            publicUpdatesChannelId,
        };
    } catch (err) {
        console.error('[BOT] Error fetching channels:', err.message);
        return { success: false, error: err.message };
    }
}

function isVoiceType(type) {
    return type === ChannelType.GuildVoice || type === ChannelType.GuildStageVoice;
}

async function createChannel(guildId, channelName, channelType = 'text', parentId = null) {
    try {
        const guild = await getGuild(guildId);

        // Community check for announcement and stage channels
        const needsCommunity = channelType === 'announcement' || channelType === 'stage';
        if (needsCommunity && !guild.features.includes('COMMUNITY')) {
            return {
                success: false,
                error: channelType === 'announcement'
                    ? 'Announcement channels require Community to be enabled on your server. Go to Discord Server Settings → Enable Community, then try again.'
                    : 'Stage channels require Community to be enabled on your server. Go to Discord Server Settings → Enable Community, then try again.',
            };
        }

        let type;
        switch (channelType) {
            case 'voice': type = ChannelType.GuildVoice; break;
            case 'announcement': type = ChannelType.GuildAnnouncement; break;
            case 'forum': type = ChannelType.GuildForum; break;
            case 'stage': type = ChannelType.GuildStageVoice; break;
            default: type = ChannelType.GuildText;
        }

        const isTextLike = !isVoiceType(type);

        // ── Step 1: Create channel with no position option ──
        // Passing position + parent together triggers "Only one channel can have
        // a parent_id modified at a time". Always create first, reorder after.
        const options = { name: channelName, type, reason: 'Created by Setcord' };
        if (parentId) options.parent = parentId;

        const channel = await guild.channels.create(options);

        // ── Step 2: Bulk-reorder the category so text stays above voice ──
        // We never use setPosition() — it operates on guild-wide absolute slots
        // and produces unpredictable results when mixed with category scope.
        // Instead, fetch all siblings fresh, sort them into the correct order,
        // then issue one setPositions() call with explicit slot numbers.
        if (isTextLike && parentId) {
            try {
                const allChannels = await guild.channels.fetch();

                // All channels in this category (including the new one), sorted by current rawPosition
                const siblings = [...allChannels.values()]
                    .filter(ch => ch && ch.parentId === parentId)
                    .sort((a, b) => a.rawPosition - b.rawPosition);

                const hasVoice = siblings.some(ch => isVoiceType(ch.type));

                if (hasVoice) {
                    // Desired order: all non-voice first (preserving their relative order),
                    // then all voice channels (preserving their relative order).
                    const textGroup  = siblings.filter(ch => !isVoiceType(ch.type));
                    const voiceGroup = siblings.filter(ch =>  isVoiceType(ch.type));
                    const ordered    = [...textGroup, ...voiceGroup];

                    // Use the lowest rawPosition in the category as the base slot,
                    // then assign consecutive integers. This keeps the category's
                    // guild-wide position band intact and avoids collisions.
                    const basePosition = siblings[0].rawPosition;

                    const positionData = ordered.map((ch, i) => ({
                        channel: ch.id,
                        position: basePosition + i,
                    }));

                    // Sequential await — never Promise.all for position updates.
                    await guild.channels.setPositions(positionData);
                }
            } catch (posErr) {
                // Non-fatal: channel was created. Dashboard will show correct order
                // on the next fetch since fetchChannels sorts by rawPosition.
                console.warn('[BOT] Could not reorder category after creation:', posErr.message);
            }
        }

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

        const rulesChannelId = guild.rulesChannelId;
        const publicUpdatesChannelId = guild.publicUpdatesChannelId;

        if (channelId === rulesChannelId || channelId === publicUpdatesChannelId) {
            return {
                success: false,
                error: 'This channel is required by Discord Community and cannot be deleted.',
            };
        }

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

async function reorderChannels(guildId, positions) {
    try {
        const guild = await getGuild(guildId);
        const channels = await withRetry(() => guild.channels.fetch());

        function isVoice(t) { return t === ChannelType.GuildVoice || t === ChannelType.GuildStageVoice; }
        function isText(t) {
            return t === ChannelType.GuildText ||
                t === ChannelType.GuildAnnouncement ||
                (ChannelType.GuildForum !== undefined && t === ChannelType.GuildForum) ||
                (ChannelType.GuildMedia !== undefined && t === ChannelType.GuildMedia);
        }

        // Group channels by parentId to validate each group separately
        const groups = new Map();
        positions.forEach(function (pos) {
            const ch = channels.get(pos.channel);
            if (!ch) return;
            const key = ch.parentId || '__none__';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push({ pos: pos.position, type: ch.type });
        });

        for (const [, group] of groups) {
            group.sort((a, b) => a.pos - b.pos);
            let seenVoice = false;
            for (const item of group) {
                if (isVoice(item.type)) {
                    seenVoice = true;
                } else if (isText(item.type) && seenVoice) {
                    return {
                        success: false,
                        error: 'Invalid order: text channels cannot be placed below voice channels in the same group. Discord does not allow this.',
                    };
                }
            }
        }

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
                features: guild.features,
                hasCommunity: guild.features.includes('COMMUNITY'),
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