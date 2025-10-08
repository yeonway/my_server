const DEFAULT_ACCENT_COLOR = '#6366f1';

const ALLOWED_THEMES = ['light', 'dark', 'system'];
const ALLOWED_FONT_SCALES = ['small', 'medium', 'large', 'xlarge'];
const ALLOWED_QUICK_ACTIONS = [
  'toggle-theme',
  'open-settings',
  'open-chat',
  'new-post',
  'open-profile'
];

const DEFAULT_PREFERENCES = {
  theme: 'system',
  fontScale: 'medium',
  accentColor: DEFAULT_ACCENT_COLOR,
  quickActions: ['toggle-theme', 'open-settings', 'open-chat'],
  shortcuts: {
    openQuickActions: 'ctrl+k',
    toggleTheme: 'shift+d'
  }
};

function normalizeAccentColor(value) {
  if (typeof value !== 'string') {
    return DEFAULT_PREFERENCES.accentColor;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_PREFERENCES.accentColor;
  }

  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  return DEFAULT_PREFERENCES.accentColor;
}

function normalizeFontScale(value) {
  if (typeof value !== 'string') {
    return DEFAULT_PREFERENCES.fontScale;
  }
  const normalized = value.trim().toLowerCase();
  return ALLOWED_FONT_SCALES.includes(normalized)
    ? normalized
    : DEFAULT_PREFERENCES.fontScale;
}

function normalizeTheme(value) {
  if (typeof value !== 'string') {
    return DEFAULT_PREFERENCES.theme;
  }
  const normalized = value.trim().toLowerCase();
  return ALLOWED_THEMES.includes(normalized) ? normalized : DEFAULT_PREFERENCES.theme;
}

function normalizeQuickActions(list) {
  if (!Array.isArray(list)) {
    return DEFAULT_PREFERENCES.quickActions.slice(0);
  }
  const seen = new Set();
  const normalized = [];
  list.forEach((item) => {
    if (typeof item !== 'string') return;
    const trimmed = item.trim();
    if (!ALLOWED_QUICK_ACTIONS.includes(trimmed)) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    normalized.push(trimmed);
  });
  if (normalized.length === 0) {
    return DEFAULT_PREFERENCES.quickActions.slice(0);
  }
  return normalized.slice(0, 4);
}

function normalizeShortcuts(value) {
  const defaults = { ...DEFAULT_PREFERENCES.shortcuts };
  if (!value || typeof value !== 'object') {
    return defaults;
  }

  for (const key of Object.keys(defaults)) {
    const raw = value[key];
    if (typeof raw !== 'string') continue;
    const normalized = raw.trim().toLowerCase();
    if (!normalized) continue;
    if (normalized.length > 40) continue;
    if (!/^[a-z0-9+\-#\s]*$/.test(normalized)) continue;
    defaults[key] = normalized;
  }
  return defaults;
}

function sanitizePreferences(payload = {}) {
  const safe = { ...DEFAULT_PREFERENCES };

  safe.theme = normalizeTheme(payload.theme);
  safe.fontScale = normalizeFontScale(payload.fontScale);
  safe.accentColor = normalizeAccentColor(payload.accentColor);
  safe.quickActions = normalizeQuickActions(payload.quickActions);
  safe.shortcuts = normalizeShortcuts(payload.shortcuts);

  return safe;
}

module.exports = {
  DEFAULT_PREFERENCES,
  ALLOWED_THEMES,
  ALLOWED_FONT_SCALES,
  ALLOWED_QUICK_ACTIONS,
  sanitizePreferences,
};
