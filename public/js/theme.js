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

