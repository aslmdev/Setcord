/**
 * Authentication middleware
 * Checks if the user has a valid session with Discord access token
 */
function requireAuth(req, res, next) {
    if (req.session && req.session.user && req.session.accessToken) {
        return next();
    }
    return res.redirect('/login');
}

module.exports = { requireAuth };
