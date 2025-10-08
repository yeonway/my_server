(function() {
  const FONT_LABELS = {
    small: '작게',
    medium: '보통',
    large: '크게',
    xlarge: '아주 크게',
  };
  const THEME_LABELS = {
    light: '라이트 모드',
    dark: '다크 모드',
    system: '시스템 연동',
  };

  let store = null;
  let updating = false;
  let quickActions = [];
  let quickActionMap = {};
  let selectedActions = [];
  let quickActionElements = {};

  const themeInputs = Array.from(document.querySelectorAll('[data-theme-option]'));
  const fontButtons = Array.from(document.querySelectorAll('[data-font-scale]'));
  const accentInput = document.querySelector('[data-accent-input]');
  const accentSwatchesRoot = document.querySelector('[data-accent-swatches]');
  const quickActionList = document.querySelector('[data-quick-action-list]');
  const shortcutInputs = Array.from(document.querySelectorAll('[data-shortcut-input]'));
  const previewContainer = document.querySelector('[data-preference-preview]');
  const previewThemeLabel = previewContainer ? previewContainer.querySelector('[data-preview-theme-label]') : null;
  const previewFontLabel = previewContainer ? previewContainer.querySelector('[data-preview-font-label]') : null;
  const previewColorLabel = previewContainer ? previewContainer.querySelector('[data-preview-color]') : null;
  const previewText = previewContainer ? previewContainer.querySelector('[data-preview-text]') : null;
  const previewActions = previewContainer ? previewContainer.querySelector('[data-preview-actions]') : null;

  function normalizeColorForInput(color) {
    if (typeof color !== 'string') return '#6366f1';
    let hex = color.trim().toLowerCase();
    if (!hex.startsWith('#')) {
      hex = '#' + hex;
    }
    if (hex.length === 4) {
      hex = '#' + hex.slice(1).split('').map((ch) => ch + ch).join('');
    }
    if (hex.length !== 7) {
      return '#6366f1';
    }
    return hex;
  }

  function ensureStoreReady() {
    if (!window.PreferenceStore) {
      window.setTimeout(ensureStoreReady, 60);
      return;
    }
    if (!quickActionList) {
      return;
    }
    store = window.PreferenceStore;
    quickActions = store.getAvailableQuickActions() || [];
    quickActionMap = quickActions.reduce((acc, action) => {
      acc[action.id] = action;
      return acc;
    }, {});

    attachEventHandlers();
    buildQuickActionList();
    const prefs = store.get();
    updateUI(prefs);
    store.subscribe((next) => updateUI(next));
    store.syncFromServer();
  }

  function attachEventHandlers() {
    themeInputs.forEach((input) => {
      input.addEventListener('change', () => {
        if (!store || updating) return;
        store.set({ theme: input.value });
      });
    });

    fontButtons.forEach((button) => {
      button.addEventListener('click', () => {
        if (!store || updating) return;
        const scale = button.getAttribute('data-font-scale');
        store.set({ fontScale: scale });
      });
    });

    if (accentInput) {
      accentInput.addEventListener('input', (event) => {
        if (!store || updating) return;
        const color = normalizeColorForInput(event.target.value || '');
        store.set({ accentColor: color });
      });
    }

    if (accentSwatchesRoot) {
      accentSwatchesRoot.addEventListener('click', (event) => {
        const button = event.target.closest('[data-accent-swatch]');
        if (!button || updating || !store) return;
        event.preventDefault();
        const color = button.getAttribute('data-accent-swatch');
        if (color && accentInput) {
          accentInput.value = normalizeColorForInput(color);
        }
        store.set({ accentColor: color });
      });
    }

    shortcutInputs.forEach((input) => {
      input.addEventListener('keydown', (event) => handleShortcutCapture(event, input));
      input.addEventListener('focus', () => input.select());
      input.addEventListener('blur', () => restoreShortcutInput(input));
    });
  }

  function buildQuickActionList() {
    if (!quickActionList) return;
    quickActionList.innerHTML = '';
    quickActionElements = {};

    quickActions.forEach((action) => {
      const item = document.createElement('li');
      item.className = 'quick-action-item';
      item.dataset.actionId = action.id;

      const info = document.createElement('div');
      info.className = 'quick-action-info';

      const icon = document.createElement('div');
      icon.className = 'quick-action-icon';
      icon.textContent = action.icon || '⚡';

      const textWrap = document.createElement('div');
      textWrap.className = 'quick-action-text';

      const label = document.createElement('span');
      label.className = 'quick-action-label';
      label.textContent = action.label;

      const description = document.createElement('span');
      description.className = 'quick-action-description';
      description.textContent = action.description || '';

      textWrap.append(label, description);
      info.append(icon, textWrap);

      const controls = document.createElement('div');
      controls.className = 'quick-action-controls';

      const orderBadge = document.createElement('span');
      orderBadge.className = 'quick-action-order';
      orderBadge.textContent = '-';

      const upButton = document.createElement('button');
      upButton.type = 'button';
      upButton.className = 'quick-action-reorder';
      upButton.setAttribute('aria-label', `${action.label} 위로 이동`);
      upButton.innerHTML = '▲';

      const downButton = document.createElement('button');
      downButton.type = 'button';
      downButton.className = 'quick-action-reorder';
      downButton.setAttribute('aria-label', `${action.label} 아래로 이동`);
      downButton.innerHTML = '▼';

      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'quick-action-toggle';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.setAttribute('aria-label', `${action.label} 사용 여부`);
      toggleLabel.append(checkbox, document.createTextNode('사용'));

      controls.append(orderBadge, upButton, downButton, toggleLabel);
      item.append(info, controls);
      quickActionList.appendChild(item);

      upButton.addEventListener('click', () => {
        moveQuickAction(action.id, -1);
      });
      downButton.addEventListener('click', () => {
        moveQuickAction(action.id, 1);
      });
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          if (!selectedActions.includes(action.id)) {
            selectedActions = selectedActions.concat(action.id);
          }
        } else {
          selectedActions = selectedActions.filter((id) => id !== action.id);
        }
        renderQuickActionState();
        commitQuickActions();
      });

      quickActionElements[action.id] = {
        root: item,
        checkbox,
        orderBadge,
        upButton,
        downButton,
      };
    });
  }

  function moveQuickAction(actionId, direction) {
    const index = selectedActions.indexOf(actionId);
    if (index === -1) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= selectedActions.length) return;
    const updated = selectedActions.slice();
    const [moved] = updated.splice(index, 1);
    updated.splice(nextIndex, 0, moved);
    selectedActions = updated;
    renderQuickActionState();
    commitQuickActions();
  }

  function renderQuickActionState() {
    Object.keys(quickActionElements).forEach((id) => {
      const element = quickActionElements[id];
      const position = selectedActions.indexOf(id);
      const isSelected = position !== -1;
      if (element.checkbox.checked !== isSelected) {
        element.checkbox.checked = isSelected;
      }
      element.root.dataset.selected = isSelected ? 'true' : 'false';
      element.orderBadge.textContent = isSelected ? String(position + 1) : '-';
      element.upButton.disabled = !isSelected || position === 0;
      element.downButton.disabled = !isSelected || position === selectedActions.length - 1;
    });
  }

  function updateUI(preferences) {
    if (!preferences) return;
    updating = true;
    selectedActions = Array.isArray(preferences.quickActions)
      ? preferences.quickActions.slice()
      : [];
    updateThemeUI(preferences);
    updateFontUI(preferences);
    updateAccentUI(preferences);
    renderQuickActionState();
    updateShortcutUI(preferences);
    updatePreview(preferences);
    updating = false;
  }

  function updateThemeUI(preferences) {
    themeInputs.forEach((input) => {
      const isSelected = input.value === preferences.theme;
      input.checked = isSelected;
      const option = input.closest('.theme-option');
      if (option) {
        option.dataset.selected = isSelected ? 'true' : 'false';
      }
    });
  }

  function updateFontUI(preferences) {
    fontButtons.forEach((button) => {
      const scale = button.getAttribute('data-font-scale');
      button.classList.toggle('is-active', scale === preferences.fontScale);
    });
  }

  function updateAccentUI(preferences) {
    if (accentInput) {
      accentInput.value = normalizeColorForInput(preferences.accentColor);
    }
    if (accentSwatchesRoot) {
      const swatches = accentSwatchesRoot.querySelectorAll('[data-accent-swatch]');
      swatches.forEach((swatch) => {
        const value = swatch.getAttribute('data-accent-swatch');
        swatch.classList.toggle('is-active', value && value.toLowerCase() === (preferences.accentColor || '').toLowerCase());
      });
    }
  }

  function commitQuickActions() {
    if (!store || updating) return;
    store.set({ quickActions: selectedActions.slice(0, 4) });
  }

  function updateShortcutUI(preferences) {
    if (!preferences.shortcuts) return;
    shortcutInputs.forEach((input) => {
      const key = input.getAttribute('data-shortcut-input');
      const value = preferences.shortcuts[key];
      const formatted = store.formatShortcut ? store.formatShortcut(value) : value;
      if (typeof formatted === 'string') {
        input.value = formatted;
      }
    });
  }

  function updatePreview(preferences) {
    if (!previewContainer) return;
    if (previewThemeLabel) {
      previewThemeLabel.textContent = THEME_LABELS[preferences.theme] || '자동';
    }
    if (previewFontLabel) {
      previewFontLabel.textContent = FONT_LABELS[preferences.fontScale] || '';
    }
    if (previewColorLabel) {
      previewColorLabel.textContent = (preferences.accentColor || '#6366f1').toUpperCase();
    }
    if (previewText) {
      previewText.textContent = '선택한 설정이 전체 서비스에 바로 적용됩니다.';
    }
    if (previewActions) {
      previewActions.innerHTML = '';
      const actions = Array.isArray(preferences.quickActions) ? preferences.quickActions : [];
      if (!actions.length) {
        const placeholder = document.createElement('span');
        placeholder.className = 'preview-chip preview-chip--empty';
        placeholder.textContent = '퀵 액션 미등록';
        previewActions.appendChild(placeholder);
      } else {
        actions.slice(0, 4).forEach((id) => {
          const action = quickActionMap[id];
          const chip = document.createElement('span');
          chip.className = 'preview-chip';
          chip.textContent = action ? action.label : id;
          previewActions.appendChild(chip);
        });
      }
    }
  }

  function restoreShortcutInput(input) {
    if (!store) return;
    const key = input.getAttribute('data-shortcut-input');
    const prefs = store.get();
    if (!prefs || !prefs.shortcuts) return;
    const current = prefs.shortcuts[key];
    const formatted = store.formatShortcut ? store.formatShortcut(current) : current;
    if (typeof formatted === 'string') {
      input.value = formatted;
    }
  }

  function handleShortcutCapture(event, input) {
    if (!store) return;
    event.preventDefault();
    event.stopPropagation();

    const keyName = input.getAttribute('data-shortcut-input');
    if (!keyName) return;

    if (event.key === 'Backspace' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      const defaults = store.getDefaultPreferences ? store.getDefaultPreferences() : null;
      const fallback = defaults?.shortcuts?.[keyName] || '';
      applyShortcut(keyName, fallback, input);
      return;
    }

    const ignoreKeys = ['control', 'shift', 'alt', 'meta'];
    const parts = [];
    if (event.ctrlKey) parts.push('ctrl');
    if (event.metaKey) parts.push('cmd');
    if (event.altKey) parts.push('alt');
    if (event.shiftKey) parts.push('shift');

    const key = (event.key || '').toLowerCase();
    if (!ignoreKeys.includes(key)) {
      parts.push(key.length === 1 ? key : key);
      const combo = parts.join('+');
      applyShortcut(keyName, combo, input);
    }
  }

  function applyShortcut(keyName, shortcut, input) {
    if (!store) return;
    const preferences = store.get();
    const currentShortcuts = preferences?.shortcuts ? { ...preferences.shortcuts } : {};
    currentShortcuts[keyName] = shortcut;
    store.set({ shortcuts: currentShortcuts });
    const formatted = store.formatShortcut ? store.formatShortcut(shortcut) : shortcut;
    if (typeof formatted === 'string') {
      input.value = formatted;
    }
  }

  ensureStoreReady();
})();
