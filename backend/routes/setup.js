const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { requireGuildAdmin } = require('../middleware/guild');
const bot = require('../../bot/executor');

const TEMPLATES_PATH = path.join(__dirname, '../../data/setup-templates.json');

function loadTemplates() {
    const raw = fs.readFileSync(TEMPLATES_PATH, 'utf8');
    return JSON.parse(raw);
}

/**
 * GET /setup/templates
 * Return all templates from JSON
 */
router.get('/templates', (req, res) => {
    try {
        const data = loadTemplates();
        res.json({ success: true, templates: data.templates });
    } catch (err) {
        console.error('[SETUP] Failed to load templates:', err.message);
        res.status(500).json({ success: false, error: 'Failed to load templates' });
    }
});

/**
 * POST /setup/:guildId/apply
 * Apply a setup template (create category + channels)
 * Body: {
 *   templateId: string,
 *   styleId: string,
 *   channels: [{ name, type }],   // may be edited by user
 *   categoryName: string | null
 * }
 */
router.post('/:guildId/apply', requireGuildAdmin, async (req, res) => {
    const { templateId, styleId, channels, categoryName } = req.body;

    if (!Array.isArray(channels) || channels.length === 0) {
        return res.status(400).json({ success: false, error: 'No channels provided' });
    }

    // Validate each channel
    for (const ch of channels) {
        if (!ch.name || typeof ch.name !== 'string' || ch.name.trim().length === 0)
            return res.status(400).json({ success: false, error: 'All channels must have a name' });
        if (ch.name.trim().length > 100)
            return res.status(400).json({ success: false, error: `Channel name too long: "${ch.name}"` });
    }

    const results = { created: [], failed: [], categoryId: null };

    try {
        // Step 1: Create category if needed
        if (categoryName && categoryName.trim()) {
            const catResult = await bot.createCategory(req.guildId, categoryName.trim());
            if (catResult.success) {
                results.categoryId = catResult.category.id;
                results.categoryName = catResult.category.name;
            } else {
                return res.status(400).json({
                    success: false,
                    error: `Failed to create category: ${catResult.error}`
                });
            }
        }

        // Step 2: Create each channel

        for (const ch of channels) {
            const name = ch.name.trim();
            const VALID_TYPES = ['text', 'voice', 'announcement', 'forum', 'stage'];
            const type = VALID_TYPES.includes(ch.type) ? ch.type : 'text';
            const chResult = await bot.createChannel(req.guildId, name, type, results.categoryId);

            if (chResult.success) {
                results.created.push({ name: chResult.channel.name, type });
            } else {
                results.failed.push({ name, error: chResult.error });
            }
        }

        console.log(`[SETUP] Applied template "${templateId}/${styleId}" for guild ${req.guildId}. Created: ${results.created.length}, Failed: ${results.failed.length}`);

        res.json({
            success: true,
            created: results.created,
            failed: results.failed,
            categoryName: results.categoryName || null,
        });
    } catch (err) {
        console.error('[SETUP] Error applying template:', err.message);
        res.status(500).json({ success: false, error: 'An unexpected error occurred during setup' });
    }
});

module.exports = router;