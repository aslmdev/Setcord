const express = require('express');
const router = express.Router();
const axios = require('axios');
const { requireGuildAdmin } = require('../middleware/guild');
const { markWizardComplete, isWizardComplete } = require('../utils/wizardState');
const bot = require('../../bot/executor');

// ── Status check ──
router.get('/:guildId/status', (req, res) => {
    res.json({ needsWizard: !isWizardComplete(req.params.guildId) });
});

// ── AI Generation ──
router.post('/:guildId/generate', requireGuildAdmin, async (req, res) => {
    const { answers } = req.body;
    if (!answers) return res.json({ success: false, error: 'No answers provided' });

    const systemPrompt = `You are a Discord server structure generator. You must respond ONLY with valid JSON, absolutely no other text, no markdown, no code blocks.`;

    const userPrompt = buildPrompt(answers);

    try {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'llama-3.3-70b-versatile',
                max_tokens: 2500,
                temperature: 0.7,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ]
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
                },
                timeout: 30000
            }
        );

        const rawText = response.data.choices[0].message.content.trim();
        console.log('[WIZARD] Groq raw response:', rawText);

        const structure = JSON.parse(rawText);
        res.json({ success: true, structure: structure });

    } catch (err) {
        console.error('[WIZARD] Groq error:', err.response?.data || err.message);
        res.json({ success: false, error: err.message });
    }

    // ── Apply structure ──
    router.post('/:guildId/apply', requireGuildAdmin, async (req, res) => {
        const { structure, clearExisting } = req.body;
        if (!structure) return res.json({ success: false, error: 'No structure provided' });

        try {
            const guildId = req.params.guildId; // ← الفيكس الأساسي

            const log = [];

            // ── Clear existing if requested ──
            if (clearExisting?.channels) {
                const delChResult = await bot.deleteAllChannels(guildId);
                log.push({ type: 'clear', name: 'Cleared all channels', success: delChResult.success, error: delChResult.error });
            }
            if (clearExisting?.roles) {
                const delRoResult = await bot.deleteAllRoles(guildId);
                log.push({ type: 'clear', name: 'Cleared all roles', success: delRoResult.success, error: delRoResult.error });
            }

            // ── Apply settings ──
            if (structure.settings?.description) {
                await bot.editGuildGeneral(guildId, { description: structure.settings.description }).catch(() => { });
            }

            // ── Create roles ──
            for (const role of (structure.roles || [])) {
                const r = await bot.createRole(guildId, role.name, role.color || null);
                log.push({ type: 'role', name: role.name, success: r.success, error: r.error });
            }

            // ── Create categories + channels ──
            for (const cat of (structure.categories || [])) {
                const catResult = await bot.createCategory(guildId, cat.name);
                if (!catResult.success) {
                    log.push({ type: 'category', name: cat.name, success: false, error: catResult.error });
                    continue;
                }
                log.push({ type: 'category', name: cat.name, success: true });

                for (const ch of (cat.channels || [])) {
                    const typeMap = { 0: 'text', 2: 'voice', 5: 'announcement', 15: 'forum' };
                    const chType = typeMap[ch.type] || 'text';
                    const chResult = await bot.createChannel(guildId, ch.name, chType, catResult.category.id);
                    log.push({ type: 'channel', name: ch.name, success: chResult.success, error: chResult.error });
                }
            }

            markWizardComplete(guildId);

            const created = log.filter(l => l.success).length;
            const failed = log.filter(l => !l.success).length;
            console.log(`[WIZARD] Applied for ${guildId}: ${created} created, ${failed} failed`);

            res.json({ success: true, log, created, failed });
        } catch (err) {
            console.error('[WIZARD] Apply error:', err.message);
            res.json({ success: false, error: err.message });
        }
    });

    // ── Skip wizard ──
    router.post('/:guildId/skip', (req, res) => {
        markWizardComplete(req.params.guildId, { skipped: true });
        res.json({ success: true });
    });

    // ── Build AI prompt ──
    function buildPrompt(a) {
        const styleGuides = {
            modern: 'Use clean lowercase hyphenated names. Categories in UPPERCASE. Example channels: "general-chat", "announcements", "off-topic", "bot-commands"',
            emoji: 'Add emoji prefix with ・ separator. Example: "💬・general", "📢・announcements", "🎮・gaming", "🔊・voice-lounge". Match emoji to channel purpose.',
            official: 'Use Title Case professional names. Example: "General Discussion", "Staff Announcements", "Support Desk", "Member Lounge"',
            simple: 'Use short clean names, maximum 3 channels per category, keep it minimal',
            arabic: 'Use Arabic names for ALL channels, categories and roles. Example: "عام", "الإعلانات", "الدردشة-العامة"'
        };
        const roleGuides = {
            simple: '3-5 roles only: Owner, Admin, Moderator, Member, Bot',
            standard: '8-12 roles with clear hierarchy: ownership > staff > special > members. Use vibrant distinct colors.',
            detailed: '15-20 roles: full staff tree (Owner, Co-Owner, Head Admin, Admin, Sr.Mod, Mod, Helper, Trial-Mod) + member levels (VIP, Booster, Active, Member, New) + special roles',
            none: 'Return an empty roles array: []'
        };
        const features = a.features || [];
        const featureLines = [
            features.includes('welcome') && '- A WELCOME category: rules, announcements, server-info, roles-info channels',
            features.includes('logs') && '- A STAFF/LOGS category: mod-logs, message-logs, join-leave-logs, staff-chat channels',
            features.includes('afk') && '- An AFK voice channel inside the voice category',
            features.includes('tickets') && '- A SUPPORT/TICKETS category: open-ticket, ticket-logs channels',
            features.includes('media') && '- A MEDIA category: memes, screenshots, fan-art, videos channels',
            features.includes('bot') && '- A BOTS category: bot-commands, music-bot channels',
        ].filter(Boolean).join('\n');

        return `You are an expert Discord server architect. Generate an optimal server structure based on these exact requirements:

SERVER DETAILS:
- Name: ${a.serverName}
- Type: ${a.serverType} server
- Description: ${a.description || 'Not specified'}

STYLE REQUIREMENTS:
- Channel naming style: ${a.channelStyle} — ${styleGuides[a.channelStyle] || styleGuides.modern}
- Apply this style CONSISTENTLY to every single channel and category name

ROLE REQUIREMENTS:
- Complexity: ${a.roleComplexity} — ${roleGuides[a.roleComplexity] || roleGuides.standard}
- Each role must have a unique vibrant hex color that matches its rank/purpose
- Order roles from highest to lowest rank

REQUIRED FEATURES:
${featureLines || '- Standard setup, no special features'}

CUSTOM INSTRUCTIONS (follow these EXACTLY and prioritize them):
${a.extraNotes || 'None — use your best judgment for this server type'}

OUTPUT FORMAT — return ONLY this JSON structure, no other text:
{
  "categories": [
    {
      "name": "CATEGORY NAME",
      "channels": [
        { "name": "channel-name", "type": 0 },
        { "name": "Voice Channel Name", "type": 2 }
      ]
    }
  ],
  "roles": [
    { "name": "Role Name", "color": "#HEX" }
  ],
  "settings": {
    "description": "A short catchy server description based on the server info"
  }
}

STRICT RULES:
- type 0 = text channel, type 2 = voice channel, type 5 = announcement channel
- Generate 4-7 categories with 2-6 channels each
- NO duplicate channel names
- Apply the custom instructions above even if they conflict with defaults
- Make the structure feel tailor-made for THIS specific server, not generic`;
    }});

module.exports = router;