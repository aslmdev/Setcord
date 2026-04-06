/* ============================================================
   SETCORD SHARED UTILITIES  v2
   emoji · modal · toast · drag · error parser · TEST MODE
   ============================================================ */

// ========================
// DISCORD ERROR PARSER
// ========================

const DISCORD_ERROR_MESSAGES = {
    10003: 'That channel no longer exists — it may have been deleted on Discord.',
    10011: 'That role no longer exists — it may have been deleted on Discord.',
    10004: 'Bot is not in this server.',
    50001: 'Bot is missing access to this server.',
    50013: 'Bot is missing permissions. Make sure it has Administrator or Manage Channels/Roles.',
    50035: 'Discord rejected the name. Check for disallowed characters, invalid length, or a duplicate name.',
    30013: 'This server has reached the maximum number of channels (500).',
    30015: 'This server has reached the maximum number of roles.',
    50028: 'Invalid emoji or character in the name.',
    429:   "You're being rate limited by Discord. Wait a few seconds and try again.",
};

function parseDiscordError(data) {
    if (!data) return 'An unknown error occurred.';
    if (typeof data === 'string') return data;
    if (data.error) {
        const msg = data.error.toLowerCase();
        if (msg.includes('missing permissions') || msg.includes('missing access')) return DISCORD_ERROR_MESSAGES[50013];
        if (msg.includes('rate limit')) return DISCORD_ERROR_MESSAGES[429];
        if (msg.includes('maximum number of channels')) return DISCORD_ERROR_MESSAGES[30013];
        if (msg.includes('maximum number of roles')) return DISCORD_ERROR_MESSAGES[30015];
        return data.error;
    }
    if (data.code && DISCORD_ERROR_MESSAGES[data.code]) return DISCORD_ERROR_MESSAGES[data.code];
    if (data.code === 50035 && data.errors) {
        const msgs = [];
        const flatten = (obj) => { for (const k in obj) { if (k === '_errors') obj[k].forEach(e => msgs.push(e.message)); else flatten(obj[k]); } };
        flatten(data.errors);
        if (msgs.length) return msgs.join(' | ');
    }
    return data.message || 'An unexpected error occurred.';
}

function validateChannelName(name) {
    if (!name || name.trim().length === 0) return 'Channel name cannot be empty.';
    if (name.trim().length > 100) return 'Channel name must be 100 characters or fewer.';
    return null;
}

function validateRoleName(name) {
    if (!name || name.trim().length === 0) return 'Role name cannot be empty.';
    if (name.trim().length > 100) return 'Role name must be 100 characters or fewer.';
    return null;
}

// ========================
// TOAST SYSTEM
// ========================

let toastContainer = null;
function getToastContainer() {
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
    }
    return toastContainer;
}

function showToast(msg, type, duration) {
    type = type || 'info';
    duration = duration || 4000;
    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    const container = getToastContainer();
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.innerHTML = '<span class="toast-icon">' + (icons[type] || 'ℹ') + '</span><span class="toast-msg">' + msg + '</span>';
    container.appendChild(t);
    setTimeout(function() { t.classList.add('hiding'); setTimeout(function() { t.remove(); }, 220); }, duration);
}

// ========================
// CUSTOM CONFIRM MODAL
// ========================

function showConfirmModal(opts) {
    var title = opts.title, desc = opts.desc, targetName = opts.targetName;
    var confirmText = opts.confirmText || 'Delete';
    var onConfirm = opts.onConfirm, onCancel = opts.onCancel;

    var existing = document.getElementById('setcord-modal');
    if (existing) existing.remove();

    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'setcord-modal';
    backdrop.innerHTML =
        '<div class="modal-box" id="modal-box">' +
        '<div class="modal-icon">🗑️</div>' +
        '<div class="modal-title">' + title + '</div>' +
        '<div class="modal-desc">' + desc +
        (targetName ? '<br><span class="modal-target">"' + targetName + '"</span>' : '') +
        '<br><br><span style="color:#7f1d1d;font-size:12px;">This action cannot be undone.</span>' +
        '</div>' +
        '<div class="modal-actions">' +
        '<button class="btn btn-ghost" id="modal-cancel">Cancel</button>' +
        '<button class="btn btn-danger" id="modal-confirm">' + confirmText + '</button>' +
        '</div></div>';
    document.body.appendChild(backdrop);

    function close(confirmed) {
        var box = document.getElementById('modal-box');
        backdrop.classList.add('closing');
        if (box) box.classList.add('closing');
        setTimeout(function() {
            backdrop.remove();
            if (confirmed && onConfirm) onConfirm();
            else if (!confirmed && onCancel) onCancel();
        }, 180);
    }

    document.getElementById('modal-cancel').onclick = function() { close(false); };
    document.getElementById('modal-confirm').onclick = function() { close(true); };
    backdrop.addEventListener('click', function(e) { if (e.target === backdrop) close(false); });
    var onKey = function(e) { if (e.key === 'Escape') { close(false); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
}

// ========================
// EMOJI DATA
// ========================

var EMOJI_CATEGORIES = {
    '😀': { label: 'Smileys', emojis: ['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','🙂','🤗','🤩','🤔','😐','😶','🙄','😏','😒','😔','😕','🙃','😲','😢','😭','😱','🥺','🤡','🥳','😇','😷','🤒','🤕','🤢','🤠'] },
    '👍': { label: 'People', emojis: ['👋','🤚','🖐️','✋','👌','✌️','🤞','👈','👉','👆','👇','👍','👎','✊','👊','👏','🙌','🤝','🙏','💪','👀','👅','👄','🧠','👶','🧒','👦','👧','🧑','👱','👨','👩','🧓','👴','👵','🙋','🤦','🤷'] },
    '🐶': { label: 'Animals & Nature', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐒','🐔','🐧','🐦','🦆','🦅','🦉','🦇','🐺','🐴','🦄','🐝','🦋','🐌','🐞','🐢','🐍','🐙','🦑','🐡','🐠','🐟','🐬','🐳','🦈','🐊','🐘','🦒','🦘','🐕','🐈','🦜','🌵','🌲','🌳','🌴','🍀','🌷','🌹','🌺','🌸','🌼','🌻','🌞','🌙','⭐','☀️','⛅','☁️','⚡','❄️','🌈','🔥','💧','🌊'] },
    '🍕': { label: 'Food & Drink', emojis: ['🍏','🍎','🍊','🍋','🍌','🍉','🍇','🍓','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🌶️','🧄','🧅','🥔','🍞','🥐','🧀','🥚','🍳','🥞','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🥪','🌮','🌯','🥗','🍝','🍜','🍲','🍛','🍣','🍱','🍤','🧁','🍰','🎂','🍭','🍬','🍫','🍿','🍩','🍪','🍯','☕','🍵','🍺','🍷','🥂','🧃','🥤','🧋'] },
    '⚽': { label: 'Activities', emojis: ['⚽','🏀','🏈','⚾','🏐','🏉','🎾','🏒','🏓','🎯','🎳','🎮','🎲','♟️','🧩','🏆','🥇','🥈','🥉','🏅','🎖️','🎪','🎭','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🎸','🎺','🎻','🎷'] },
    '🚗': { label: 'Travel', emojis: ['🚗','🚕','🚙','🚌','🏎️','🚓','🚑','🚒','🛻','🚚','🚜','🏍️','🛵','🚲','✈️','🚀','🛸','🚢','⛵','🚁','🏠','🏡','🏢','🏦','🏥','🏰','🗼','🗽','🏔️','⛰️','🌋','🏕️','🏖️','🏜️','🏝️'] },
    '💡': { label: 'Objects', emojis: ['⌚','📱','💻','⌨️','🖥️','📷','📹','📺','📻','🎥','📞','☎️','🧭','⏰','🔋','🔌','💡','🔦','🕯️','💰','💳','📈','📉','📋','📝','✏️','✒️','📌','📍','📎','✂️','🔍','🔎','🔒','🔓','🔑','🗝️','🔨','⚒️','🛠️','🔧','🔩','⚙️','🧲','🧪','🔭','🔬','💊','💉','🚪','🛋️','🚽','🚿','🛁','🧹','🧺','🧻','🧼','🛒'] },
    '❤️': { label: 'Symbols', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','☮️','✅','❌','⭕','🛑','⛔','📛','🚫','💯','♻️','✴️','🆗','🆙','🆒','🆕','🆓','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻','🔷','🔶','🔹','🔸','🟥','🟧','🟨','🟩','🟦','🟪','⬛','⬜','🟫'] },
};

// ========================
// EMOJI PICKER
// ========================

var activePickerInput = null;
var activePicker = null;

function createEmojiPicker(inputEl) {
    if (activePicker) { activePicker.remove(); activePicker = null; }
    if (activePickerInput === inputEl) { activePickerInput = null; return; }
    activePickerInput = inputEl;

    var picker = document.createElement('div');
    picker.className = 'emoji-picker';

    var rect = inputEl.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.left = rect.left + 'px';

    if (rect.bottom + 310 > window.innerHeight - 20) {
        picker.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
    } else {
        picker.style.top = (rect.bottom + 6) + 'px';
    }

    var categories = Object.keys(EMOJI_CATEGORIES);
    var activeCategory = categories[0];

    var tabs = document.createElement('div');
    tabs.className = 'emoji-picker-tabs';

    var grid = document.createElement('div');
    grid.className = 'emoji-grid';

    function renderGrid(catKey, custom) {
        grid.innerHTML = '';
        var emojis = custom || (catKey ? EMOJI_CATEGORIES[catKey].emojis : []);
        emojis.forEach(function(emoji) {
            var btn = document.createElement('button');
            btn.className = 'emoji-btn';
            btn.textContent = emoji;
            btn.type = 'button';
            btn.onclick = function(e) {
                e.stopPropagation();
                insertAtCursor(inputEl, emoji);
                picker.remove(); activePicker = null; activePickerInput = null;
                inputEl.focus();
            };
            grid.appendChild(btn);
        });
    }

    categories.forEach(function(catKey) {
        var tab = document.createElement('button');
        tab.className = 'emoji-tab' + (catKey === activeCategory ? ' active' : '');
        tab.textContent = catKey;
        tab.title = EMOJI_CATEGORIES[catKey].label;
        tab.onclick = function() {
            activeCategory = catKey;
            picker.querySelectorAll('.emoji-tab').forEach(function(t) { t.classList.remove('active'); });
            tab.classList.add('active');
            renderGrid(catKey);
        };
        tabs.appendChild(tab);
    });

    var searchWrap = document.createElement('div');
    searchWrap.className = 'emoji-search-wrap';
    var searchInput = document.createElement('input');
    searchInput.type = 'text'; searchInput.className = 'emoji-search'; searchInput.placeholder = 'Search…';
    searchInput.oninput = function() {
        var q = searchInput.value.toLowerCase().trim();
        if (!q) { renderGrid(activeCategory); return; }
        var all = [];
        Object.values(EMOJI_CATEGORIES).forEach(function(c) { all = all.concat(c.emojis); });
        renderGrid(null, all.slice(0, 64));
    };
    searchWrap.appendChild(searchInput);

    renderGrid(activeCategory);
    picker.appendChild(tabs);
    picker.appendChild(searchWrap);
    picker.appendChild(grid);
    document.body.appendChild(picker);
    activePicker = picker;

    setTimeout(function() { searchInput.focus(); }, 50);

    var closeHandler = function(e) {
        if (!picker.contains(e.target) && e.target !== inputEl) {
            picker.remove(); activePicker = null; activePickerInput = null;
            document.removeEventListener('click', closeHandler, true);
        }
    };
    setTimeout(function() { document.addEventListener('click', closeHandler, true); }, 10);
}

function insertAtCursor(input, text) {
    var s = input.selectionStart, e = input.selectionEnd, v = input.value;
    input.value = v.substring(0, s) + text + v.substring(e);
    input.selectionStart = input.selectionEnd = s + text.length;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function makeEmojiInput(inputEl) {
    if (!inputEl) return;
    var wrapper = document.createElement('div');
    wrapper.className = 'input-with-emoji';
    inputEl.parentNode.insertBefore(wrapper, inputEl);
    wrapper.appendChild(inputEl);
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'emoji-trigger'; btn.textContent = '😊'; btn.title = 'Add emoji';
    btn.onclick = function(e) { e.stopPropagation(); createEmojiPicker(inputEl); };
    wrapper.appendChild(btn);
    return wrapper;
}

// ========================
// TEST MODE ENGINE
// ========================

var TestMode = (function() {
    var _active = false;
    var _guildId = null;
    var _queue = [];
    var _nextId = 1;
    var _onToggle = null;
    var _onQueueChange = null;

    function _save() {
        try {
            sessionStorage.setItem('testmode_' + _guildId, JSON.stringify({ active: _active, queue: _queue, nextId: _nextId }));
        } catch(e) {}
    }

    function _load() {
        try {
            var stored = sessionStorage.getItem('testmode_' + _guildId);
            if (stored) {
                var parsed = JSON.parse(stored);
                _active = parsed.active || false;
                _queue = parsed.queue || [];
                _nextId = parsed.nextId || 1;
            }
        } catch(e) {}
    }

    function init(guildId, onToggle, onQueueChange) {
        _guildId = guildId;
        _onToggle = onToggle;
        _onQueueChange = onQueueChange;
        _load();
        _render();
        if (_onQueueChange && _queue.length > 0) _onQueueChange([].concat(_queue));
    }

    function isActive() { return _active; }

    function toggle() {
        _active = !_active;
        if (!_active && _queue.length > 0) {
            _queue = [];
            if (_onQueueChange) _onQueueChange([]);
            showToast('Test Mode OFF — pending changes discarded', 'info', 3000);
        } else if (_active) {
            showToast('⚡ Test Mode ON — changes queued, not saved to Discord', 'warning', 4500);
        } else {
            showToast('Test Mode OFF', 'info', 2000);
        }
        _save();
        _render();
        if (_onToggle) _onToggle(_active);
    }

    function enqueue(type, payload, label) {
        var entry = { id: _nextId++, type: type, payload: payload, label: label };
        _queue.push(entry);
        _save();
        if (_onQueueChange) _onQueueChange([].concat(_queue));
        showToast('Queued: ' + label, 'warning', 2500);
        return entry;
    }

    function removeFromQueue(id) {
        _queue = _queue.filter(function(e) { return e.id !== id; });
        _save();
        if (_onQueueChange) _onQueueChange([].concat(_queue));
    }

    function clearQueue() {
        _queue = [];
        _save();
        if (_onQueueChange) _onQueueChange([]);
    }

    function getQueue() { return [].concat(_queue); }

    function intercept(type, payload, label) {
        if (!_active) return { intercepted: false };
        enqueue(type, payload, label);
        return { intercepted: true, mockData: { success: true, _testMode: true } };
    }

    function publish(onProgress) {
        if (!_queue.length) return Promise.resolve({ success: true, results: [] });

        var results = [];
        var total = _queue.length;
        var done = 0;
        var queueCopy = [].concat(_queue);

        var chain = Promise.resolve();

        queueCopy.forEach(function(entry) {
            chain = chain.then(function() {
                var p = entry.payload;
                var fetchPromise;

                switch (entry.type) {
                    case 'createChannel':
                        fetchPromise = fetch('/api/' + _guildId + '/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }); break;
                    case 'deleteChannel':
                    case 'deleteCategory':
                        fetchPromise = fetch('/api/' + _guildId + '/channels/' + p.channelId, { method: 'DELETE' }); break;
                    case 'renameChannel':
                        fetchPromise = fetch('/api/' + _guildId + '/channels/' + p.channelId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: p.name }) }); break;
                    case 'moveChannel':
                        fetchPromise = fetch('/api/' + _guildId + '/channels/' + p.channelId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parentId: p.parentId }) }); break;
                    case 'createCategory':
                        fetchPromise = fetch('/api/' + _guildId + '/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }); break;
                    case 'createRole':
                        fetchPromise = fetch('/api/' + _guildId + '/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }); break;
                    case 'deleteRole':
                        fetchPromise = fetch('/api/' + _guildId + '/roles/' + p.roleId, { method: 'DELETE' }); break;
                    case 'editRole':
                        fetchPromise = fetch('/api/' + _guildId + '/roles/' + p.roleId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p.updates) }); break;
                    default:
                        results.push({ entry: entry, success: false, error: 'Unknown action' });
                        done++;
                        if (onProgress) onProgress(done, total, results[results.length - 1]);
                        return Promise.resolve();
                }

                return fetchPromise
                    .then(function(res) { return res.json(); })
                    .then(function(data) {
                        var ok = data && data.success;
                        results.push({ entry: entry, success: ok, error: ok ? null : parseDiscordError(data) });
                        if (ok) _queue = _queue.filter(function(e) { return e.id !== entry.id; });
                        done++;
                        if (onProgress) onProgress(done, total, results[results.length - 1]);
                    })
                    .catch(function(err) {
                        results.push({ entry: entry, success: false, error: 'Network error' });
                        done++;
                        if (onProgress) onProgress(done, total, results[results.length - 1]);
                    });
            });
        });

        return chain.then(function() {
            _save();
            if (_onQueueChange) _onQueueChange([].concat(_queue));
            return { success: _queue.length === 0, results: results };
        });
    }

    function _render() {
        var btn = document.getElementById('test-mode-btn');
        var bar = document.getElementById('test-mode-bar');
        var sideBanner = document.getElementById('test-mode-sidebar-banner');

        if (btn) {
            if (_active) { btn.classList.add('tm-active'); btn.textContent = '⚡ Test Mode ON'; }
            else { btn.classList.remove('tm-active'); btn.textContent = '⚡ Test Mode'; }
        }
        if (bar) bar.style.display = _active ? 'flex' : 'none';
        if (sideBanner) sideBanner.style.display = _active ? 'flex' : 'none';
    }

    return { init: init, isActive: isActive, toggle: toggle, intercept: intercept, enqueue: enqueue, removeFromQueue: removeFromQueue, clearQueue: clearQueue, publish: publish, getQueue: getQueue };
})();

// ========================
// DRAG DROP LIST
// ========================

function DragDropList(opts) {
    this.container = opts.container;
    this.itemSelector = opts.itemSelector;
    this.onReorder = opts.onReorder;
    this.getItemId = opts.getItemId;
    this.dragging = null;
    this._bind();
}

DragDropList.prototype._getItem = function(el) {
    return el && el.closest ? el.closest(this.itemSelector) : null;
};

DragDropList.prototype._bind = function() {
    var self = this;
    this.container.addEventListener('dragstart', function(e) {
        var item = self._getItem(e.target);
        if (!item) return;
        self.dragging = item;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', self.getItemId(item));
    });
    this.container.addEventListener('dragover', function(e) {
        e.preventDefault();
        var target = self._getItem(e.target);
        if (!target || target === self.dragging) return;
        self.container.querySelectorAll('.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
        target.classList.add('drag-over');
        var rect = target.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) target.parentNode.insertBefore(self.dragging, target);
        else target.parentNode.insertBefore(self.dragging, target.nextSibling);
    });
    this.container.addEventListener('dragleave', function(e) {
        var target = self._getItem(e.target);
        if (target) target.classList.remove('drag-over');
    });
    this.container.addEventListener('drop', function(e) {
        e.preventDefault();
        self.container.querySelectorAll('.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
        if (self.onReorder) self.onReorder(e.dataTransfer.getData('text/plain'));
    });
    this.container.addEventListener('dragend', function() {
        if (self.dragging) self.dragging.classList.remove('dragging');
        self.container.querySelectorAll('.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
        self.dragging = null;
    });
};

// ========================
// EXPORTS

// ========================
// BOT LOADING OVERLAY
// ========================

var _loadingEl = null;
var _loadingCount = 0;
var _loadingHideTimer = null;

function showLoading(message) {
    _loadingCount++;
    message = message || 'Bot is working\u2026';

    // Cancel any in-progress fade-out so we don't show a ghost overlay
    if (_loadingHideTimer) {
        clearTimeout(_loadingHideTimer);
        _loadingHideTimer = null;
    }

    if (!_loadingEl) {
        _loadingEl = document.createElement('div');
        _loadingEl.id = 'bot-loading-overlay';
        _loadingEl.style.cssText = 'position:fixed;inset:0;background:rgba(5,5,20,0.78);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);z-index:9000;display:flex;align-items:center;justify-content:center;opacity:1;transition:none;';
        _loadingEl.innerHTML =
            '<div style="background:#13132a;border:1px solid #1c1c3a;border-radius:16px;padding:32px 40px;text-align:center;min-width:260px;box-shadow:0 24px 60px rgba(0,0,0,0.7);position:relative;overflow:hidden;">' +
            '<div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#7c3aed,transparent);"></div>' +
            '<div style="font-size:34px;margin-bottom:14px;">🤖</div>' +
            '<div id="bot-loading-spinner" style="width:30px;height:30px;border:3px solid #1c1c3a;border-top-color:#7c3aed;border-radius:50%;animation:setcordSpin 0.65s linear infinite;margin:0 auto 16px;"></div>' +
            '<div id="bot-loading-msg" style="font-size:14px;font-weight:600;color:#e8e8f0;margin-bottom:6px;letter-spacing:-0.2px;">' + message + '</div>' +
            '<div style="font-size:11px;color:#4a4a6a;">Please wait \u2014 don\'t close or refresh</div>' +
            '</div>';

        if (!document.getElementById('setcord-spin-style')) {
            var style = document.createElement('style');
            style.id = 'setcord-spin-style';
            style.textContent = '@keyframes setcordSpin{to{transform:rotate(360deg)}}';
            document.head.appendChild(style);
        }
        document.body.appendChild(_loadingEl);
    } else {
        // Overlay exists but was fading — restore it
        _loadingEl.style.opacity = '1';
        _loadingEl.style.transition = 'none';
        var msgEl = document.getElementById('bot-loading-msg');
        if (msgEl) msgEl.textContent = message;
    }
}

function hideLoading() {
    _loadingCount = Math.max(0, _loadingCount - 1);
    if (_loadingCount === 0 && _loadingEl) {
        var elToRemove = _loadingEl;
        _loadingEl = null;
        // Disable pointer events IMMEDIATELY so clicks go through right away
        elToRemove.style.pointerEvents = 'none';
        elToRemove.style.opacity = '0';
        elToRemove.style.transition = 'opacity 0.15s ease';
        _loadingHideTimer = setTimeout(function() {
            _loadingHideTimer = null;
            if (elToRemove && elToRemove.parentNode) elToRemove.remove();
        }, 160);
    }
}

function apiFetch(url, options, loadingMsg) {
    showLoading(loadingMsg || 'Bot is working\u2026');
    var fetchOptions = Object.assign({ credentials: 'same-origin' }, options || {});
    return fetch(url, fetchOptions)
        .then(function(r) { hideLoading(); return r; })
        .catch(function(err) {
            hideLoading();
            console.error('[apiFetch] Network error for', url, err);
            throw err;
        });
}

// ========================
// EXPORTS
// ========================

window.Setcord = {
    showToast: showToast,
    showConfirmModal: showConfirmModal,
    parseDiscordError: parseDiscordError,
    validateChannelName: validateChannelName,
    validateRoleName: validateRoleName,
    makeEmojiInput: makeEmojiInput,
    createEmojiPicker: createEmojiPicker,
    DragDropList: DragDropList,
    EMOJI_CATEGORIES: EMOJI_CATEGORIES,
    TestMode: TestMode,
    showLoading: showLoading,
    hideLoading: hideLoading,
    apiFetch: apiFetch,
};