(function() {
  var STORAGE_KEY = 'theme';
  if (window.ThemeManager && typeof window.ThemeManager.getTheme === 'function') {
    window.ThemeManager.applyTheme(window.ThemeManager.getTheme());
    return;
  }

  var doc = document;
  var root = doc.documentElement;
  var mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  var subscribers = new Set();
  var darkThemeColor = '#0b1120';
  var lightThemeColor = '#f4f5f7';

  function resolve(theme) {
    if (theme === 'dark') return 'dark';
    if (theme === 'light') return 'light';
    return mediaQuery.matches ? 'dark' : 'light';
  }

  function safeGetStored() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return null;
    }
  }

  function safeSetStored(theme) {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch (error) {
      /* no-op */
    }
  }

  function updateMetaTheme(resolved) {
    var meta = doc.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    meta.setAttribute('content', resolved === 'dark' ? darkThemeColor : lightThemeColor);
  }

  function notify(theme, resolved) {
    subscribers.forEach(function(listener) {
      try {
        listener(theme, resolved);
      } catch (error) {
        /* no-op */
      }
    });
  }

  function apply(theme) {
    var resolved = resolve(theme);
    if (resolved === 'dark') {
      root.classList.add('dark-mode');
    } else {
      root.classList.remove('dark-mode');
    }
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved === 'dark' ? 'dark' : 'light';
    updateMetaTheme(resolved);
    notify(theme, resolved);
    return resolved;
  }

  var initialTheme = safeGetStored() || 'system';
  apply(initialTheme);

  mediaQuery.addEventListener('change', function() {
    var current = safeGetStored() || 'system';
    if (current === 'system') {
      apply('system');
    }
  });

  window.addEventListener('storage', function(event) {
    if (event.key === STORAGE_KEY) {
      apply(event.newValue || 'system');
    }
  });

  window.ThemeManager = {
    getTheme: function() {
      return safeGetStored() || 'system';
    },
    setTheme: function(theme) {
      safeSetStored(theme);
      return apply(theme);
    },
    applyTheme: function(theme) {
      return apply(theme);
    },
    resolvedTheme: function() {
      return resolve(safeGetStored() || 'system');
    },
    subscribe: function(listener) {
      if (typeof listener !== 'function') {
        return function() {};
      }
      subscribers.add(listener);
      return function() {
        subscribers.delete(listener);
      };
    }
  };
})();


(function() {
  var PREFERENCE_STORAGE_KEY = 'user-preferences';
  var doc = document;
  var root = doc.documentElement;

  var DEFAULT_PREFERENCES = {
    theme: window.ThemeManager ? window.ThemeManager.getTheme() : 'system',
    fontScale: 'medium',
    accentColor: '#6366f1',
    quickActions: ['toggle-theme', 'open-settings', 'open-chat'],
    shortcuts: {
      openQuickActions: 'ctrl+k',
      toggleTheme: 'shift+d'
    }
  };

  var ALLOWED_THEMES = ['light', 'dark', 'system'];
  var ALLOWED_FONT_SCALES = ['small', 'medium', 'large', 'xlarge'];
  var FONT_SCALE_RATIO = {
    small: 0.94,
    medium: 1,
    large: 1.08,
    xlarge: 1.18
  };
  var ALLOWED_QUICK_ACTIONS = ['toggle-theme', 'open-settings', 'open-chat', 'new-post', 'open-profile'];

  var QUICK_ACTION_DEFINITIONS = [
    {
      id: 'toggle-theme',
      label: '다크/라이트 전환',
      description: '현재 모드를 즉시 전환합니다.',
      icon: '🌗',
      run: function() {
        var manager = window.ThemeManager;
        if (!manager) return;
        var resolved = manager.resolvedTheme();
        var next = resolved === 'dark' ? 'light' : 'dark';
        window.PreferenceStore.set({ theme: next });
      }
    },
    {
      id: 'open-settings',
      label: '설정 열기',
      description: '환경설정 화면으로 이동합니다.',
      icon: '⚙️',
      run: function() {
        window.location.href = '/setting.html';
      }
    },
    {
      id: 'open-chat',
      label: '채팅 이동',
      description: '채팅 페이지를 바로 엽니다.',
      icon: '💬',
      run: function() {
        window.location.href = '/chat.html';
      }
    },
    {
      id: 'new-post',
      label: '새 글 작성',
      description: '게시글 작성 폼으로 이동합니다.',
      icon: '📝',
      run: function() {
        window.location.href = '/posts.html#compose';
      }
    },
    {
      id: 'open-profile',
      label: '내 프로필',
      description: '프로필 페이지로 이동합니다.',
      icon: '🙍',
      run: function() {
        window.location.href = '/profile.html';
      }
    }
  ];
  var QUICK_ACTION_MAP = QUICK_ACTION_DEFINITIONS.reduce(function(acc, item) {
    acc[item.id] = item;
    return acc;
  }, {});

  var subscribers = new Set();
  var currentPreferences = null;
  var quickActionMenu = null;
  var parsedShortcuts = {};
  var pendingServerPayload = null;
  var serverSyncTimer = null;
  var fetchingFromServer = false;
  var lastServerHash = '';
  var applyingThemeInternally = false;

  function clonePreferences(prefs) {
    if (!prefs) return null;
    return {
      theme: prefs.theme,
      fontScale: prefs.fontScale,
      accentColor: prefs.accentColor,
      quickActions: Array.isArray(prefs.quickActions) ? prefs.quickActions.slice(0) : [],
      shortcuts: prefs.shortcuts ? { ...prefs.shortcuts } : { ...DEFAULT_PREFERENCES.shortcuts }
    };
  }

  function safeParse(raw) {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  function normalizeAccent(color) {
    if (typeof color !== 'string') {
      return DEFAULT_PREFERENCES.accentColor;
    }
    var trimmed = color.trim();
    if (!trimmed) return DEFAULT_PREFERENCES.accentColor;
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
      return trimmed.toLowerCase();
    }
    return DEFAULT_PREFERENCES.accentColor;
  }

  function sanitizeQuickActions(list) {
    if (!Array.isArray(list)) {
      return DEFAULT_PREFERENCES.quickActions.slice(0);
    }
    var seen = new Set();
    var normalized = [];
    list.forEach(function(item) {
      if (typeof item !== 'string') return;
      var trimmed = item.trim();
      if (!ALLOWED_QUICK_ACTIONS.includes(trimmed)) return;
      if (seen.has(trimmed)) return;
      seen.add(trimmed);
      normalized.push(trimmed);
    });
    return normalized.length ? normalized.slice(0, 4) : DEFAULT_PREFERENCES.quickActions.slice(0);
  }

  function normalizeShortcut(raw) {
    if (typeof raw !== 'string') return '';
    return raw.trim().toLowerCase().replace(/\s*\+\s*/g, '+');
  }

  function sanitizeShortcuts(value) {
    var safe = { ...DEFAULT_PREFERENCES.shortcuts };
    if (!value || typeof value !== 'object') {
      return safe;
    }
    Object.keys(safe).forEach(function(key) {
      var normalized = normalizeShortcut(value[key]);
      if (!normalized) return;
      if (normalized.length > 40) return;
      if (!/^[a-z0-9+\-#]+$/i.test(normalized.replace(/\+/g, ''))) return;
      safe[key] = normalized;
    });
    return safe;
  }

  function sanitizePreferences(next) {
    var safe = clonePreferences(DEFAULT_PREFERENCES);
    if (!next || typeof next !== 'object') {
      return safe;
    }
    if (typeof next.theme === 'string' && ALLOWED_THEMES.includes(next.theme)) {
      safe.theme = next.theme;
    }
    if (typeof next.fontScale === 'string' && ALLOWED_FONT_SCALES.includes(next.fontScale)) {
      safe.fontScale = next.fontScale;
    }
    if (typeof next.accentColor === 'string') {
      safe.accentColor = normalizeAccent(next.accentColor);
    }
    safe.quickActions = sanitizeQuickActions(next.quickActions);
    safe.shortcuts = sanitizeShortcuts(next.shortcuts);
    return safe;
  }

  function loadStoredPreferences() {
    var raw = null;
    try {
      raw = window.localStorage.getItem(PREFERENCE_STORAGE_KEY);
    } catch (error) {
      raw = null;
    }
    var parsed = safeParse(raw) || {};
    if (!parsed.theme && window.ThemeManager) {
      parsed.theme = window.ThemeManager.getTheme();
    }
    return sanitizePreferences(parsed);
  }

  function storePreferences(prefs) {
    try {
      window.localStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(prefs));
    } catch (error) {
      /* ignore */
    }
  }

  function hexToRgb(hex) {
    if (!hex) return null;
    var normalized = hex.replace('#', '');
    if (normalized.length === 3) {
      normalized = normalized.split('').map(function(ch) { return ch + ch; }).join('');
    }
    if (normalized.length !== 6) return null;
    var value = parseInt(normalized, 16);
    if (Number.isNaN(value)) return null;
    return {
      r: (value >> 16) & 255,
      g: (value >> 8) & 255,
      b: value & 255
    };
  }

  function rgbToHex(r, g, b) {
    var toHex = function(component) {
      var clamped = Math.max(0, Math.min(255, Math.round(component)));
      return clamped.toString(16).padStart(2, '0');
    };
    return '#' + toHex(r) + toHex(g) + toHex(b);
  }

  function lighten(rgb, amount) {
    if (!rgb) return '#6366f1';
    var blend = function(channel) {
      return channel + (255 - channel) * amount;
    };
    return rgbToHex(blend(rgb.r), blend(rgb.g), blend(rgb.b));
  }

  function darken(rgb, amount) {
    if (!rgb) return '#4338ca';
    var scale = 1 - amount;
    return rgbToHex(rgb.r * scale, rgb.g * scale, rgb.b * scale);
  }

  function getContrast(rgb) {
    if (!rgb) return '#ffffff';
    var luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
    return luminance > 0.6 ? '#1f2937' : '#ffffff';
  }

  function applyFontScale(scale) {
    var ratio = FONT_SCALE_RATIO[scale] || 1;
    root.dataset.fontScale = scale;
    root.style.setProperty('--font-scale-ratio', ratio);
    root.style.fontSize = (16 * ratio) + 'px';
  }

  function applyAccentColor(color) {
    var rgb = hexToRgb(color);
    root.style.setProperty('--accent-color', color);
    root.style.setProperty('--accent-color-soft', lighten(rgb, 0.72));
    root.style.setProperty('--accent-color-strong', darken(rgb, 0.25));
    root.style.setProperty('--accent-contrast-color', getContrast(rgb));
  }

  function updateShortcutCache(shortcuts) {
    parsedShortcuts = {};
    Object.keys(shortcuts || {}).forEach(function(key) {
      parsedShortcuts[key] = parseShortcut(shortcuts[key]);
    });
  }

  function applyPreferences(prefs, options) {
    var shouldApplyTheme = !options || options.applyTheme !== false;
    if (shouldApplyTheme && window.ThemeManager) {
      applyingThemeInternally = true;
      if (window.ThemeManager.getTheme() !== prefs.theme) {
        window.ThemeManager.setTheme(prefs.theme);
      } else {
        window.ThemeManager.applyTheme(prefs.theme);
      }
      applyingThemeInternally = false;
    }
    applyFontScale(prefs.fontScale);
    applyAccentColor(prefs.accentColor);
    updateShortcutCache(prefs.shortcuts);
    if (quickActionMenu) {
      quickActionMenu.render(prefs);
    }
  }

  function notifySubscribers(prefs) {
    subscribers.forEach(function(listener) {
      try {
        listener(clonePreferences(prefs));
      } catch (error) {
        /* ignore */
      }
    });
  }

  function preferenceHash(prefs) {
    return JSON.stringify(prefs);
  }

  function scheduleServerSync(prefs) {
    pendingServerPayload = clonePreferences(prefs);
    if (serverSyncTimer) return;
    serverSyncTimer = window.setTimeout(flushServerSync, 600);
  }

  function resolveAuthToken() {
    if (typeof window.requireAuthToken === 'function') {
      return window.requireAuthToken();
    }
    return Promise.resolve(localStorage.getItem('token'));
  }

  async function flushServerSync() {
    var payload = pendingServerPayload ? clonePreferences(pendingServerPayload) : null;
    pendingServerPayload = null;
    serverSyncTimer = null;
    if (!payload) return;
    var token = await resolveAuthToken();
    if (!token) return;
    try {
      var response = await fetch('/api/settings/preferences', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ preferences: payload })
      });
      if (response.ok) {
        lastServerHash = preferenceHash(payload);
      }
    } catch (error) {
      /* ignore network errors */
    }
  }

  async function fetchServerPreferences() {
    if (fetchingFromServer) return null;
    var token = await resolveAuthToken();
    if (!token) return null;
    fetchingFromServer = true;
    try {
      var response = await fetch('/api/settings/preferences', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + token
        }
      });
      if (!response.ok) {
        if (response.status === 401) {
          lastServerHash = '';
        }
        return null;
      }
      var data = await response.json();
      if (!data || !data.preferences) return null;
      var sanitized = sanitizePreferences(data.preferences);
      var hash = preferenceHash(sanitized);
      lastServerHash = hash;
      setPreferencesInternal(sanitized, { sync: false, forceApply: true });
      return sanitized;
    } catch (error) {
      return null;
    } finally {
      fetchingFromServer = false;
    }
  }

  function setPreferencesInternal(next, options) {
    var sanitized = sanitizePreferences(next);
    var changed = !currentPreferences || preferenceHash(currentPreferences) !== preferenceHash(sanitized);
    currentPreferences = sanitized;
    storePreferences(currentPreferences);
    if (changed || (options && options.forceApply)) {
      applyPreferences(currentPreferences, options);
      notifySubscribers(currentPreferences);
    }
    if (!options || options.sync !== false) {
      scheduleServerSync(currentPreferences);
    }
    return currentPreferences;
  }

  function updatePreferences(partial, options) {
    var merged = { ...currentPreferences, ...partial };
    return setPreferencesInternal(merged, options);
  }

  function parseShortcut(value) {
    if (typeof value !== 'string') return null;
    var parts = value.split('+');
    var config = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, key: null };
    parts.forEach(function(part) {
      var token = part.trim();
      if (!token) return;
      if (token === 'ctrl' || token === 'control') config.ctrlKey = true;
      else if (token === 'alt' || token === 'option') config.altKey = true;
      else if (token === 'shift') config.shiftKey = true;
      else if (token === 'cmd' || token === 'command' || token === 'meta' || token === 'win') config.metaKey = true;
      else config.key = token;
    });
    return config.key ? config : null;
  }

  function matchesShortcut(config, event) {
    if (!config) return false;
    if (!!config.ctrlKey !== !!event.ctrlKey) return false;
    if (!!config.altKey !== !!event.altKey) return false;
    if (!!config.shiftKey !== !!event.shiftKey) return false;
    if (!!config.metaKey !== !!event.metaKey) return false;
    var key = (event.key || '').toLowerCase();
    return key === config.key;
  }

  function shouldIgnoreShortcutTarget(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    var tag = target.tagName ? target.tagName.toLowerCase() : '';
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  function toggleThemePreference() {
    var manager = window.ThemeManager;
    if (!manager) return;
    var resolved = manager.resolvedTheme();
    var next = resolved === 'dark' ? 'light' : 'dark';
    window.PreferenceStore.set({ theme: next });
  }

  document.addEventListener('keydown', function(event) {
    if (!parsedShortcuts) return;
    if (shouldIgnoreShortcutTarget(event.target)) return;
    if (matchesShortcut(parsedShortcuts.openQuickActions, event)) {
      event.preventDefault();
      if (quickActionMenu) {
        quickActionMenu.toggle(true);
      }
      return;
    }
    if (matchesShortcut(parsedShortcuts.toggleTheme, event)) {
      event.preventDefault();
      toggleThemePreference();
    }
  }, true);

  function QuickActionMenu() {
    this.trigger = null;
    this.panel = null;
    this.backdrop = null;
    this.visible = false;
    this.ensureElements();
    this.attach();
  }

  QuickActionMenu.prototype.ensureElements = function() {
    if (!this.trigger) {
      this.trigger = doc.querySelector('[data-quick-actions-trigger]');
      if (!this.trigger) {
        this.trigger = doc.createElement('button');
        this.trigger.type = 'button';
        this.trigger.className = 'quick-actions-trigger';
        this.trigger.setAttribute('data-quick-actions-trigger', '');
        this.trigger.setAttribute('aria-haspopup', 'true');
        this.trigger.setAttribute('aria-expanded', 'false');
        this.trigger.innerHTML = '<span class="quick-actions-trigger-icon">⚡</span><span class="quick-actions-trigger-label">퀵 액션</span>';
        doc.body.appendChild(this.trigger);
      }
    }
    if (!this.panel) {
      this.panel = doc.querySelector('[data-quick-actions-panel]');
      if (!this.panel) {
        this.panel = doc.createElement('div');
        this.panel.className = 'quick-actions-panel';
        this.panel.setAttribute('role', 'dialog');
        this.panel.setAttribute('aria-modal', 'true');
        this.panel.setAttribute('tabindex', '-1');
        this.panel.setAttribute('data-quick-actions-panel', '');
        this.panel.innerHTML = '';
        doc.body.appendChild(this.panel);
      }
    }
    if (!this.backdrop) {
      this.backdrop = doc.querySelector('[data-quick-actions-backdrop]');
      if (!this.backdrop) {
        this.backdrop = doc.createElement('div');
        this.backdrop.className = 'quick-actions-backdrop';
        this.backdrop.setAttribute('data-quick-actions-backdrop', '');
        doc.body.appendChild(this.backdrop);
      }
    }
  };

  QuickActionMenu.prototype.attach = function() {
    var self = this;
    this.trigger.addEventListener('click', function() {
      self.toggle();
    });
    this.backdrop.addEventListener('click', function() {
      self.close();
    });
    doc.addEventListener('keydown', function(event) {
      if (!self.visible) return;
      if (event.key === 'Escape') {
        self.close();
      }
    });
  };

  QuickActionMenu.prototype.render = function(prefs) {
    if (!this.panel) return;
    var self = this;
    var actions = (prefs.quickActions || []).map(function(id) {
      return QUICK_ACTION_MAP[id];
    }).filter(Boolean);
    var shortcut = (prefs.shortcuts && prefs.shortcuts.openQuickActions) || DEFAULT_PREFERENCES.shortcuts.openQuickActions;

    var html = '<header class="quick-actions-header">' +
      '<div class="quick-actions-title">빠른 실행</div>' +
      '<div class="quick-actions-shortcut">(' + shortcut.toUpperCase() + ')</div>' +
      '</header>';

    if (!actions.length) {
      html += '<p class="quick-actions-empty">설정에서 퀵 액션을 선택해주세요.</p>';
    } else {
      html += '<ul class="quick-actions-list">';
      actions.forEach(function(action) {
        html += '<li><button type="button" data-action-id="' + action.id + '">' +
          '<span class="quick-actions-icon">' + action.icon + '</span>' +
          '<span class="quick-actions-label">' + action.label + '</span>' +
          '<span class="quick-actions-description">' + action.description + '</span>' +
          '</button></li>';
      });
      html += '</ul>';
    }

    html += '<footer class="quick-actions-footer">즐겨 쓰는 동작을 빠르게 실행하세요.</footer>';
    this.panel.innerHTML = html;

    var buttons = this.panel.querySelectorAll('button[data-action-id]');
    buttons.forEach(function(button) {
      button.addEventListener('click', function() {
        var id = button.getAttribute('data-action-id');
        var action = QUICK_ACTION_MAP[id];
        if (action && typeof action.run === 'function') {
          action.run();
          window.setTimeout(function() { self.close(); }, 120);
        }
      });
    });
  };

  QuickActionMenu.prototype.open = function() {
    if (this.visible) return;
    this.visible = true;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.panel.classList.add('open');
    this.backdrop.classList.add('open');
    if (typeof this.panel.focus === 'function') {
      try {
        this.panel.focus({ preventScroll: true });
      } catch (error) {
        this.panel.focus();
      }
    }
  };

  QuickActionMenu.prototype.close = function() {
    if (!this.visible) return;
    this.visible = false;
    this.trigger.setAttribute('aria-expanded', 'false');
    this.panel.classList.remove('open');
    this.backdrop.classList.remove('open');
  };

  QuickActionMenu.prototype.toggle = function(forceOpen) {
    if (typeof forceOpen === 'boolean') {
      if (forceOpen) this.open();
      else this.close();
      return;
    }
    if (this.visible) this.close();
    else this.open();
  };

  function formatShortcut(shortcut) {
    var normalized = normalizeShortcut(shortcut);
    if (!normalized) return '';
    return normalized.split('+').map(function(part) {
      if (part.length === 1) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    }).join(' + ');
  }

  function cloneQuickAction(action) {
    return {
      id: action.id,
      label: action.label,
      description: action.description,
      icon: action.icon
    };
  }

  currentPreferences = loadStoredPreferences();
  storePreferences(currentPreferences);
  applyPreferences(currentPreferences, { applyTheme: true });
  lastServerHash = preferenceHash(currentPreferences);

  function ensureQuickActionMenu() {
    if (!quickActionMenu) {
      quickActionMenu = new QuickActionMenu();
      quickActionMenu.render(currentPreferences);
    }
    return quickActionMenu;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureQuickActionMenu);
  } else {
    ensureQuickActionMenu();
  }

  window.addEventListener('storage', function(event) {
    if (event.key === PREFERENCE_STORAGE_KEY) {
      var parsed = safeParse(event.newValue);
      if (parsed) {
        setPreferencesInternal(parsed, { sync: false, forceApply: true });
      } else if (event.newValue === null) {
        setPreferencesInternal(clonePreferences(DEFAULT_PREFERENCES), { sync: false, forceApply: true });
      }
    }
  });

  if (window.ThemeManager && typeof window.ThemeManager.subscribe === 'function') {
    window.ThemeManager.subscribe(function(theme) {
      if (applyingThemeInternally) return;
      if (!currentPreferences) return;
      if (currentPreferences.theme === theme) return;
      updatePreferences({ theme: theme }, { applyTheme: false });
    });
  }

  window.PreferenceStore = {
    get: function() {
      return clonePreferences(currentPreferences);
    },
    set: function(partial, options) {
      return updatePreferences(partial, options);
    },
    replace: function(next, options) {
      return setPreferencesInternal(next, options);
    },
    subscribe: function(listener) {
      if (typeof listener !== 'function') {
        return function() {};
      }
      subscribers.add(listener);
      return function() {
        subscribers.delete(listener);
      };
    },
    getDefaultPreferences: function() {
      return clonePreferences(DEFAULT_PREFERENCES);
    },
    getAvailableQuickActions: function() {
      return QUICK_ACTION_DEFINITIONS.map(cloneQuickAction);
    },
    formatShortcut: formatShortcut,
    syncFromServer: fetchServerPreferences,
    openQuickActions: function() {
      ensureQuickActionMenu().open();
    },
    toggleQuickActions: function(force) {
      ensureQuickActionMenu().toggle(force);
    }
  };

  setTimeout(function() {
    fetchServerPreferences();
  }, 200);

})();
