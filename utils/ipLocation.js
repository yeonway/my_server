const axios = require('axios');

const cache = new Map();
const CACHE_TTL_MS = Number(process.env.IP_GEO_CACHE_TTL || 1000 * 60 * 60); // 1 hour default
const GEO_ENDPOINT = process.env.IP_GEO_ENDPOINT || 'https://ipapi.co';
const GEO_TIMEOUT = Number(process.env.IP_GEO_TIMEOUT || 1500);

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.16.')) return true;
  if (ip.startsWith('172.17.') || ip.startsWith('172.18.') || ip.startsWith('172.19.')) return true;
  if (ip.startsWith('172.20.') || ip.startsWith('172.21.') || ip.startsWith('172.22.')) return true;
  if (ip.startsWith('172.23.') || ip.startsWith('172.24.') || ip.startsWith('172.25.')) return true;
  if (ip.startsWith('172.26.') || ip.startsWith('172.27.') || ip.startsWith('172.28.')) return true;
  if (ip.startsWith('172.29.') || ip.startsWith('172.30.') || ip.startsWith('172.31.')) return true;
  return false;
}

function readCache(ip) {
  if (!ip || !cache.has(ip)) return null;
  const { value, expires } = cache.get(ip);
  if (Date.now() > expires) {
    cache.delete(ip);
    return null;
  }
  return value;
}

function writeCache(ip, value) {
  if (!ip) return;
  cache.set(ip, { value, expires: Date.now() + CACHE_TTL_MS });
}

async function lookupIpLocation(ip) {
  const normalized = (ip || '').trim();
  if (!normalized) {
    return { ip: '', isPrivate: true };
  }

  const cached = readCache(normalized);
  if (cached) return cached;

  if (isPrivateIp(normalized)) {
    const payload = {
      ip: normalized,
      isPrivate: true,
      country: null,
      countryCode: null,
      region: null,
      city: null,
      latitude: null,
      longitude: null,
      timezone: null,
    };
    writeCache(normalized, payload);
    return payload;
  }

  if (process.env.IP_GEO_DISABLED === 'true') {
    const payload = {
      ip: normalized,
      isPrivate: false,
    };
    writeCache(normalized, payload);
    return payload;
  }

  try {
    const url = `${GEO_ENDPOINT.replace(/\/$/, '')}/${encodeURIComponent(normalized)}/json/`;
    const response = await axios.get(url, { timeout: GEO_TIMEOUT });
    const data = response?.data || {};
    const payload = {
      ip: normalized,
      isPrivate: false,
      country: data.country_name || data.country || null,
      countryCode: data.country_code || null,
      region: data.region || data.region_name || null,
      city: data.city || null,
      latitude: typeof data.latitude === 'number' ? data.latitude : Number(data.latitude) || null,
      longitude: typeof data.longitude === 'number' ? data.longitude : Number(data.longitude) || null,
      timezone: data.timezone || null,
      org: data.org || data.org_name || data.asn || null,
    };
    writeCache(normalized, payload);
    return payload;
  } catch (error) {
    const payload = {
      ip: normalized,
      isPrivate: false,
      error: 'lookup_failed',
    };
    writeCache(normalized, payload);
    return payload;
  }
}

module.exports = {
  lookupIpLocation,
  isPrivateIp,
};
