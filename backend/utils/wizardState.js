const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, '../../data/wizard-state.json');

function loadWizardState() {
    try {
        if (!fs.existsSync(STATE_PATH)) return {};
        return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    } catch { return {}; }
}

function saveWizardState(state) {
    try { fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2)); } catch { }
}

function isWizardComplete(guildId) {
    return loadWizardState()[guildId]?.complete === true;
}

function markWizardComplete(guildId, extra = {}) {
    const state = loadWizardState();
    state[guildId] = { complete: true, completedAt: new Date().toISOString(), ...extra };
    saveWizardState(state);
}

function markWizardNeeded(guildId) {
    const state = loadWizardState();
    if (!state[guildId]) {
        state[guildId] = { complete: false, joinedAt: new Date().toISOString() };
        saveWizardState(state);
    }
}

function preMarkExistingGuilds(guildsCache) {
    const state = loadWizardState();
    let changed = false;
    for (const [guildId] of guildsCache) {
        if (!state[guildId]) {
            state[guildId] = { complete: true, completedAt: new Date().toISOString(), existingGuild: true };
            changed = true;
        }
    }
    if (changed) saveWizardState(state);
}

module.exports = { loadWizardState, isWizardComplete, markWizardComplete, markWizardNeeded, preMarkExistingGuilds };