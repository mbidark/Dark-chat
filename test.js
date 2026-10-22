/**
 * DARKCHAT — Test Suite
 * Automated pure unit and domain logic tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeName,
  cleanDisplayName,
  validateName,
  generatePublicId,
  validateMessage,
  isOwnerName,
  groupVisitorsByName,
  sortAndDeduplicateMessages,
  formatTimestamp,
} from './utils.js';

test('Name normalization trims and collapses whitespace case-insensitively', () => {
  assert.equal(normalizeName('Sabbir'), 'sabbir');
  assert.equal(normalizeName('  Sabbir  '), 'sabbir');
  assert.equal(normalizeName('SABBIR'), 'sabbir');
  assert.equal(normalizeName('  Sabbir   Khan  '), 'sabbir khan');
  assert.equal(normalizeName('sabbir   khan'), 'sabbir khan');
});

test('Clean display name trims while preserving capitalization', () => {
  assert.equal(cleanDisplayName('  Sabbir Khan  '), 'Sabbir Khan');
  assert.equal(cleanDisplayName('  Mbi   Dark  '), 'Mbi Dark');
});

test('Name validation enforces 2 to 32 characters and rejects invalid chars', () => {
  assert.equal(validateName('S').valid, false);
  assert.equal(validateName('').valid, false);
  assert.equal(validateName('   ').valid, false);
  assert.equal(validateName('Sabbir').valid, true);
  assert.equal(validateName('A'.repeat(33)).valid, false);
  assert.equal(validateName('Valid Name 123').valid, true);
  assert.equal(validateName('<script>alert()</script>').valid, false);
});

test('Unique Public ID generates 6-character uppercase alphanumeric and avoids collisions', () => {
  const existing = new Set(['A7K2M9', 'B1C2D3']);
  const id = generatePublicId(existing);
  assert.equal(id.length, 6);
  assert.match(id, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  assert.equal(existing.has(id), false);

  // Generate 100 IDs to test collision avoidance
  const set = new Set();
  for (let i = 0; i < 100; i++) {
    const newId = generatePublicId(set);
    assert.equal(set.has(newId), false);
    set.add(newId);
  }
  assert.equal(set.size, 100);
});

test('Message validation enforces length and emptiness boundaries', () => {
  assert.equal(validateMessage('').valid, false);
  assert.equal(validateMessage('   \n  ').valid, false);
  assert.equal(validateMessage('Hello terminal').valid, true);
  assert.equal(validateMessage('A'.repeat(1001)).valid, false);
  assert.equal(validateMessage('A'.repeat(1000)).valid, true);
});

test('isOwnerName correctly identifies MBI DARK case-insensitively with whitespace handling', () => {
  assert.equal(isOwnerName('MBI DARK'), true);
  assert.equal(isOwnerName('mbi dark'), true);
  assert.equal(isOwnerName('  MBI   DARK  '), true);
  assert.equal(isOwnerName('Mbi Dark'), true);
  assert.equal(isOwnerName('Sabbir'), false);
  assert.equal(isOwnerName('MBI DARK HOST'), false);
  assert.equal(isOwnerName(''), false);
});

test('Same-name grouping merges matching normalized display names into one inbox group', () => {
  const visitors = [
    { id: 'v1', publicId: 'A7K2M9', displayName: 'Sabbir', unreadCount: 1, lastActiveAt: 1000 },
    { id: 'v2', publicId: 'Q4P8X2', displayName: 'sabbir', unreadCount: 0, lastActiveAt: 2000 },
    { id: 'v3', publicId: 'M6T9B3', displayName: 'SABBIR', unreadCount: 2, lastActiveAt: 3000 },
    { id: 'v4', publicId: 'R8W1K5', displayName: 'Tareq', unreadCount: 0, lastActiveAt: 1500 },
  ];

  const groups = groupVisitorsByName(visitors);
  assert.equal(groups.length, 2);

  const sabbirGroup = groups.find(g => g.normalizedName === 'sabbir');
  assert.ok(sabbirGroup);
  assert.equal(sabbirGroup.visitors.length, 3);
  assert.equal(sabbirGroup.hasUnread, true);
  assert.equal(sabbirGroup.totalUnread, 3);
  assert.equal(sabbirGroup.latestActivity, 3000);

  const tareqGroup = groups.find(g => g.normalizedName === 'tareq');
  assert.ok(tareqGroup);
  assert.equal(tareqGroup.visitors.length, 1);
  assert.equal(tareqGroup.hasUnread, false);
});

test('Message deduplication and chronological ordering', () => {
  const messages = [
    { id: 'm3', text: 'Third', createdAt: 3000 },
    { id: 'm1', text: 'First', createdAt: 1000 },
    { id: 'm2', text: 'Second', createdAt: 2000 },
    { id: 'm1', text: 'First duplicate', createdAt: 1000 }, // Duplicate ID
  ];

  const sorted = sortAndDeduplicateMessages(messages);
  assert.equal(sorted.length, 3);
  assert.equal(sorted[0].id, 'm1');
  assert.equal(sorted[1].id, 'm2');
  assert.equal(sorted[2].id, 'm3');
});

test('Broadcast messages to group appear only once in grouped transcript', () => {
  const messages = [
    { id: 'b1', broadcastId: 'bcast_123', text: 'Broadcast to all', createdAt: 1000 },
    { id: 'b2', broadcastId: 'bcast_123', text: 'Broadcast to all', createdAt: 1000 },
    { id: 'b3', broadcastId: 'bcast_123', text: 'Broadcast to all', createdAt: 1000 },
    { id: 'indiv', text: 'Individual message', createdAt: 1050 }
  ];

  const sorted = sortAndDeduplicateMessages(messages);
  assert.equal(sorted.length, 2);
  assert.equal(sorted[0].broadcastId, 'bcast_123');
  assert.equal(sorted[1].id, 'indiv');
});

test('Terminal timestamp formatting produces [HH:MM:SS]', () => {
  const ts = formatTimestamp(new Date('2026-10-22T10:15:30'));
  assert.match(ts, /^\[\d{2}:\d{2}:\d{2}\]$/);
});
