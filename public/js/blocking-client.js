(function initBlockingClient(global) {
  if (global.BlockingClient) {
    return global.BlockingClient;
  }

  const state = {
    blockMap: new Map(),
    subscribers: new Set(),
    pendingRefresh: null,
  };

  function toId(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (value && typeof value === 'object') {
      if (typeof value.id === 'string') return value.id;
      if (value.id != null) return String(value.id);
      if (typeof value._id === 'string') return value._id;
      if (value._id != null) return String(value._id);
    }
    return null;
  }

  function normalizeBlock(data) {
    if (!data || typeof data !== 'object') {
      return null;
    }
    const id = toId(data.id ?? data._id ?? data.userId);
    if (!id) {
      return null;
    }
    return {
      id,
      username: data.username || '',
      name: data.name || '',
      photo: data.photo || data.profilePhoto || '',
    };
  }

  function snapshot() {
    return Array.from(state.blockMap.values());
  }

  function notifySubscribers() {
    const data = snapshot();
    state.subscribers.forEach((listener) => {
      try {
        listener(data);
      } catch (error) {
        console.error('[BlockingClient] subscriber error', error);
      }
    });
  }

  async function resolveToken(explicitToken) {
    if (explicitToken) return explicitToken;
    if (typeof global.requireAuthToken === 'function') {
      const token = await global.requireAuthToken();
      if (token) return token;
    }
    const stored = global.localStorage?.getItem('token');
    if (!stored) {
      throw new Error('로그인이 필요합니다.');
    }
    return stored;
  }

  function applyBlocks(blocks) {
    state.blockMap.clear();
    if (Array.isArray(blocks)) {
      blocks.forEach((entry) => {
        const normalized = normalizeBlock(entry);
        if (normalized) {
          state.blockMap.set(normalized.id, normalized);
        }
      });
    }
    notifySubscribers();
    return snapshot();
  }

  function upsertBlock(entry) {
    const normalized = normalizeBlock(entry);
    if (!normalized) return snapshot();
    const existing = state.blockMap.get(normalized.id) || {};
    state.blockMap.set(normalized.id, {
      ...existing,
      ...normalized,
    });
    notifySubscribers();
    return snapshot();
  }

  function removeBlock(userId) {
    const key = toId(userId);
    if (!key) return snapshot();
    state.blockMap.delete(key);
    notifySubscribers();
    return snapshot();
  }

  async function refresh(options = {}) {
    if (state.pendingRefresh && !options.force) {
      return state.pendingRefresh;
    }

    state.pendingRefresh = (async () => {
      const token = await resolveToken(options.token).catch((error) => {
        if (options.silent) {
          console.warn('[BlockingClient] token unavailable', error);
          applyBlocks([]);
          return snapshot();
        }
        throw error;
      });

      if (!token) {
        applyBlocks([]);
        return snapshot();
      }

      const response = await fetch('/api/users/blocks', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'same-origin',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload?.error || '차단 목록을 불러오지 못했습니다.');
        if (options.silent) {
          console.warn('[BlockingClient] refresh failed', error);
          return snapshot();
        }
        throw error;
      }
      const blocks = Array.isArray(payload.blocks) ? payload.blocks : [];
      return applyBlocks(blocks);
    })()
      .finally(() => {
        state.pendingRefresh = null;
      });

    return state.pendingRefresh;
  }

  async function block(userId, options = {}) {
    const targetId = toId(userId);
    if (!targetId) {
      throw new Error('차단할 사용자를 지정해 주세요.');
    }

    const token = await resolveToken(options.token);
    const response = await fetch('/api/users/blocks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      credentials: 'same-origin',
      body: JSON.stringify({ userId: targetId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || '사용자를 차단하지 못했습니다.');
    }

    const blockInfo = payload?.blocked || { id: targetId };
    upsertBlock(blockInfo);

    return {
      block: normalizeBlock(blockInfo),
      message: payload?.message || '',
    };
  }

  async function unblock(userId, options = {}) {
    const targetId = toId(userId);
    if (!targetId) {
      throw new Error('차단 해제 대상을 지정해 주세요.');
    }

    const token = await resolveToken(options.token);
    const response = await fetch(`/api/users/blocks/${targetId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || '차단을 해제하지 못했습니다.');
    }

    removeBlock(payload?.unblocked || targetId);
    return {
      unblocked: payload?.unblocked || targetId,
      message: payload?.message || '',
    };
  }

  function isBlocked(userId) {
    const key = toId(userId);
    if (!key) return false;
    return state.blockMap.has(key);
  }

  function getBlockedSet() {
    return new Set(state.blockMap.keys());
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }
    state.subscribers.add(listener);
    try {
      listener(snapshot());
    } catch (error) {
      console.error('[BlockingClient] initial subscriber call failed', error);
    }
    return () => {
      state.subscribers.delete(listener);
    };
  }

  const api = {
    refresh,
    block,
    unblock,
    isBlocked,
    getBlockedSet,
    getBlocks: snapshot,
    subscribe,
  };

  global.BlockingClient = api;
  return api;
})(window);
