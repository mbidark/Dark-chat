/**
 * DARKCHAT — Visitor Terminal Application
 * MBI DARK | Zero-to-Production
 * Unique Visitor ID Generation per Session & Private Chat Isolation
 */

import {
  cleanDisplayName,
  validateName,
  generatePublicId,
  validateMessage,
  formatTimestamp,
  normalizeName,
  isOwnerName
} from './utils.js';

import {
  authenticateVisitor,
  upsertVisitorProfile,
  sendMessage,
  subscribeToMessages,
  subscribeToTypingStatus,
  setTypingStatus,
  verifyOwnerPassword
} from './firebase.js';

// DOM Elements
const termOutput = document.getElementById('terminalOutput');
const terminalLines = document.getElementById('terminalLines');
const termInput = document.getElementById('termInput');
const termVisualText = document.getElementById('termVisualText');
const termCursor = document.getElementById('termCursor');
const promptPrefix = document.getElementById('promptPrefix');
const inputWrapper = document.getElementById('inputWrapper');
const typingIndicator = document.getElementById('typingIndicator');
const connStatus = document.getElementById('connStatus');
const visitorTag = document.getElementById('visitorTag');

// State machine
const STATE_INIT = 'INIT';
const STATE_LOADING = 'LOADING';
const STATE_NAME_PROMPT = 'NAME_PROMPT';
const STATE_PASSWORD = 'PASSWORD';
const STATE_CHAT = 'CHAT';

let currentState = STATE_INIT;
let currentVisitor = null;
let messageUnsubscribe = null;
let typingUnsubscribe = null;
let typingTimeout = null;
let isSending = false;
const renderedMessageIds = new Set();

// Command history buffer
const commandHistory = [];
let historyIndex = -1;

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function appendLine(content, type = '') {
  const line = document.createElement('div');
  line.className = `term-line ${type} fade-in`;
  line.innerHTML = content;
  terminalLines.appendChild(line);
  scrollToBottom();
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    if (termOutput) {
      termOutput.scrollTop = termOutput.scrollHeight;
    }
  });
}

async function typeLine(text, type = '', speed = 8) {
  if (prefersReducedMotion) {
    appendLine(text, type);
    return;
  }
  const line = document.createElement('div');
  line.className = `term-line ${type} fade-in`;
  terminalLines.appendChild(line);
  scrollToBottom();

  for (let i = 0; i <= text.length; i++) {
    line.innerHTML = escapeHtml(text.slice(0, i)) + (i < text.length ? '█' : '');
    scrollToBottom();
    await new Promise(r => setTimeout(r, speed));
  }
  line.innerHTML = escapeHtml(text);
  scrollToBottom();
}

function syncInputDisplay() {
  const rawText = termInput.value || '';
  const start = termInput.selectionStart ?? rawText.length;

  const isPassword = (currentState === STATE_PASSWORD);
  const text = isPassword ? '●'.repeat(rawText.length) : rawText;

  if (start < text.length) {
    const before = text.slice(0, start);
    const char = text.slice(start, start + 1);
    const after = text.slice(start + 1);

    termVisualText.textContent = before;
    termCursor.className = 'term-cursor cursor-char';
    termCursor.textContent = char;

    let afterNode = termCursor.nextSibling;
    if (!afterNode || afterNode.nodeType !== Node.TEXT_NODE) {
      afterNode = document.createTextNode('');
      inputWrapper.appendChild(afterNode);
    }
    afterNode.textContent = after;
  } else {
    termVisualText.textContent = text;
    termCursor.className = 'term-cursor';
    termCursor.textContent = '█';

    if (termCursor.nextSibling) {
      termCursor.nextSibling.textContent = '';
    }
  }

  termInput.style.height = 'auto';
  termInput.style.height = Math.max(24, termInput.scrollHeight) + 'px';
  scrollToBottom();
}

function focusTerminal() {
  if (currentState !== STATE_LOADING && termInput) {
    termInput.focus();
  }
}

function setupInputListeners() {
  ['input', 'keyup', 'keydown', 'click', 'focus', 'select'].forEach(ev => {
    termInput.addEventListener(ev, () => {
      if (currentState === STATE_LOADING) return;
      syncInputDisplay();
    });
  });

  document.addEventListener('click', (e) => {
    if (window.getSelection() && window.getSelection().toString().length > 0) return;
    focusTerminal();
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scrollToBottom);
    window.visualViewport.addEventListener('scroll', scrollToBottom);
  }

  termInput.addEventListener('keydown', (e) => {
    if (currentState === STATE_LOADING) {
      e.preventDefault();
      return;
    }

    if (e.key === 'ArrowUp') {
      if (commandHistory.length > 0) {
        e.preventDefault();
        if (historyIndex === -1) {
          historyIndex = commandHistory.length - 1;
        } else if (historyIndex > 0) {
          historyIndex--;
        }
        termInput.value = commandHistory[historyIndex];
        syncInputDisplay();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      if (historyIndex !== -1) {
        e.preventDefault();
        if (historyIndex < commandHistory.length - 1) {
          historyIndex++;
          termInput.value = commandHistory[historyIndex];
        } else {
          historyIndex = -1;
          termInput.value = '';
        }
        syncInputDisplay();
      }
      return;
    }

    if (e.key === 'Enter') {
      if (e.shiftKey && currentState === STATE_CHAT) {
        return;
      }
      e.preventDefault();
      handleInputSubmission();
    }
  });

  termInput.addEventListener('input', () => {
    if (currentState === STATE_CHAT && currentVisitor) {
      setTypingStatus(currentVisitor.id, 'visitor', true);
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        setTypingStatus(currentVisitor.id, 'visitor', false);
      }, 2500);
    }
  });
}

async function handleInputSubmission() {
  const value = termInput.value;
  if (value && value.trim() && currentState !== STATE_PASSWORD) {
    commandHistory.push(value);
    historyIndex = -1;
  }
  termInput.value = '';
  syncInputDisplay();

  if (currentState === STATE_NAME_PROMPT) {
    await handleNameInput(value);
  } else if (currentState === STATE_PASSWORD) {
    await handlePasswordInput(value);
  } else if (currentState === STATE_CHAT) {
    await handleChatMessage(value);
  }
}

async function handleNameInput(rawName) {
  const trimmed = (rawName || '').trim();
  if (!trimmed) return;

  appendLine(`~ $ ${escapeHtml(trimmed)}`);

  // Check Owner login
  if (isOwnerName(trimmed)) {
    await typeLine(`Password:`, 'system-line', 8);
    currentState = STATE_PASSWORD;
    promptPrefix.textContent = `> `;
    syncInputDisplay();
    focusTerminal();
    return;
  }

  // Validate name
  const validation = validateName(trimmed);
  if (!validation.valid) {
    appendLine(`[ERROR] ${validation.error}`, 'error-line');
    await typeLine(`what's your name?`, 'system-line', 8);
    promptPrefix.textContent = `~ $ `;
    focusTerminal();
    return;
  }

  const cleaned = cleanDisplayName(trimmed);
  await initializeVisitorSession(cleaned);
}

async function handlePasswordInput(rawPassword) {
  if (!rawPassword) return;

  appendLine(`> ●●●●●●●●`);

  try {
    const result = await verifyOwnerPassword(rawPassword);
    if (result && result.success) {
      await typeLine(`Access granted.`, 'success-line', 8);
      setTimeout(() => {
        window.location.href = './owner.html';
      }, 500);
      return;
    }
  } catch (err) {}

  appendLine(`Access denied.`, 'error-line');
  await typeLine(`what's your name?`, 'system-line', 8);
  currentState = STATE_NAME_PROMPT;
  promptPrefix.textContent = `~ $ `;
  syncInputDisplay();
  focusTerminal();
}

async function initializeVisitorSession(displayName) {
  try {
    // Generate a guaranteed unique visitor ID for this new session
    const visitorId = 'vis_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);

    // Register connecting IP with backend
    try {
      await fetch('/api/ip/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId })
      });
    } catch (e) {}

    const publicId = generatePublicId();
    localStorage.setItem(`darkchat_public_${visitorId}`, publicId);

    currentVisitor = {
      id: visitorId,
      publicId,
      displayName,
      normalizedName: normalizeName(displayName),
      unreadCount: 0
    };

    await upsertVisitorProfile(currentVisitor);

    await typeLine(`Success.`, 'success-line', 8);

    setTimeout(async () => {
      terminalLines.innerHTML = '';
      await typeLine(`Now you can chat with Dark...`, 'system-line', 10);

      if (connStatus) {
        connStatus.textContent = '[CONNECTED]';
        connStatus.style.display = 'inline';
      }
      if (visitorTag) {
        visitorTag.textContent = `ID: ${publicId}`;
        visitorTag.style.display = 'inline';
      }

      currentState = STATE_CHAT;
      promptPrefix.textContent = `~ $ `;
      syncInputDisplay();

      startChatSubscriptions(visitorId);
      focusTerminal();
    }, 400);

  } catch (err) {
    appendLine(`[ERROR] Initialization failed: ${err.message}`, 'error-line');
  }
}

function startChatSubscriptions(visitorId) {
  if (messageUnsubscribe) messageUnsubscribe();
  if (typingUnsubscribe) typingUnsubscribe();

  messageUnsubscribe = subscribeToMessages(visitorId, (messages) => {
    for (const msg of messages) {
      if (renderedMessageIds.has(msg.id)) continue;
      renderedMessageIds.add(msg.id);

      const timeStr = `<span class="term-time">${formatTimestamp(msg.createdAt)}</span>`;
      let lineHtml = '';

      if (msg.sender === 'owner') {
        lineHtml = `${timeStr} <span class="term-sender-owner">[Dark]</span>: ${escapeHtml(msg.text)}`;
      } else {
        const idBadge = `<span class="term-public-id">[${msg.publicId || currentVisitor?.publicId || 'VISITOR'}]</span>`;
        lineHtml = `${timeStr} ${idBadge} ${escapeHtml(msg.text)}`;
      }

      appendLine(lineHtml);
    }
  });

  typingUnsubscribe = subscribeToTypingStatus(visitorId, (status) => {
    if (status && status.sender === 'owner' && status.isTyping) {
      typingIndicator.style.display = 'block';
      typingIndicator.innerHTML = `Dark is typing ▰ ▰ ▰`;
    } else {
      typingIndicator.style.display = 'none';
      typingIndicator.innerHTML = '';
    }
    scrollToBottom();
  });
}

async function handleChatMessage(rawText) {
  if (isSending) return;
  const validation = validateMessage(rawText);
  if (!validation.valid) {
    appendLine(`[ERROR] ${validation.error}`, 'error-line');
    return;
  }

  isSending = true;
  try {
    await sendMessage({
      visitorId: currentVisitor.id,
      publicId: currentVisitor.publicId,
      displayName: currentVisitor.displayName,
      sender: 'visitor',
      text: validation.sanitized,
      recipient: 'owner'
    });
  } catch (err) {
    appendLine(`[ERROR] Message delivery failed: ${err.message}`, 'error-line');
  } finally {
    isSending = false;
    focusTerminal();
  }
}

async function startFastLoading() {
  currentState = STATE_LOADING;
  terminalLines.innerHTML = '';

  // Check IP block status via backend API
  try {
    const ipRes = await fetch('/api/ip/status');
    if (ipRes.ok) {
      const ipData = await ipRes.json();
      if (ipData && ipData.blocked) {
        await typeLine(`[ACCESS DENIED] IP ${ipData.ip} blocked by Dark.`, 'error-line', 15);
        return;
      }
    }
  } catch (e) {}

  if (prefersReducedMotion) {
    terminalLines.innerHTML = `
      <div class="term-line system-line">Initializing...</div>
      <div class="term-line system-line">what's your name?</div>
    `;
    currentState = STATE_NAME_PROMPT;
    promptPrefix.textContent = `~ $ `;
    syncInputDisplay();
    focusTerminal();
    return;
  }

  await typeLine(`Initializing... █`, 'system-line', 8);
  await new Promise(r => setTimeout(r, 80));

  await typeLine(`> Loading terminal modules...`, 'system-line', 6);
  await new Promise(r => setTimeout(r, 80));

  await typeLine(`> Checking network...`, 'system-line', 6);
  await new Promise(r => setTimeout(r, 80));

  await typeLine(`> Preparing environment...`, 'system-line', 6);
  await new Promise(r => setTimeout(r, 80));

  await typeLine(`> Connecting to Firebase...`, 'system-line', 6);
  await new Promise(r => setTimeout(r, 80));

  await typeLine(`> Restoring session...`, 'system-line', 6);
  await new Promise(r => setTimeout(r, 80));

  const progressLine = document.createElement('div');
  progressLine.className = 'term-line system-line fade-in';
  terminalLines.appendChild(progressLine);
  scrollToBottom();

  const blocks = 20;
  for (let p = 25; p <= 100; p += 25) {
    const filledCount = Math.floor((p / 100) * blocks);
    const emptyCount = blocks - filledCount;
    const bar = '█'.repeat(filledCount) + '░'.repeat(emptyCount);
    progressLine.textContent = `[${bar}] ${p}%`;
    scrollToBottom();
    await new Promise(r => setTimeout(r, 30));
  }
  progressLine.textContent = `[████████████████████] 100%`;
  scrollToBottom();
  await new Promise(r => setTimeout(r, 100));

  await typeLine(`ACCESS GRANTED █`, 'success-line', 10);
  await new Promise(r => setTimeout(r, 200));

  terminalLines.innerHTML = '';
  await typeLine(`what's your name?`, 'system-line', 10);

  currentState = STATE_NAME_PROMPT;
  promptPrefix.textContent = `~ $ `;
  syncInputDisplay();
  focusTerminal();
}

async function startTerminal() {
  setupInputListeners();
  syncInputDisplay();
  focusTerminal();

  await startFastLoading();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startTerminal);
} else {
  startTerminal();
}
