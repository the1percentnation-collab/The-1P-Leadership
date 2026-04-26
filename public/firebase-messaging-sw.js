// Firebase Cloud Messaging service worker.
//
// Receives background push notifications when a course goes live (or for any
// other server-sent FCM message). Foreground messages are handled directly in
// /js/messaging.js via onMessage().
//
// Loaded from the site root so its scope covers the whole app.

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCSZvsExv7O_yjE2UzJ4QQ7lsA4R9zG4_A',
  authDomain: 'the-1p-leadership.firebaseapp.com',
  projectId: 'the-1p-leadership',
  storageBucket: 'the-1p-leadership.firebasestorage.app',
  messagingSenderId: '14602661529',
  appId: '1:14602661529:web:8031e6f7755f757cb45208'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const n = (payload && payload.notification) || {};
  const data = (payload && payload.data) || {};
  const title = n.title || '1P Leadership';
  const options = {
    body: n.body || '',
    icon: n.icon || '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    data: { ...data, click_action: data.url || n.click_action || '/courses.html' }
  };
  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.click_action) || '/courses.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes(url) && 'focus' in w) return w.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
