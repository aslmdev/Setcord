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
});  // ← close generate route هنا

// ── Apply structure ──
router.post('/:guildId/apply', requireGuildAdmin, async (req, res) => {
    const { structure, clearExisting } = req.body;
    if (!structure) return res.json({ success: false, error: 'No structure provided' });

    try {
        const guildId = req.guildId;
        const log = [];

        if (clearExisting?.channels) {
            const delChResult = await bot.deleteAllChannels(guildId);
            log.push({ type: 'clear', name: 'Cleared all channels', success: delChResult.success, error: delChResult.error });
        }
        if (clearExisting?.roles) {
            const delRoResult = await bot.deleteAllRoles(guildId);
            log.push({ type: 'clear', name: 'Cleared all roles', success: delRoResult.success, error: delRoResult.error });
        }

        if (structure.settings?.description) {
            await bot.editGuildGeneral(guildId, { description: structure.settings.description }).catch(() => { });
        }

        for (const role of (structure.roles || [])) {
            const r = await bot.createRole(guildId, role.name, role.color || null);
            log.push({ type: 'role', name: role.name, success: r.success, error: r.error });
        }

        for (const cat of (structure.categories || [])) {
            const catResult = await bot.createCategory(guildId, cat.name);
            if (!catResult.success) {
                log.push({ type: 'category', name: cat.name, success: false, error: catResult.error });
                continue;
            }
            log.push({ type: 'category', name: cat.name, success: true });

            for (const ch of (cat.channels || [])) {
                const typeMap = { 0: 'text', 2: 'voice', 5: 'announcement', 15: 'forum', 13: 'stage' };
                const chType = typeMap[ch.type] || 'text';
                const chResult = await bot.createChannel(guildId, ch.name, chType, catResult.category.id);
                log.push({ type: 'channel', name: ch.name, success: chResult.success, error: chResult.error });
            }
        }

        markWizardComplete(guildId);
        const created = log.filter(l => l.success).length;
        const failed = log.filter(l => !l.success).length;
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
        modern: 'Use clean lowercase hyphenated names. Categories in UPPERCASE.',
        emoji: 'Add emoji prefix with ・ separator. Example: "💬・general", "📢・announcements"',
        official: 'Use Title Case professional names. Example: "General Discussion", "Staff Announcements"',
        simple: 'Short clean names, maximum 3 channels per category',
        arabic: 'Use Arabic names for ALL channels, categories and roles.'
    };

    const roleGuides = {
        simple: '3-5 roles: Admin, Moderator, Member, Bot',
        standard: '8-12 roles with clear hierarchy and vibrant distinct colors.',
        detailed: '15-20 roles with full hierarchy',
        corporate: `Generate modern corporate hierarchy. Use titles like: Founder, CEO, COO, CFO, CTO, Head of Operations, Senior Manager, Manager, Supervisor, Lead Staff, Staff, Senior Member, VIP, Member, New Member. Colors should go from gold/red at top to grey at bottom. NO "Owner" or "Co-Owner" — these are outdated.`,
        military: 'Military ranks: General, Colonel, Major, Captain, Lieutenant, Sergeant, Corporal, Private',
        arabic_corporate: 'Arabic corporate: المؤسس، المدير التنفيذي، مدير العمليات، المشرف العام، المشرف، المساعد، العضو المميز، العضو',
        none: 'Return empty roles array: []'
    };

    const features = a.features || [];
    const featureLines = [
        features.includes('welcome') && '- A WELCOME category: rules, announcements, server-info, roles-info',
        features.includes('logs') && '- A STAFF LOGS category: mod-logs, message-logs, join-leave-logs, staff-chat',
        features.includes('afk') && '- An AFK voice channel',
        features.includes('tickets') && '- A SUPPORT category: open-ticket channel with instructions, ticket-logs',
        features.includes('media') && '- A MEDIA category: memes, screenshots, art',
        features.includes('bot') && '- A BOTS category: bot-commands, music channels',
        features.includes('shop') && '- A SHOP category: products, orders, reviews, buyers-only channels',
        features.includes('voice') && '- Multiple voice channels: General Voice, Music, AFK, Private',
    ].filter(Boolean).join('\n');

    const sizeGuide = {
        small: 'Keep it simple, 3-4 categories max, 15 channels total max',
        medium: '5-7 categories, up to 30 channels',
        large: '7-10 categories, up to 50 channels, detailed structure'
    };

    const modGuide = {
        strict: 'Add a dedicated moderation category with clear rules channel. Mention strict moderation in server description.',
        moderate: 'Standard moderation setup.',
        relaxed: 'Casual setup, fewer formal channels, focus on fun and chat.'
    };

    return `You are an expert Discord server architect. Generate an optimal server structure.

SERVER DETAILS:
- Name: ${a.serverName}
- Type: ${a.serverType}
- Primary Language: ${a.language || 'English'}
- Expected Size: ${a.serverSize || 'medium'} — ${sizeGuide[a.serverSize] || sizeGuide.medium}
- Moderation Level: ${a.modLevel || 'moderate'} — ${modGuide[a.modLevel] || modGuide.moderate}
- Description: ${a.description || 'Not specified'}

CHANNEL STYLE: ${a.channelStyle} — ${styleGuides[a.channelStyle] || styleGuides.modern}
Apply this style CONSISTENTLY to EVERY channel and category name.

ROLE STYLE: ${a.roleStyle || a.roleComplexity} — ${roleGuides[a.roleStyle || a.roleComplexity] || roleGuides.standard}
Each role must have a unique vibrant hex color matching its rank.
${(a.roleStyle === 'corporate' || a.roleStyle === 'arabic_corporate') ? 'IMPORTANT: Do NOT use "Owner" or "Co-Owner". Use modern corporate titles.' : ''}

REQUIRED FEATURES:
${featureLines || '- Standard setup'}

EXTRA INSTRUCTIONS (highest priority — follow exactly):
${a.extraNotes || 'None'}

OUTPUT FORMAT — ONLY valid JSON, no other text:
{
  "categories": [
    {
      "name": "CATEGORY NAME",
      "channels": [
        { "name": "channel-name", "type": 0 },
        { "name": "Voice Channel", "type": 2 }
      ]
    }
  ],
  "roles": [
    { "name": "Role Name", "color": "#HEX" }
  ],
  "settings": {
    "description": "Short catchy server description"
  }
}

RULES:
- type 0=text, 2=voice, 5=announcement, 15=forum, 13=stage
- No duplicate channel names
- Make structure feel custom-built for THIS specific server`;
}

module.exports = router;