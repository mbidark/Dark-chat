importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDV6ijhrHfKihPmYhmmghKwUpjMSf3sdbk",
  authDomain: "dark-chat-ff61d.firebaseapp.com",
  projectId: "dark-chat-ff61d",
  storageBucket: "dark-chat-ff61d.firebasestorage.app",
  messagingSenderId: "284800870037",
  appId: "1:284800870037:web:6e05a14fc40ac49a615d9c"
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || payload.data?.title || 'DARKCHAT';
  const body = payload.notification?.body || payload.data?.body || '';
  self.registration.showNotification(title, {
    body,
    icon: payload.data?.icon || './favicon.ico',
    data: payload.data || {}
  });
});
