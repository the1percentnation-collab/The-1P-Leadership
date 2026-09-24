// Firebase Cloud Messaging service worker — shows course work reminders and
// other pushes while the site is closed. Registered by public/js/push.js.
// Must live at the site root so its scope covers every page.

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

// Messages with a `notification` block are displayed by the SDK itself, and
// webpush.fcmOptions.link opens the right page on click. Nothing else to do.
firebase.messaging();
