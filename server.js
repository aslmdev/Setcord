require('dotenv').config();

const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
const fs = require('fs');

const { startBot, getGuildInfo, isBotInGuild } = require('./bot/executor');
const { requireAuth } = require('./backend/middleware/auth');
const authRoutes = require('./backend/routes/auth');
const apiRoutes = require('./backend/routes/api');
const setupRoutes = require('./backend/routes/setup');

const wizardRoutes = require('./backend/routes/wizard');
const { isWizardComplete } = require('./backend/utils/wizardState');

process.on('uncaughtException', function (err) {
    console.error('\x1b[31m[CRASH] Uncaught Exception:\x1b[0m', err);
});

process.on('unhandledRejection', function (reason, promise) {
    console.error('\x1b[31m[CRASH] Unhandled Rejection:\x1b[0m', reason);
});

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure sessions directory exists
const sessionsDir = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'frontend', 'public')));

// Persistent session store — survives server restarts
// rolling: true — extends session on every request
// ttl: 30 days
app.use(session({
    store: new FileStore({
        path: sessionsDir,
        ttl: 30 * 24 * 60 * 60,   // 30 days in seconds
        reapInterval: 60 * 60,      // clean up expired sessions every hour
        logFn: function () { },        // suppress noisy file-store logs
    }),
    secret: process.env.SESSION_SECRET || 'setcord-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    rolling: true,                  // reset expiry on every request
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,  // 30 days in ms
    },
}));

// ---- Request logger (so terminal isn't empty) ----
app.use(function (req, res, next) {
    var start = Date.now();
    res.on('finish', function () {
        var ms = Date.now() - start;
        var color = res.statusCode >= 400 ? '\x1b[31m' : '\x1b[32m';
        console.log(color + '[HTTP] ' + req.method + ' ' + req.url + ' → ' + res.statusCode + ' (' + ms + 'ms)\x1b[0m');
    });
    next();
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'frontend', 'pages'));

// ---- Routes ----

app.get('/', (req, res) => {
    if (req.session && req.session.user) return res.redirect('/servers');
    res.render('home');
});

app.get('/login', (req, res) => {
    if (req.session && req.session.user) return res.redirect('/servers');
    res.render('login', { error: req.query.error || null });
});

app.use('/auth', authRoutes);

app.get('/servers', requireAuth, (req, res) => {
    res.render('servers', { user: req.session.user, clientId: process.env.CLIENT_ID });
});

app.get('/dashboard/:guildId', requireAuth, (req, res) => {
    res.redirect(`/dashboard/${req.params.guildId}/channels`);
});

app.get('/dashboard/:guildId/channels', requireAuth, async (req, res) => {
    try {
        const guildId = req.params.guildId;
        if (!isBotInGuild(guildId)) return res.redirect('/servers');
        if (!isWizardComplete(guildId)) return res.redirect(`/dashboard/${guildId}/wizard`);
        const result = await getGuildInfo(guildId);
        if (!result.success) return res.redirect('/servers');
        res.render('channels', { user: req.session.user, guild: result.guild });
    } catch (err) {
        console.error('[ROUTE ERROR] /channels:', err);
        res.status(500).send('Something went wrong: ' + err.message);
    }
});

app.get('/dashboard/:guildId/roles', requireAuth, async (req, res) => {
    try {
        const guildId = req.params.guildId;
        if (!isBotInGuild(guildId)) return res.redirect('/servers');
        const result = await getGuildInfo(guildId);
        if (!result.success) return res.redirect('/servers');
        res.render('roles', { user: req.session.user, guild: result.guild });
    } catch (err) {
        console.error('[ROUTE ERROR] /roles:', err);
        res.status(500).send('Something went wrong: ' + err.message);
    }
});

app.get('/dashboard/:guildId/setup', requireAuth, async (req, res) => {
    const guildId = req.params.guildId;
    if (!isBotInGuild(guildId)) return res.redirect('/servers');
    const result = await getGuildInfo(guildId);
    if (!result.success) return res.redirect('/servers');
    res.render('setup', { user: req.session.user, guild: result.guild });
});

app.get('/dashboard/:guildId/settings', requireAuth, async (req, res) => {
    try {
        const guildId = req.params.guildId;
        if (!isBotInGuild(guildId)) return res.redirect('/servers');
        const result = await getGuildInfo(guildId);
        if (!result.success) return res.redirect('/servers');
        const guild = result.guild;
        res.render('settings', {
            user: req.session.user,
            guild: {
                id: guild.id,
                name: guild.name,
                icon: guild.icon,
                hasCommunity: guild.features ? guild.features.includes('COMMUNITY') : false,
                verificationLevel: guild.verificationLevel || 0,
                explicitContentFilter: guild.explicitContentFilter || 0,
                defaultMessageNotifications: guild.defaultMessageNotifications || 0
            }
        });
    } catch (err) {
        console.error('[ROUTE ERROR] /settings:', err);
        res.status(500).send('Something went wrong: ' + err.message);
    }
});

app.get('/dashboard', requireAuth, (req, res) => res.redirect('/servers'));
app.use('/api', requireAuth, apiRoutes);
app.use('/setup', requireAuth, setupRoutes);
app.use('/wizard', requireAuth, wizardRoutes);

app.get('/dashboard/:guildId/wizard', requireAuth, async (req, res) => {
    try {
        const guildId = req.params.guildId;
        if (!isBotInGuild(guildId)) return res.redirect('/servers');
        if (isWizardComplete(guildId)) return res.redirect(`/dashboard/${guildId}/channels`);
        const result = await getGuildInfo(guildId);
        if (!result.success) return res.redirect('/servers');
        res.render('wizard', { user: req.session.user, guild: result.guild });
    } catch (err) {
        console.error('[ROUTE ERROR] /wizard:', err);
        res.redirect('/servers');
    }
});

// ---- Start ----
async function start() {
    console.log('[SERVER] Starting Discord bot...');
    await startBot(process.env.BOT_TOKEN);
    app.listen(PORT, () => {
        console.log(`[SERVER] Setcord running at http://localhost:${PORT}`);
    });
}

start().catch((err) => {
    console.error('[SERVER] Failed to start:', err);
    process.exit(1);
});
