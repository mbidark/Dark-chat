/**
 * DARKCHAT — Core Utilities and Pure Domain Logic
 * MBI DARK | Zero-to-Production
 */

/**
 * Normalizes a display name for shared inbox grouping:
 * 1. Trims leading and trailing whitespace.
 * 2. Collapses repeated internal whitespace into a single space.
 * 3. Compares case-insensitively (lowercase).
 *
 * Example: "  Sabbir   Khan  " -> "sabbir khan"
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Sanitizes and cleans a display name while preserving original capitalization.
 *
 * @param {string} name
 * @returns {string}
 */
export function cleanDisplayName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().replace(/\s+/g, ' ');
}

/**
 * Validates a visitor display name.
 * Length: 2 to 32 characters.
 *
 * @param {string} name
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateName(name) {
  if (typeof name !== 'string') {
    return { valid: false, error: 'Name must be a valid string.' };
  }
  const cleaned = cleanDisplayName(name);
  if (cleaned.length < 2) {
    return { valid: false, error: 'Name too short. Minimum 2 characters required.' };
  }
  if (cleaned.length > 32) {
    return { valid: false, error: 'Name too long. Maximum 32 characters allowed.' };
  }
  // Disallow control characters or script injections
  if (/[\u0000-\u001F\u007F<>]/.test(cleaned)) {
    return { valid: false, error: 'Invalid characters in name.' };
  }
  return { valid: true };
}

/**
 * Generates an authoritative, unambiguous 6-character public visitor ID.
 * Example: "A7K2M9", "Q4P8X2", "M6T9B3".
 *
 * @param {Set<string>|Array<string>} [existingIds]
 * @returns {string}
 */
export function generatePublicId(existingIds) {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Excludes 0, 1, I, O for visual clarity
  const existingSet = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  const maxAttempts = 100;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let id = '';
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const bytes = new Uint8Array(6);
      crypto.getRandomValues(bytes);
      for (let i = 0; i < 6; i++) {
        id += chars[bytes[i] % chars.length];
      }
    } else {
      for (let i = 0; i < 6; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
      }
    }

    if (!existingSet.has(id)) {
      return id;
    }
  }
  // Fallback with timestamp suffix to guarantee uniqueness under severe collision
  return 'DC' + Date.now().toString(36).toUpperCase().slice(-4);
}

/**
 * Validates message content.
 * Maximum 1000 characters, non-empty after trimming.
 *
 * @param {string} text
 * @returns {{ valid: boolean, error?: string, sanitized?: string }}
 */
export function validateMessage(text) {
  if (typeof text !== 'string') {
    return { valid: false, error: 'Message must be a string.' };
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Message cannot be empty.' };
  }
  if (text.length > 1000) {
    return { valid: false, error: 'Message exceeds 1000 character limit.' };
  }
  return { valid: true, sanitized: text };
}

/**
 * Checks if the entered name matches the privileged Owner identity "MBI DARK"
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isOwnerName(name) {
  if (typeof name !== 'string') return false;
  return normalizeName(name) === 'mbi dark';
}

/**
 * Formats a Date or timestamp into terminal timestamp format [HH:MM:SS].
 *
 * @param {Date|number|string} date
 * @returns {string}
 */
export function formatTimestamp(date) {
  const d = date ? new Date(date) : new Date();
  if (isNaN(d.getTime())) return '[--:--:--]';
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `[${hours}:${minutes}:${seconds}]`;
}

/**
 * Groups visitors and calculates unread statuses by normalized display name.
 *
 * @param {Array<object>} visitors
 * @returns {Array<object>}
 */
export function groupVisitorsByName(visitors) {
  if (!Array.isArray(visitors)) return [];
  const groupsMap = new Map();

  for (const visitor of visitors) {
    if (!visitor || !visitor.displayName) continue;
    const normalized = normalizeName(visitor.displayName);
    if (!groupsMap.has(normalized)) {
      groupsMap.set(normalized, {
        normalizedName: normalized,
        displayName: visitor.displayName,
        visitors: [],
        hasUnread: false,
        totalUnread: 0,
        latestActivity: 0,
      });
    }
    const group = groupsMap.get(normalized);
    group.visitors.push(visitor);
    const unreadCount = Number(visitor.unreadCount || 0);
    if (unreadCount > 0) {
      group.hasUnread = true;
      group.totalUnread += unreadCount;
    }
    const lastActive = visitor.lastActiveAt ? new Date(visitor.lastActiveAt).getTime() : 0;
    if (lastActive > group.latestActivity) {
      group.latestActivity = lastActive;
    }
  }

  return Array.from(groupsMap.values()).sort((a, b) => b.latestActivity - a.latestActivity);
}

/**
 * Merges and sorts messages for a grouped transcript chronologically,
 * guaranteeing no duplicate message IDs, and ensuring broadcast messages appear only once.
 *
 * @param {Array<object>} messages
 * @returns {Array<object>}
 */
export function sortAndDeduplicateMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const seenIds = new Set();
  const seenBroadcasts = new Set();
  const deduped = [];

  for (const msg of messages) {
    if (!msg || !msg.id) continue;
    if (seenIds.has(msg.id)) continue;
    seenIds.add(msg.id);

    if (msg.broadcastId) {
      if (seenBroadcasts.has(msg.broadcastId)) continue;
      seenBroadcasts.add(msg.broadcastId);
    }

    deduped.push(msg);
  }

  return deduped.sort((a, b) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeA - timeB;
  });
}
