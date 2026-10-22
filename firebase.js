/**
 * DARKCHAT — Firebase Client & Data Layer
 * Strict Auth UID Identity, Real-Time Firestore Synchronization & Error Handling
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
  getDocFromServer,
  updateDoc,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  where,
  serverTimestamp
} from 'firebase/firestore';

import firebaseConfig from './firebase-applet-config.json';

let app = null;
try {
  app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
} catch (e) {
  console.error('Firebase initialization error:', e);
}

export const db = app ? getFirestore(app, firebaseConfig.firestoreDatabaseId) : null;
export const auth = app ? getAuth(app) : null;

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
export function subscribeToMessages(visitorId, callback) {
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
      handleFirestoreError(error, OperationType.LIST, path);
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
export function subscribeToTypingStatus(visitorId, callback) {
  if (!db) return () => {};
  const path = `states/${visitorId}`;
  try {
    return onSnapshot(doc(db, 'states', visitorId), (snap) => {
      if (snap.exists()) {
        callback(snap.data());
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });
  } catch (error) {
    return () => {};
  }
}
