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
  subscribeToTypingStatus,
  setVisitorBlocked
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
const blockUserBtn = document.getElementById('blockUserBtn');
const visitorAccessBtn = document.getElementById('visitorAccessBtn');
const visitorAccessModal = document.getElementById('visitorAccessModal');
const availableVisitorList = document.getElementById('availableVisitorList');
const blockedVisitorList = document.getElementById('blockedVisitorList');
const visitorAccessMessage = document.getElementById('visitorAccessMessage');
const closeVisitorAccessBtn = document.getElementById('closeVisitorAccessBtn');

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
    ownerPromptPrefix.textContent = `~ (Dark -> [${label}${v?.isBlocked ? ' BLOCKED' : ''}]) $ `;
  }
}

function renderInbox() {
  groupedInbox = groupVisitorsByName(allVisitors);
  inboxList.innerHTML = '';
  blockUserBtn.disabled = !activeGroup;

  if (groupedInbox.length === 0) {
    inboxList.innerHTML = `
      <li class="term-line system-line" style="padding: 12px 14px;">
        [NO ACTIVE VISITOR THREADS]
      </li>
    `;
    renderVisitorAccessLists();
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
      `<span class="visitor-chip${v.isBlocked ? ' blocked' : ''}">${escapeHtml(v.publicId || 'ID')}${v.isBlocked ? ' [BLOCKED]' : ''}</span>`
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
  renderVisitorAccessLists();
}

async function selectGroup(group) {
  activeGroup = group;
  renderInbox();

  activeGroupInfo.textContent = `GROUP: ${group.displayName.toUpperCase()} (${group.visitors.length} ID${group.visitors.length > 1 ? 'S' : ''})`;

  recipientSelect.innerHTML = `<option value="ALL">ALL USERS (BROADCAST TO GROUP)</option>`;
  for (const v of group.visitors) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = `[${v.publicId}] ${v.displayName}${v.isBlocked ? ' [BLOCKED]' : ''}`;
    opt.disabled = Boolean(v.isBlocked);
    recipientSelect.appendChild(opt);
  }
  updateOwnerPromptPrefix();

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
    const recipients = activeGroup.visitors.filter(visitor => !visitor.isBlocked);
    if (recipients.length === 0) {
      appendTranscriptLine(`[ERROR] There are no unblocked users in this group.`, 'error-line');
      return;
    }
    const broadcastId = 'bcast_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    for (const visitor of recipients) {
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
    if (visitor.isBlocked) {
      appendTranscriptLine(`[ERROR] This visitor is blocked. Unblock them before replying.`, 'error-line');
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

function visitorAccessRow(visitor, action, label) {
  return `
    <li class="visitor-access-row">
      <div class="visitor-access-details">
        <strong><span class="term-public-id">[${escapeHtml(visitor.publicId || 'ID')}]</span> ${escapeHtml(visitor.displayName || 'Unknown visitor')}</strong>
        <small>UID: ${escapeHtml(visitor.id)}</small>
      </div>
      <button class="term-btn${action === 'block' ? ' danger' : ''}" data-visitor-action="${action}" data-visitor-id="${escapeHtml(visitor.id)}">${label}</button>
    </li>
  `;
}

function renderVisitorAccessLists() {
  const availableVisitors = allVisitors.filter(visitor => !visitor.isBlocked);
  const blockedVisitors = allVisitors.filter(visitor => visitor.isBlocked);

  availableVisitorList.innerHTML = availableVisitors.length
    ? availableVisitors.map(visitor => visitorAccessRow(visitor, 'block', 'BLOCK')).join('')
    : '<li class="term-line system-line">[NO AVAILABLE VISITORS]</li>';
  blockedVisitorList.innerHTML = blockedVisitors.length
    ? blockedVisitors.map(visitor => visitorAccessRow(visitor, 'unblock', 'UNBLOCK')).join('')
    : '<li class="term-line system-line">[NO BLOCKED USERS]</li>';
}

function openVisitorAccess() {
  renderVisitorAccessLists();
  visitorAccessMessage.style.display = 'none';
  visitorAccessModal.style.display = 'flex';
}

async function handleVisitorAccessAction(event) {
  const button = event.target.closest('[data-visitor-action]');
  if (!button) return;

  const visitor = allVisitors.find(item => item.id === button.dataset.visitorId);
  if (!visitor) return;

  const shouldBlock = button.dataset.visitorAction === 'block';
  button.disabled = true;
  try {
    await setVisitorBlocked(visitor.id, shouldBlock);
    allVisitors = allVisitors.map(item => item.id === visitor.id ? { ...item, isBlocked: shouldBlock } : item);
    if (activeGroup) {
      activeGroup = {
        ...activeGroup,
        visitors: activeGroup.visitors.map(item => item.id === visitor.id ? { ...item, isBlocked: shouldBlock } : item)
      };
      const selectedRecipient = recipientSelect.value;
      recipientSelect.innerHTML = '<option value="ALL">ALL USERS (BROADCAST TO GROUP)</option>';
      for (const item of activeGroup.visitors) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = `[${item.publicId}] ${item.displayName}${item.isBlocked ? ' [BLOCKED]' : ''}`;
        option.disabled = Boolean(item.isBlocked);
        recipientSelect.appendChild(option);
      }
      if (activeGroup.visitors.some(item => item.id === selectedRecipient && !item.isBlocked)) {
        recipientSelect.value = selectedRecipient;
      }
      updateOwnerPromptPrefix();
    }
    renderInbox();
    visitorAccessMessage.textContent = `${visitor.publicId || visitor.id} ${shouldBlock ? 'blocked' : 'unblocked'}.`;
    visitorAccessMessage.className = 'term-line success-line';
  } catch (error) {
    visitorAccessMessage.textContent = error instanceof Error ? error.message : String(error);
    visitorAccessMessage.className = 'term-line error-line';
  }
  visitorAccessMessage.style.display = 'block';
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

  visitorAccessBtn.addEventListener('click', openVisitorAccess);
  blockUserBtn.addEventListener('click', openVisitorAccess);
  closeVisitorAccessBtn.addEventListener('click', () => {
    visitorAccessModal.style.display = 'none';
  });
  visitorAccessModal.addEventListener('click', event => {
    if (event.target === visitorAccessModal) visitorAccessModal.style.display = 'none';
  });
  availableVisitorList.addEventListener('click', handleVisitorAccessAction);
  blockedVisitorList.addEventListener('click', handleVisitorAccessAction);

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
        blockUserBtn.disabled = false;
      } else {
        activeGroup = null;
        blockUserBtn.disabled = true;
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
