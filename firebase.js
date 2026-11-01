/**
 * DARKCHAT — Firebase Client & Data Layer
 * Strict Auth UID Identity, Real-Time Firestore Synchronization & Error Handling
 */

import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocFromServer,
  updateDoc,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  where,
  serverTimestamp
} from 'firebase/firestore';
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';

import firebaseConfig from './firebase-applet-config.json';

let app = null;
try {
  app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
} catch (e) {
  console.error('Firebase initialization error:', e);
}

export const db = app ? getFirestore(app, firebaseConfig.firestoreDatabaseId) : null;
export const auth = app ? getAuth(app) : null;

export async function logoutUser() {
  if (auth?.currentUser) {
    await signOut(auth);
  }
}

export async function forceLogoutAllUsers() {
  if (!db || !auth?.currentUser) throw new Error('Owner authentication required.');
  await setDoc(doc(db, 'settings', 'globalSession'), {
    revision: Date.now().toString(),
    forcedAt: serverTimestamp(),
    forcedBy: auth.currentUser.uid
  }, { merge: true });
}

export function subscribeToGlobalSessionRevision(callback, onError = () => {}) {
  if (!db) return () => {};
  const key = 'darkchat_global_session_revision';
  const baseline = localStorage.getItem(key);
  return onSnapshot(doc(db, 'settings', 'globalSession'), snapshot => {
    const revision = snapshot.exists() ? String(snapshot.data().revision || '') : '';
    if (!baseline && revision) {
      localStorage.setItem(key, revision);
      callback(false);
      return;
    }
    if (baseline && revision && revision !== baseline) {
      callback(true);
    }
  }, onError);
}

export async function registerPushNotifications(role = 'visitor') {
  if (!app || !db || !auth?.currentUser || !('Notification' in window)) {
    return { success: false, error: 'Push notifications are unavailable in this browser.' };
  }
  if (!firebaseConfig.vapidKey) {
    return { success: false, error: 'Firebase VAPID key is not configured yet.' };
  }
  try {
    if (!(await isSupported())) {
      return { success: false, error: 'This browser does not support Firebase Web Push.' };
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { success: false, error: 'Notification permission was not granted.' };
    }
    if ('serviceWorker' in navigator) {
      await navigator.serviceWorker.register('./firebase-messaging-sw.js');
      const registration = await navigator.serviceWorker.ready;
      const messaging = getMessaging(app);
      const token = await getToken(messaging, {
        vapidKey: firebaseConfig.vapidKey,
        serviceWorkerRegistration: registration
      });
      await setDoc(doc(db, 'notificationTokens', token), {
        uid: auth.currentUser.uid,
        role,
        token,
        lastSeenAt: serverTimestamp(),
        userAgent: navigator.userAgent.slice(0, 240)
      });
      onMessage(messaging, payload => {
        const title = payload.notification?.title || 'DARKCHAT';
        const body = payload.notification?.body || '';
        if (Notification.permission === 'granted') {
          new Notification(title, { body, icon: './favicon.ico' });
        }
      });
      return { success: true, token };
    }
    return { success: false, error: 'Service workers are unavailable.' };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { success: false, error: detail };
  }
}

function accountEmail(code) {
  return `d.${code}@darkchat.local`;
}

export function validateAccessPassword(password) {
  return /^D\..{2,32}$/i.test(password || '');
}

async function hashLoginKey(loginKey) {
  const bytes = new TextEncoder().encode(loginKey);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyVisitorPassword(password) {
  if (!auth || !db || !validateAccessPassword(password)) {
    return { success: false, error: 'INVALID_REAL_ACCOUNT_FORMAT' };
  }

  try {
    const trimmedLogin = password.trim();
    const normalizedLogin = /^d\./i.test(trimmedLogin)
      ? `D.${trimmedLogin.slice(2)}`
      : trimmedLogin;
    if (!auth.currentUser || auth.currentUser.isAnonymous) {
      await authenticateVisitor().catch(() => null);
    }
    const loginHash = await hashLoginKey(normalizedLogin);
    const loginSnapshot = await getDoc(doc(db, 'userLogins', loginHash));
    if (!loginSnapshot.exists()) {
      await signOut(auth).catch(() => {});
      return { success: false, error: 'Invalid access password.' };
    }
    const login = loginSnapshot.data();
    const userCred = await signInWithEmailAndPassword(auth, login.email, login.authPassword);
    const accountSnapshot = await getDoc(doc(db, 'users', userCred.user.uid));
    if (!accountSnapshot.exists()) {
      await signOut(auth);
      return { success: false, error: 'This account has no visitor profile.' };
    }

    const account = accountSnapshot.data();
    if (account.isDisabled || account.isBlocked) {
      await signOut(auth);
      return { success: false, error: 'This account is blocked.' };
    }

    const publicId = account.publicId || generateAccountPublicId(userCred.user.uid);
    const visitor = {
      id: userCred.user.uid,
      publicId,
      displayName: account.displayName,
      normalizedName: account.normalizedName,
      unreadCount: 0
    };
    await upsertVisitorProfile(visitor);
    return { success: true, user: userCred.user, visitor };
  } catch (error) {
    const codeValue = error && typeof error === 'object' && 'code' in error ? error.code : '';
    const detail = error instanceof Error ? error.message : String(error || '');
    const friendlyError = codeValue === 'permission-denied'
      ? 'Account lookup denied. Firestore rules are not deployed.'
      : codeValue === 'auth/invalid-credential'
        ? 'Invalid account credentials.'
        : codeValue === 'auth/user-disabled'
          ? 'This account is disabled.'
          : codeValue || detail;
    return {
      success: false,
      error: friendlyError === detail && detail
        ? `Account sign-in failed: ${detail}`
        : friendlyError
    };
  }
}

export async function restoreVisitorSession() {
  if (!auth?.currentUser || auth.currentUser.isAnonymous || !db) return null;
  const snapshot = await getDoc(doc(db, 'users', auth.currentUser.uid));
  if (!snapshot.exists()) return null;
  const account = snapshot.data();
  if (account.isDisabled || account.isBlocked) return null;
  const visitor = {
    id: auth.currentUser.uid,
    publicId: account.publicId,
    displayName: account.displayName,
    normalizedName: account.normalizedName,
    unreadCount: 0
  };
  await upsertVisitorProfile(visitor);
  return visitor;
}

function generateAccountPublicId(uid) {
  return uid.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase().padStart(6, '0');
}

export async function createRealVisitorAccount(displayName, code, password) {
  if (!auth || !db) throw new Error('Firebase is unavailable.');
  const cleanName = String(displayName || '').trim().replace(/\s+/g, ' ');
  if (cleanName.length < 2 || cleanName.length > 32) {
    throw new Error('Name must contain 2 to 32 characters.');
  }
  const cleanCode = String(code || '').trim();
  const cleanPassword = String(password || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,16}$/.test(cleanCode)) {
    throw new Error('Code must contain 1 to 16 letters, numbers, underscores, or hyphens.');
  }
  if (!/^[a-zA-Z0-9_-]{1,16}$/.test(cleanPassword)) {
    throw new Error('Password must contain 1 to 16 letters, numbers, underscores, or hyphens.');
  }

  const loginKey = `D.${cleanCode}${cleanPassword}`;
  const loginHash = await hashLoginKey(loginKey);
  const existingLogin = await getDoc(doc(db, 'userLogins', loginHash));
  if (existingLogin.exists()) {
    throw new Error('That code and password combination is already in use.');
  }
  const email = `d.${loginHash.slice(0, 32)}@darkchat.local`;
  const authPassword = `DARKCHAT_${loginHash}`;
  let secondaryApp;
  try {
    secondaryApp = initializeApp(firebaseConfig, `visitor-account-${Date.now()}`);
    const secondaryAuth = getAuth(secondaryApp);
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, authPassword);
    const uid = credential.user.uid;
    const publicId = generateAccountPublicId(uid);
    const normalizedName = cleanName.toLowerCase();

    await setDoc(doc(db, 'users', uid), {
      code: cleanCode,
      password: cleanPassword,
      email,
      displayName: cleanName,
      normalizedName,
      accountType: 'real',
      publicId,
      isDisabled: false,
      isBlocked: false,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid || null
    });
    await setDoc(doc(db, 'visitors', uid), {
      id: uid,
      publicId,
      displayName: cleanName,
      normalizedName,
      lastActiveAt: new Date().toISOString(),
      serverUpdatedAt: serverTimestamp(),
      isArchived: false,
      isBlocked: false,
      accountType: 'real',
      unreadCount: 0
    });
    await setDoc(doc(db, 'userLogins', loginHash), {
      uid,
      email,
      authPassword,
      code: cleanCode,
      displayName: cleanName,
      isBlocked: false
    });
    await signOut(secondaryAuth);
    return { uid, publicId, displayName: cleanName, code: cleanCode, password: cleanPassword, loginKey };
  } finally {
    if (secondaryApp?.delete) {
      try { await secondaryApp.delete(); } catch (_) {}
    }
  }
}

// Test connection on boot
async function testConnection() {
  if (!db) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Please check your Firebase configuration.');
    }
  }
}
testConnection();

// Operation Type Enum for Error Handling
export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
};

/**
 * Standardized Firestore Error Handler with JSON reporting
 */
export function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path: path || null,
    authInfo: {
      userId: auth?.currentUser?.uid || null,
      email: auth?.currentUser?.email || null,
      emailVerified: auth?.currentUser?.emailVerified || null,
      isAnonymous: auth?.currentUser?.isAnonymous || null,
    }
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Authenticates visitor anonymously using authoritative Firebase Auth UID
 */
export async function authenticateVisitor() {
  if (!auth) {
    throw new Error('Firebase Authentication is unavailable. Check the Firebase configuration.');
  }

  if (auth.currentUser) {
    return auth.currentUser;
  }

  try {
    const userCred = await signInAnonymously(auth);
    return userCred.user;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Firebase anonymous sign-in failed: ${detail}. Enable Anonymous sign-in and authorize this domain in Firebase Authentication.`);
  }
}

/**
 * Securely verifies Owner password against Firebase Auth
 */
export async function verifyOwnerPassword(password) {
  if (!auth || !db || !firebaseConfig.ownerEmail || typeof password !== 'string' || !password) {
    return { success: false, error: 'Firebase owner sign-in is not configured.' };
  }

  try {
    const userCred = await signInWithEmailAndPassword(auth, firebaseConfig.ownerEmail, password);
    const adminSnapshot = await getDoc(doc(db, 'admins', userCred.user.uid));
    if (!adminSnapshot.exists() || adminSnapshot.data().role !== 'owner') {
      const uid = userCred.user.uid;
      await signOut(auth);
      return {
        success: false,
        error: `This account is not registered as an owner. Create admins/${uid} in Firestore with role set to owner.`
      };
    }

    const ownerObj = { uid: userCred.user.uid, email: userCred.user.email, role: 'owner' };
    return { success: true, user: ownerObj };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
    if (code === 'permission-denied') {
      return {
        success: false,
        error: 'Firestore denied owner verification. Deploy firestore.rules and check that your admins document has role set to owner.'
      };
    }
    const detail = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Firebase sign-in failed${code ? ` (${code})` : ''}: ${detail}` };
  }
}

/**
 * Registers or updates visitor profile in Firestore using Auth UID
 */
export async function upsertVisitorProfile(visitor) {
  const { id, publicId, displayName, normalizedName } = visitor;
  const path = `visitors/${id}`;
  const payload = {
    id,
    publicId,
    displayName,
    normalizedName,
    lastActiveAt: new Date().toISOString(),
    isArchived: false,
    unreadCount: visitor.unreadCount || 0
  };

  if (!db) return;

  try {
    await setDoc(doc(db, 'visitors', id), {
      ...payload,
      serverUpdatedAt: serverTimestamp()
    }, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function setVisitorBlocked(visitorId, isBlocked) {
  if (!db) throw new Error('Firestore is unavailable.');

  try {
    await updateDoc(doc(db, 'visitors', visitorId), {
      isBlocked,
      blockedAt: isBlocked ? serverTimestamp() : null
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `visitors/${visitorId}`);
  }
}

export function subscribeToVisitorProfile(visitorId, callback, onError = () => {}) {
  if (!db) return () => {};

  return onSnapshot(doc(db, 'visitors', visitorId), (snapshot) => {
    callback(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
  }, onError);
}

/**
 * Listens for all active visitors (Owner inbox)
 */
export function subscribeToVisitors(callback, onError = () => {}) {
  if (!db) return () => {};

  const path = 'visitors';
  try {
    const q = query(collection(db, 'visitors'), orderBy('lastActiveAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      const visitors = [];
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        // Show active non-archived conversations by default
        if (!data.isArchived) {
          visitors.push({ id: docSnap.id, ...data });
        }
      });
      callback(visitors);
    }, (error) => {
      console.error('Firestore visitor list error:', error);
      onError(error);
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return () => {};
  }
}

/**
 * Sends a message in visitor's private subcollection
 */
export async function sendMessage(msg) {
  if (!db) return;

  const visitorId = msg.visitorId;
  const messageId = msg.id || 'msg_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  const path = `visitors/${visitorId}/messages/${messageId}`;

  const messageData = {
    id: messageId,
    visitorId,
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
    await setDoc(doc(db, 'visitors', visitorId, 'messages', messageId), {
      ...messageData,
      serverCreatedAt: serverTimestamp()
    });

    // Update visitor lastActiveAt and unreadCount if visitor sent
    const visitorRef = doc(db, 'visitors', visitorId);
    if (msg.sender === 'visitor') {
      const visitorSnap = await getDoc(visitorRef);
      const currentUnread = visitorSnap.exists() ? (visitorSnap.data().unreadCount || 0) : 0;
      await updateDoc(visitorRef, {
        lastActiveAt: messageData.createdAt,
        unreadCount: currentUnread + 1
      });
    } else {
      await updateDoc(visitorRef, {
        lastActiveAt: messageData.createdAt
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  return messageData;
}

/**
 * Listens for messages in a visitor's private subcollection
 */
export function subscribeToMessages(visitorId, callback, onError = () => {}) {
  if (!db) return () => {};

  const path = `visitors/${visitorId}/messages`;
  try {
    const q = query(
      collection(db, 'visitors', visitorId, 'messages'),
      orderBy('createdAt', 'asc')
    );
    return onSnapshot(q, (snapshot) => {
      const msgs = [];
      snapshot.forEach(docSnap => {
        msgs.push({ id: docSnap.id, ...docSnap.data() });
      });
      callback(msgs);
    }, (error) => {
      console.error('Firestore message subscription error:', error);
      onError(error);
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return () => {};
  }
}

/**
 * Marks visitor messages as read
 */
export async function markVisitorMessagesAsRead(visitorId) {
  if (!db) return;
  const path = `visitors/${visitorId}`;
  try {
    await updateDoc(doc(db, 'visitors', visitorId), {
      unreadCount: 0
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Sets typing status
 */
export async function setTypingStatus(visitorId, sender, isTyping) {
  if (!db) return;
  const path = `states/${visitorId}`;
  try {
    const field = sender === 'owner' ? 'ownerTyping' : 'visitorTyping';
    await setDoc(doc(db, 'states', visitorId), {
      [field]: isTyping,
      sender,
      isTyping,
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (error) {
    // Non-fatal error for typing state
  }
}

/**
 * Listens to typing status
 */
export function subscribeToTypingStatus(visitorId, callback, onError = () => {}) {
  if (!db) return () => {};
  const path = `states/${visitorId}`;
  try {
    return onSnapshot(doc(db, 'states', visitorId), (snap) => {
      if (snap.exists()) {
        callback(snap.data());
      }
    }, (error) => {
      console.error('Firestore typing subscription error:', error);
      onError(error);
    });
  } catch (error) {
    return () => {};
  }
}
