/**
 * DARKCHAT — Owner Dashboard Application
 * MBI DARK | Zero-to-Production
 * Grouped Inbox, Real-Time Streams, [Dark] Prefix, Visitor IP Inspector & IP Blocking
 */

import {
  groupVisitorsByName,
  sortAndDeduplicateMessages,
  formatTimestamp,
  validateMessage
} from './utils.js';

import {
  verifyOwnerPassword,
  subscribeToVisitors,
  subscribeToMessages,
  sendMessage,
  markVisitorMessagesAsRead,
  setTypingStatus,
  subscribeToTypingStatus
} from './firebase.js';

// DOM Elements
const ownerSidebar = document.getElementById('ownerSidebar');
const brandToggleBtn = document.getElementById('brandToggleBtn');
const brandMainToggleBtn = document.getElementById('brandMainToggleBtn');
const inboxList = document.getElementById('inboxList');
const recipientSelect = document.getElementById('recipientSelect');
const activeGroupInfo = document.getElementById('activeGroupInfo');
const ownerTermInput = document.getElementById('ownerTermInput');
const ownerVisualText = document.getElementById('ownerVisualText');
const ownerCursor = document.getElementById('ownerCursor');
const ownerPromptPrefix = document.getElementById('ownerPromptPrefix');
const ownerTranscript = document.getElementById('ownerTranscript');
const ownerTranscriptLines = document.getElementById('ownerTranscriptLines');
const ownerInputRow = document.getElementById('ownerInputRow');
const ownerTypingIndicator = document.getElementById('ownerTypingIndicator');
const refreshInboxBtn = document.getElementById('refreshInboxBtn');
const logoutBtn = document.getElementById('logoutBtn');

// IP Modal Elements
const ipBlockModalBtn = document.getElementById('ipBlockModalBtn');
const ipModal = document.getElementById('ipModal');
const blockedIpList = document.getElementById('blockedIpList');
const targetIpInput = document.getElementById('targetIpInput');
const blockIpActionBtn = document.getElementById('blockIpActionBtn');
const ipModalMessage = document.getElementById('ipModalMessage');
const closeIpModalBtn = document.getElementById('closeIpModalBtn');

// Auth Modals
const loginModal = document.getElementById('loginModal');
const ownerPasswordInput = document.getElementById('ownerPasswordInput');
const ownerLoginBtn = document.getElementById('ownerLoginBtn');
const loginError = document.getElementById('loginError');

// State
let allVisitors = [];
let groupedInbox = [];
let activeGroup = null;
let currentOwner = null;
let transcriptUnsubscribers = [];
const currentGroupMessages = new Map();
let ownerTypingTimeout = null;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function appendTranscriptLine(content, type = '') {
  const line = document.createElement('div');
  line.className = `term-line ${type} fade-in`;
  line.innerHTML = content;
  if (ownerTranscriptLines) {
    ownerTranscriptLines.appendChild(line);
  }
  scrollOwnerToBottom();
}

function scrollOwnerToBottom() {
  requestAnimationFrame(() => {
    if (ownerTranscript) {
      ownerTranscript.scrollTop = ownerTranscript.scrollHeight;
    }
  });
}

function syncOwnerInputDisplay() {
  const text = ownerTermInput.value || '';
  const start = ownerTermInput.selectionStart ?? text.length;

  if (start < text.length) {
    const before = text.slice(0, start);
    const char = text.slice(start, start + 1);
    const after = text.slice(start + 1);

    ownerVisualText.textContent = before;
    ownerCursor.className = 'term-cursor cursor-char';
    ownerCursor.textContent = char;

    let afterNode = ownerCursor.nextSibling;
    if (!afterNode || afterNode.nodeType !== Node.TEXT_NODE) {
      afterNode = document.createTextNode('');
      document.getElementById('ownerInputWrapper').appendChild(afterNode);
    }
    afterNode.textContent = after;
  } else {
    ownerVisualText.textContent = text;
    ownerCursor.className = 'term-cursor';
    ownerCursor.textContent = '█';

    if (ownerCursor.nextSibling) {
      ownerCursor.nextSibling.textContent = '';
    }
  }

  ownerTermInput.style.height = 'auto';
  ownerTermInput.style.height = Math.max(24, ownerTermInput.scrollHeight) + 'px';
  scrollOwnerToBottom();
}

function updateOwnerPromptPrefix() {
  const selectedRecipient = recipientSelect.value;
  if (!activeGroup) {
    ownerPromptPrefix.textContent = `~ (Dark) $ `;
    return;
  }
  if (selectedRecipient === 'ALL') {
    ownerPromptPrefix.textContent = `~ (Dark -> ALL ${activeGroup.displayName.toUpperCase()}) $ `;
  } else {
    const v = activeGroup.visitors.find(vis => vis.id === selectedRecipient);
    const label = v ? v.publicId : selectedRecipient;
    ownerPromptPrefix.textContent = `~ (Dark -> [${label}]) $ `;
  }
}

function renderInbox() {
  groupedInbox = groupVisitorsByName(allVisitors);
  inboxList.innerHTML = '';

  if (groupedInbox.length === 0) {
    inboxList.innerHTML = `
      <li class="term-line system-line" style="padding: 12px 14px;">
        [NO ACTIVE VISITOR THREADS]
      </li>
    `;
    return;
  }

  for (const group of groupedInbox) {
    const li = document.createElement('li');
    li.className = 'inbox-item';
    if (activeGroup && activeGroup.normalizedName === group.normalizedName) {
      li.classList.add('active');
    }

    const unreadDot = group.hasUnread ? '<span class="unread-dot"></span>' : '';
    const userCount = group.visitors.length > 1 ? `[${group.visitors.length} users]` : `[1 user]`;

    const chipsHtml = group.visitors.map(v => 
      `<span class="visitor-chip">${escapeHtml(v.publicId || 'ID')}</span>`
    ).join(' ');

    li.innerHTML = `
      <div class="inbox-item-header">
        <div class="inbox-title-group">
          ${unreadDot}
          <span class="inbox-name">${escapeHtml(group.displayName)}</span>
        </div>
        <span class="inbox-user-count">${userCount}</span>
      </div>
      <div class="inbox-visitor-chips">
        ${chipsHtml}
      </div>
    `;

    li.addEventListener('click', () => {
      selectGroup(group);
    });

    inboxList.appendChild(li);
  }
}

async function selectGroup(group) {
  activeGroup = group;
  renderInbox();

  activeGroupInfo.textContent = `GROUP: ${group.displayName.toUpperCase()} (${group.visitors.length} ID${group.visitors.length > 1 ? 'S' : ''})`;

  recipientSelect.innerHTML = `<option value="ALL">ALL USERS (BROADCAST TO GROUP)</option>`;
  for (const v of group.visitors) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = `[${v.publicId}] ${v.displayName}`;
    recipientSelect.appendChild(opt);
  }
  updateOwnerPromptPrefix();

  // Fetch and display IP for the first visitor in the group (or selected recipient)
  if (group.visitors.length > 0) {
    const primaryVisitor = group.visitors[0];
    try {
      const res = await fetch(`/api/ip/visitor/${primaryVisitor.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.ip) {
          activeGroupInfo.textContent = `GROUP: ${group.displayName.toUpperCase()} | IP: ${data.ip}`;
        }
      }
    } catch (e) {}
  }

  transcriptUnsubscribers.forEach(unsub => unsub());
  transcriptUnsubscribers = [];
  currentGroupMessages.clear();

  if (ownerInputRow) {
    ownerInputRow.style.display = 'flex';
  }

  ownerTranscriptLines.innerHTML = `
    <div class="term-line system-line">
      [TRANSCRIPT OPENED: ${escapeHtml(group.displayName)} - ${group.visitors.length} ACTIVE THREAD(S)]
    </div>
  `;

  for (const visitor of group.visitors) {
    markVisitorMessagesAsRead(visitor.id);

    const unsubMsg = subscribeToMessages(visitor.id, (msgs) => {
      currentGroupMessages.set(visitor.id, msgs);
      renderGroupTranscript();
    });
    transcriptUnsubscribers.push(unsubMsg);

    const unsubTyping = subscribeToTypingStatus(visitor.id, (status) => {
      if (status && status.sender === 'visitor' && status.isTyping) {
        ownerTypingIndicator.style.display = 'block';
        ownerTypingIndicator.textContent = `[${visitor.publicId}] is typing ▰ ▰ ▰`;
      } else {
        ownerTypingIndicator.style.display = 'none';
      }
    });
    transcriptUnsubscribers.push(unsubTyping);
  }

  ownerTermInput.focus();
  scrollOwnerToBottom();
}

function renderGroupTranscript() {
  const allGroupMsgs = [];
  for (const [, msgs] of currentGroupMessages.entries()) {
    allGroupMsgs.push(...msgs);
  }

  const sortedMsgs = sortAndDeduplicateMessages(allGroupMsgs);
  ownerTranscriptLines.innerHTML = `
    <div class="term-line system-line">
      [COMBINED TRANSCRIPT FOR "${escapeHtml(activeGroup.displayName)}" // ${sortedMsgs.length} MESSAGES]
    </div>
  `;

  for (const msg of sortedMsgs) {
    const timeStr = `<span class="term-time">${formatTimestamp(msg.createdAt)}</span>`;
    let lineHtml = '';

    if (msg.sender === 'owner') {
      const recipientBadge = msg.recipient === 'ALL' || msg.recipient === 'all'
        ? `<span class="term-sender-owner">[Dark -> ALL]</span>`
        : `<span class="term-sender-owner">[Dark -> ${msg.publicId || 'USER'}]</span>`;
      lineHtml = `${timeStr} ${recipientBadge}: ${escapeHtml(msg.text)}`;
    } else {
      const idBadge = `<span class="term-public-id">[${msg.publicId || 'VISITOR'}]</span>`;
      lineHtml = `${timeStr} ${idBadge} <span class="term-sender-visitor">${escapeHtml(msg.displayName)}:</span> ${escapeHtml(msg.text)}`;
    }

    const line = document.createElement('div');
    line.className = 'term-line fade-in';
    line.innerHTML = lineHtml;
    ownerTranscriptLines.appendChild(line);
  }

  scrollOwnerToBottom();
}

async function handleOwnerMessageSubmission() {
  if (!activeGroup) {
    appendTranscriptLine(`[ERROR] Please select an inbox group first.`, 'error-line');
    return;
  }

  const rawText = ownerTermInput.value;
  ownerTermInput.value = '';
  syncOwnerInputDisplay();

  const validation = validateMessage(rawText);
  if (!validation.valid) {
    appendTranscriptLine(`[ERROR] ${validation.error}`, 'error-line');
    return;
  }

  const targetRecipient = recipientSelect.value;

  if (targetRecipient === 'ALL') {
    const broadcastId = 'bcast_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    for (const visitor of activeGroup.visitors) {
      await sendMessage({
        visitorId: visitor.id,
        publicId: visitor.publicId,
        displayName: visitor.displayName,
        sender: 'owner',
        text: validation.sanitized,
        recipient: 'ALL',
        broadcastId
      });
    }
  } else {
    const visitor = activeGroup.visitors.find(v => v.id === targetRecipient);
    if (!visitor) {
      appendTranscriptLine(`[ERROR] Recipient visitor not found.`, 'error-line');
      return;
    }
    await sendMessage({
      visitorId: visitor.id,
      publicId: visitor.publicId,
      displayName: visitor.displayName,
      sender: 'owner',
      text: validation.sanitized,
      recipient: visitor.id
    });
  }

  ownerTermInput.focus();
  scrollOwnerToBottom();
}

async function loadBlockedIpList() {
  blockedIpList.innerHTML = `<span class="term-line system-line">[Loading blocked IPs...]</span>`;
  try {
    const res = await fetch('/api/ip/list');
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.blockedIps)) {
        if (data.blockedIps.length === 0) {
          blockedIpList.innerHTML = `<span class="term-line system-line">No IP addresses currently blocked.</span>`;
          return;
        }
        blockedIpList.innerHTML = data.blockedIps.map(ip => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid rgba(0,255,102,0.1);">
            <span>${escapeHtml(ip)}</span>
            <button class="term-btn unblock-ip-btn" data-ip="${escapeHtml(ip)}" style="font-size: 10px; padding: 2px 6px;">UNBLOCK</button>
          </div>
        `).join('');

        document.querySelectorAll('.unblock-ip-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const ipToUnblock = e.target.getAttribute('data-ip');
            await unblockIpAddress(ipToUnblock);
          });
        });
      }
    }
  } catch (err) {
    blockedIpList.innerHTML = `<span class="term-line error-line">[Failed to load blocked IPs]</span>`;
  }
}

async function blockIpAddress(ip) {
  if (!ip) return;
  try {
    const res = await fetch('/api/ip/block', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip })
    });
    const data = await res.json();
    if (data.success) {
      ipModalMessage.textContent = data.message;
      ipModalMessage.className = 'term-line success-line';
      ipModalMessage.style.display = 'block';
      targetIpInput.value = '';
      loadBlockedIpList();
    } else {
      ipModalMessage.textContent = data.error || 'Failed to block IP.';
      ipModalMessage.className = 'term-line error-line';
      ipModalMessage.style.display = 'block';
    }
  } catch (err) {
    ipModalMessage.textContent = 'Network error blocking IP.';
    ipModalMessage.className = 'term-line error-line';
    ipModalMessage.style.display = 'block';
  }
}

async function unblockIpAddress(ip) {
  if (!ip) return;
  try {
    const res = await fetch('/api/ip/unblock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip })
    });
    const data = await res.json();
    if (data.success) {
      ipModalMessage.textContent = data.message;
      ipModalMessage.className = 'term-line success-line';
      ipModalMessage.style.display = 'block';
      loadBlockedIpList();
    }
  } catch (err) {}
}

function toggleSidebar() {
  const isCollapsed = ownerSidebar.classList.toggle('collapsed');
  if (brandMainToggleBtn) {
    brandMainToggleBtn.style.display = isCollapsed ? 'inline-block' : 'none';
  }
}

function setupEventListeners() {
  brandToggleBtn.addEventListener('click', toggleSidebar);
  if (brandMainToggleBtn) {
    brandMainToggleBtn.addEventListener('click', toggleSidebar);
  }

  ['input', 'keyup', 'keydown', 'click', 'focus', 'select'].forEach(ev => {
    ownerTermInput.addEventListener(ev, syncOwnerInputDisplay);
  });

  ownerTermInput.addEventListener('input', () => {
    if (activeGroup) {
      for (const v of activeGroup.visitors) {
        setTypingStatus(v.id, 'owner', true);
      }
      clearTimeout(ownerTypingTimeout);
      ownerTypingTimeout = setTimeout(() => {
        for (const v of activeGroup.visitors) {
          setTypingStatus(v.id, 'owner', false);
        }
      }, 2500);
    }
  });

  ownerTermInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) return;
      e.preventDefault();
      handleOwnerMessageSubmission();
    }
  });

  recipientSelect.addEventListener('change', updateOwnerPromptPrefix);

  refreshInboxBtn.addEventListener('click', () => {
    renderInbox();
  });

  ipBlockModalBtn.addEventListener('click', () => {
    ipModal.style.display = 'flex';
    ipModalMessage.style.display = 'none';
    loadBlockedIpList();
  });

  closeIpModalBtn.addEventListener('click', () => {
    ipModal.style.display = 'none';
  });

  blockIpActionBtn.addEventListener('click', () => {
    const ip = targetIpInput.value.trim();
    if (ip) {
      if (window.confirm(`Are you sure you want to block IP address: ${ip}?`)) {
        blockIpAddress(ip);
      }
    }
  });

  logoutBtn.addEventListener('click', () => {
    loginModal.style.display = 'flex';
  });

  ownerLoginBtn.addEventListener('click', async () => {
    const pass = ownerPasswordInput.value;
    loginError.style.display = 'none';

    const res = await verifyOwnerPassword(pass);
    if (res.success) {
      currentOwner = res.user;
      loginModal.style.display = 'none';
      initializeOwnerStream();
    } else {
      loginError.textContent = res.error || 'Access denied.';
      loginError.style.display = 'block';
    }
  });

  ownerPasswordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      ownerLoginBtn.click();
    }
  });
}

function initializeOwnerStream() {
  subscribeToVisitors((visitors) => {
    allVisitors = visitors;
    renderInbox();
    if (activeGroup) {
      const updatedGroup = groupedInbox.find(g => g.normalizedName === activeGroup.normalizedName);
      if (updatedGroup) {
        activeGroup = updatedGroup;
      }
    }
  }, (error) => {
    const message = error?.code === 'permission-denied'
      ? 'OWNER ACCESS DENIED. Check the admins document UID and deploy firestore.rules.'
      : `VISITOR LIST FAILED: ${error?.message || 'Unknown error'}`;
    inboxList.innerHTML = `<li class="term-line error-line" style="padding: 12px 14px;">${escapeHtml(message)}</li>`;
  });
}

function initOwner() {
  setupEventListeners();
  syncOwnerInputDisplay();
  currentOwner = null;
  loginModal.style.display = 'flex';
  ownerPasswordInput.focus();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOwner);
} else {
  initOwner();
}
