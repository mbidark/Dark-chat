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
  const url = payload.data?.url || './';
  self.registration.showNotification(title, {
    body,
    icon: payload.data?.icon || './icon.svg',
    badge: './icon.svg',
    data: { ...payload.data, url }
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const requestedUrl = event.notification.data?.url || './';
  const targetUrl = new URL(requestedUrl, self.registration.scope).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
    for (const client of windowClients) {
      if ('focus' in client && new URL(client.url).origin === self.location.origin) {
        client.navigate(targetUrl);
        return client.focus();
      }
    }
    return clients.openWindow(targetUrl);
  }));
});
