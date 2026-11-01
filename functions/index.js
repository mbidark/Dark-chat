const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

async function sendNotification(role, uid, title, body, url) {
  const tokensQuery = await db.collection('notificationTokens')
    .where('role', '==', role)
    .get();
  const tokens = [];
  tokensQuery.forEach(doc => {
    const data = doc.data();
    if (role === 'owner' || data.uid === uid) tokens.push(doc.id);
  });
  if (!tokens.length) return;

  const response = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    webpush: { fcmOptions: { link: url } },
    data: { title, body, url }
  });

  const invalid = [];
  response.responses.forEach((result, index) => {
    if (result.error?.code === 'messaging/registration-token-not-registered') {
      invalid.push(tokens[index]);
    }
  });
  await Promise.all(invalid.map(token => db.collection('notificationTokens').doc(token).delete()));
}

exports.notifyNewChatMessage = onDocumentCreated(
  'visitors/{visitorId}/messages/{messageId}',
  async event => {
    const message = event.data?.data();
    if (!message?.text) return;
    const visitorId = event.params.visitorId;

    if (message.sender === 'visitor') {
      await sendNotification(
        'owner',
        null,
        `New message from ${message.displayName || 'User'}`,
        message.text,
        './owner.html'
      );
    } else if (message.sender === 'owner') {
      await sendNotification(
        'visitor',
        visitorId,
        'Dark replied',
        message.text,
        './index.html'
      );
    }
  }
);
