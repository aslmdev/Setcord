const express = require('express');
const axios = require('axios');
const router = express.Router();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const DISCORD_API = 'https://discord.com/api/v10';

router.get('/discord', (req, res) => {
    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'identify guilds',
    });
    res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

router.get('/discord/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/login?error=no_code');

    try {
        const tokenResponse = await axios.post(
            `${DISCORD_API}/oauth2/token`,
            new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: REDIRECT_URI,
            }).toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { access_token, token_type } = tokenResponse.data;

        const userResponse = await axios.get(`${DISCORD_API}/users/@me`, {
            headers: { Authorization: `${token_type} ${access_token}` },
        });

        const user = userResponse.data;

        req.session.accessToken = access_token;
        req.session.tokenType = token_type;
        req.session.user = {
            id: user.id,
            username: user.username,
            discriminator: user.discriminator,
            avatar: user.avatar,
            globalName: user.global_name,
        };

        // Clear ALL stale caches from any previous session
        delete req.session.serversCache;
        delete req.session.serversCacheTime;
        delete req.session.guildsWithPermsCache;
        delete req.session.guildsWithPermsCacheTime;

        console.log(`[AUTH] User logged in: ${user.username} (${user.id})`);
        res.redirect('/servers');
    } catch (err) {
        console.error('[AUTH] OAuth callback error:', err.response?.data || err.message);
        res.redirect('/login?error=auth_failed');
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error('[AUTH] Session destroy error:', err);
        res.redirect('/login');
    });
});

module.exports = router;