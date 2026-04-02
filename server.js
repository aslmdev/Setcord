require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');

const { startBot, getGuildInfo, isBotInGuild } = require('./bot/executor');
const { requireAuth } = require('./backend/middleware/auth');
const authRoutes = require('./backend/routes/auth');
const apiRoutes = require('./backend/routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// -------------------
// Middleware
// -------------------

// Parse JSON bodies
app.use(express.json());

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: false }));

// Static files (CSS, images, etc.)
app.use(express.static(path.join(__dirname, 'frontend', 'public')));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
    },
}));

// -------------------
// View Engine (EJS)
// -------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'frontend', 'pages'));

// -------------------
// Routes
// -------------------

// Login page
app.get('/login', (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect('/servers');
    }
    res.render('login', { error: req.query.error || null });
});

// Auth routes (Discord OAuth)
app.use('/auth', authRoutes);

// Server selection page (protected)
app.get('/servers', requireAuth, (req, res) => {
    res.render('servers', {
        user: req.session.user,
        clientId: process.env.CLIENT_ID,
    });
});

// Dashboard redirect → channels
app.get('/dashboard/:guildId', requireAuth, (req, res) => {
    res.redirect(`/dashboard/${req.params.guildId}/channels`);
});

// Channel Manager page (protected)
app.get('/dashboard/:guildId/channels', requireAuth, async (req, res) => {
    const guildId = req.params.guildId;

    if (!isBotInGuild(guildId)) {
        return res.redirect('/servers');
    }

    const result = await getGuildInfo(guildId);
    if (!result.success) {
        return res.redirect('/servers');
    }

    res.render('channels', {
        user: req.session.user,
        guild: result.guild,
    });
});

// Roles Manager page (protected)
app.get('/dashboard/:guildId/roles', requireAuth, async (req, res) => {
    const guildId = req.params.guildId;

    if (!isBotInGuild(guildId)) {
        return res.redirect('/servers');
    }

    const result = await getGuildInfo(guildId);
    if (!result.success) {
        return res.redirect('/servers');
    }

    res.render('roles', {
        user: req.session.user,
        guild: result.guild,
    });
});

// Old /dashboard redirect
app.get('/dashboard', requireAuth, (req, res) => {
    res.redirect('/servers');
});

// API routes (protected)
app.use('/api', requireAuth, apiRoutes);

// Root redirect
app.get('/', (req, res) => {
    res.redirect('/login');
});

// -------------------
// Start Bot + Server
// -------------------
async function start() {
    console.log('[SERVER] Starting Discord bot...');
    await startBot(process.env.BOT_TOKEN);

    app.listen(PORT, () => {
        console.log(`[SERVER] Setcord is running at http://localhost:${PORT}`);
        console.log(`[SERVER] Login at http://localhost:${PORT}/login`);
    });
}

start().catch((err) => {
    console.error('[SERVER] Failed to start:', err);
    process.exit(1);
});
