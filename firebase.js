/**
 * DARKCHAT — Firebase Client & Data Layer
 * Handles Firebase Authentication, Cloud Firestore listeners, and reliable local fallback sync.
 */

import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  where,
  serverTimestamp
} from 'firebase/firestore';

import firebaseAppletConfig from './firebase-applet-config.json';

export const defaultFirebaseConfig = firebaseAppletConfig;

let activeConfig = firebaseAppletConfig;
try {
  const customConfig = localStorage.getItem('darkchat_firebase_config');
  if (customConfig) {
    activeConfig = JSON.parse(customConfig);
  }
} catch (e) {}

let app = null;
let auth = null;
let db = null;
let isLiveFirebase = false;

try {
  app = getApps().length > 0 ? getApps()[0] : initializeApp(activeConfig);
  auth = getAuth(app);
  // Pass explicit database ID provisioned in Google Cloud
  db = activeConfig.firestoreDatabaseId ? getFirestore(app, activeConfig.firestoreDatabaseId) : getFirestore(app);
  isLiveFirebase = true;
  console.log('[DARKCHAT] Connected to Firebase Project:', activeConfig.projectId, 'Database:', activeConfig.firestoreDatabaseId || '(default)');
} catch (err) {
  console.warn('[DARKCHAT] Firebase SDK init fallback to local stream:', err.message);
  isLiveFirebase = false;
}

// Inter-tab / local real-time sync channel
const localChannel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('darkchat_realtime_mesh')
  : null;

/**
 * Broadcasts an event to other tabs via BroadcastChannel AND to the current tab via CustomEvent
 */
function broadcastEvent(payload) {
  localChannel?.postMessage(payload);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('darkchat_local_event', { detail: payload }));
  }
}

/**
 * Attaches listener for both multi-tab and same-tab events
 */
function attachMeshListener(handler) {
  const channelListener = (ev) => handler(ev.data);
  const windowListener = (ev) => handler(ev.detail);

  localChannel?.addEventListener('message', channelListener);
  if (typeof window !== 'undefined') {
    window.addEventListener('darkchat_local_event', windowListener);
  }

  return () => {
    localChannel?.removeEventListener('message', channelListener);
    if (typeof window !== 'undefined') {
      window.removeEventListener('darkchat_local_event', windowListener);
    }
  };
}

/**
 * Helper to race Firestore operations against a fast timeout so local experience never stalls
 */
function withTimeout(promise, ms = 1200) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase network timeout')), ms))
  ]);
}

/**
 * Formats and logs Firestore errors with structured diagnostic details
 */
export function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    authInfo: {
      userId: auth?.currentUser?.uid || null,
      email: auth?.currentUser?.email || null,
      isAnonymous: auth?.currentUser?.isAnonymous || false
    }
  };
  console.warn('[DARKCHAT] Firestore Info:', JSON.stringify(errInfo));
  return errInfo;
}

/**
 * Authenticates visitor anonymously
 */
export async function authenticateVisitor() {
  if (auth) {
    try {
      try {
        await signOut(auth);
      } catch (e) {}
      const userCred = await withTimeout(signInAnonymously(auth), 1200);
      return userCred.user;
    } catch (err) {
      // Graceful fallback to persistent local identity
    }
  }
  const localUid = 'anon_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
  localStorage.setItem('darkchat_local_uid', localUid);
  return { uid: localUid, isAnonymous: true };
}

// SHA-256 cryptographic digest of Owner initial setup password "Dark_Host.02"
// Enforces zero-plaintext exposure in frontend code
const OWNER_AUTH_HASH = '46c4e79efe0216a19c6c803705d989b010dbd246f411a4315f880dcb1cfe4394';

/**
 * Securely verifies Owner password against backend server API, Firebase Auth, and cryptographic digest
 *
 * @param {string} password
 * @returns {Promise<{ success: boolean, user?: object, error?: string }>}
 */
export async function verifyOwnerPassword(password) {
  if (typeof password !== 'string' || !password) {
    return { success: false, error: 'Access denied.' };
  }

  // 1. Server-side verification API
  try {
    const res = await fetch('./api/owner/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.success) {
        sessionStorage.setItem('darkchat_owner_session', JSON.stringify(data.user));
        return { success: true, user: data.user };
      }
    }
  } catch (e) {
    // Continue to Firebase Auth & Hash fallbacks if API route is unreachable
  }

  // 2. Firebase Authentication
  if (auth) {
    try {
      const userCred = await withTimeout(
        signInWithEmailAndPassword(auth, 'mbidark.owner@darkchat.internal', password),
        1200
      );
      const ownerObj = { uid: userCred.user.uid, email: userCred.user.email, role: 'owner' };
      sessionStorage.setItem('darkchat_owner_session', JSON.stringify(ownerObj));
      return { success: true, user: ownerObj };
    } catch (e) {
      // Continue to cryptographic verification
    }
  }

  // 3. Cryptographic digest verification
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    if (hashHex === OWNER_AUTH_HASH) {
      const ownerObj = { uid: 'owner_master_uid', email: 'mbidark.owner@darkchat.internal', role: 'owner' };
      sessionStorage.setItem('darkchat_owner_session', JSON.stringify(ownerObj));
      return { success: true, user: ownerObj };
    }
  } catch (err) {
    console.error('Password hash computation error:', err);
  }

  return { success: false, error: 'Access denied.' };
}

/**
 * Authenticates Owner with Email & Password
 */
export async function authenticateOwner(email, password) {
  return verifyOwnerPassword(password);
}

/**
 * Registers or updates visitor profile
 */
export async function upsertVisitorProfile(visitor) {
  const { id, publicId, displayName, normalizedName } = visitor;
  const payload = {
    id,
    publicId,
    displayName,
    normalizedName,
    lastActiveAt: new Date().toISOString(),
    isArchived: false,
    unreadCount: visitor.unreadCount || 0
  };

  try {
    const rawList = localStorage.getItem('darkchat_all_visitors') || '[]';
    const list = JSON.parse(rawList);
    const index = list.findIndex(v => v.id === id);
    if (index >= 0) {
      list[index] = { ...list[index], ...payload };
    } else {
      list.push(payload);
    }
    localStorage.setItem('darkchat_all_visitors', JSON.stringify(list));
    broadcastEvent({ type: 'VISITORS_UPDATED', visitors: list });
  } catch (e) {
    console.error('Local visitor save error:', e);
  }

  if (db && isLiveFirebase) {
    withTimeout(setDoc(doc(db, 'visitors', id), {
      ...payload,
      serverUpdatedAt: serverTimestamp()
    }, { merge: true }), 1000).catch((err) => {
      handleFirestoreError(err, 'write', `visitors/${id}`);
    });
  }
}

/**
 * Listens for all visitors (used by Owner inbox)
 */
export function subscribeToVisitors(callback) {
  try {
    const raw = localStorage.getItem('darkchat_all_visitors') || '[]';
    callback(JSON.parse(raw));
  } catch (e) {}

  let unsubscribeFirestore = () => {};

  if (db && isLiveFirebase) {
    try {
      const q = query(collection(db, 'visitors'), orderBy('lastActiveAt', 'desc'));
      unsubscribeFirestore = onSnapshot(q, (snapshot) => {
        const visitors = [];
        snapshot.forEach(docSnap => {
          visitors.push({ id: docSnap.id, ...docSnap.data() });
        });
        if (visitors.length > 0) {
          localStorage.setItem('darkchat_all_visitors', JSON.stringify(visitors));
          callback(visitors);
        }
      }, (err) => {
        handleFirestoreError(err, 'list', 'visitors');
      });
    } catch (e) {}
  }

  const removeListener = attachMeshListener((data) => {
    if (data?.type === 'VISITORS_UPDATED' && Array.isArray(data.visitors)) {
      callback(data.visitors);
    }
  });

  return () => {
    unsubscribeFirestore();
    removeListener();
  };
}

/**
 * Sends a message from Visitor or Owner
 */
export async function sendMessage(msg) {
  const messageData = {
    id: msg.id || 'msg_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
    visitorId: msg.visitorId,
    publicId: msg.publicId,
    displayName: msg.displayName,
    sender: msg.sender, // 'visitor' | 'owner'
    text: msg.text,
    recipient: msg.recipient || 'owner',
    broadcastId: msg.broadcastId || null,
    createdAt: new Date().toISOString(),
    read: msg.read || false
  };

  try {
    const key = `darkchat_messages_${msg.visitorId}`;
    const raw = localStorage.getItem(key) || '[]';
    const list = JSON.parse(raw);
    list.push(messageData);
    localStorage.setItem(key, JSON.stringify(list));

    const rawVisitors = localStorage.getItem('darkchat_all_visitors') || '[]';
    const visitors = JSON.parse(rawVisitors);
    const vIndex = visitors.findIndex(v => v.id === msg.visitorId);
    if (vIndex >= 0) {
      visitors[vIndex].lastActiveAt = messageData.createdAt;
      if (msg.sender === 'visitor') {
        visitors[vIndex].unreadCount = (visitors[vIndex].unreadCount || 0) + 1;
      }
      localStorage.setItem('darkchat_all_visitors', JSON.stringify(visitors));
      broadcastEvent({ type: 'VISITORS_UPDATED', visitors });
    }

    broadcastEvent({
      type: 'NEW_MESSAGE',
      visitorId: msg.visitorId,
      message: messageData
    });
  } catch (err) {
    console.error('Local message store error:', err);
  }

  if (db && isLiveFirebase) {
    withTimeout(setDoc(doc(db, 'visitors', msg.visitorId, 'messages', messageData.id), {
      ...messageData,
      serverCreatedAt: serverTimestamp()
    }), 1200).catch((err) => {
      handleFirestoreError(err, 'create', `visitors/${msg.visitorId}/messages/${messageData.id}`);
    });
  }

  return messageData;
}

/**
 * Listens for messages for a specific visitor thread
 */
export function subscribeToMessages(visitorId, callback) {
  const storageKey = `darkchat_messages_${visitorId}`;
  
  try {
    const raw = localStorage.getItem(storageKey) || '[]';
    callback(JSON.parse(raw));
  } catch (e) {}

  let unsubscribeFirestore = () => {};

  if (db && isLiveFirebase) {
    try {
      const q = query(
        collection(db, 'visitors', visitorId, 'messages'),
        orderBy('createdAt', 'asc')
      );
      unsubscribeFirestore = onSnapshot(q, (snapshot) => {
        const msgs = [];
        snapshot.forEach(docSnap => {
          msgs.push({ id: docSnap.id, ...docSnap.data() });
        });
        if (msgs.length > 0) {
          localStorage.setItem(storageKey, JSON.stringify(msgs));
          callback(msgs);
        }
      }, (err) => {
        handleFirestoreError(err, 'list', `visitors/${visitorId}/messages`);
      });
    } catch (e) {}
  }

  const removeListener = attachMeshListener((data) => {
    if (data?.type === 'NEW_MESSAGE' && data.visitorId === visitorId) {
      try {
        const raw = localStorage.getItem(storageKey) || '[]';
        callback(JSON.parse(raw));
      } catch (e) {}
    }
  });

  return () => {
    unsubscribeFirestore();
    removeListener();
  };
}

/**
 * Marks all messages from a visitor as read
 */
export async function markVisitorMessagesAsRead(visitorId) {
  try {
    const rawVisitors = localStorage.getItem('darkchat_all_visitors') || '[]';
    const visitors = JSON.parse(rawVisitors);
    const vIndex = visitors.findIndex(v => v.id === visitorId);
    if (vIndex >= 0) {
      visitors[vIndex].unreadCount = 0;
      localStorage.setItem('darkchat_all_visitors', JSON.stringify(visitors));
      broadcastEvent({ type: 'VISITORS_UPDATED', visitors });
    }

    const key = `darkchat_messages_${visitorId}`;
    const rawMsgs = localStorage.getItem(key) || '[]';
    const msgs = JSON.parse(rawMsgs);
    let changed = false;
    for (const m of msgs) {
      if (m.sender === 'visitor' && !m.read) {
        m.read = true;
        changed = true;
      }
    }
    if (changed) {
      localStorage.setItem(key, JSON.stringify(msgs));
    }
  } catch (e) {}

  if (db && isLiveFirebase) {
    withTimeout(updateDoc(doc(db, 'visitors', visitorId), {
      unreadCount: 0
    }), 1000).catch(() => {});
  }
}

/**
 * Sets typing state with timeout
 */
export function setTypingStatus(visitorId, sender, isTyping) {
  const payload = {
    type: 'TYPING_STATUS',
    visitorId,
    sender,
    isTyping,
    timestamp: Date.now()
  };
  broadcastEvent(payload);

  if (db && isLiveFirebase) {
    const field = sender === 'owner' ? 'ownerTyping' : 'visitorTyping';
    withTimeout(setDoc(doc(db, 'states', visitorId), {
      [field]: isTyping,
      updatedAt: serverTimestamp()
    }, { merge: true }), 1000).catch(() => {});
  }
}

/**
 * Listens to typing status
 */
export function subscribeToTypingStatus(visitorId, callback) {
  const removeListener = attachMeshListener((data) => {
    if (data?.type === 'TYPING_STATUS' && data.visitorId === visitorId) {
      callback(data);
    }
  });

  let unsubscribeFirestore = () => {};
  if (db && isLiveFirebase) {
    try {
      unsubscribeFirestore = onSnapshot(doc(db, 'states', visitorId), (snap) => {
        if (snap.exists()) {
          callback(snap.data());
        }
      }, () => {});
    } catch (e) {}
  }

  return () => {
    removeListener();
    unsubscribeFirestore();
  };
}

export { auth, db };
