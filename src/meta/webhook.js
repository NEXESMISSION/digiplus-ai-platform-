// Turns Meta webhook payloads (WhatsApp, Messenger, Instagram) into simple inbound events.

const mediaNote = (kind, caption) =>
  `[The client sent ${kind}. You can only read text, so if it matters, kindly ask them to write it.]${caption ? `\nCaption: ${caption}` : ''}`;

function whatsappText(m) {
  switch (m.type) {
    case 'text': return m.text?.body;
    case 'button': return m.button?.text;
    case 'interactive': return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title;
    case 'image': return mediaNote('a photo', m.image?.caption);
    case 'video': return mediaNote('a video', m.video?.caption);
    case 'document': return mediaNote(`a file (${m.document?.filename || 'document'})`, m.document?.caption);
    case 'audio': return mediaNote('a voice message');
    case 'sticker': return mediaNote('a sticker');
    case 'location': return `[The client shared a location: ${[m.location?.name, m.location?.address].filter(Boolean).join(', ') || 'map pin'}]`;
    default: return null; // reactions, system messages… nothing to answer
  }
}

function messagingText(e) {
  if (e.postback) return e.postback.title || e.postback.payload;
  const m = e.message;
  if (!m) return null;
  if (m.text) return m.text;
  if (m.attachments?.length) return mediaNote(`an attachment (${m.attachments.map((a) => a.type).join(', ')})`);
  return null;
}

/*
  Returns a list of:
  { kind: 'message', channel, assetId, userId, messageId, text, name, contact, timestamp }
  { kind: 'echo', channel, assetId, userId, messageId, appId }   ← message sent by the Page (human or app)
*/
function parseWebhook(body) {
  const events = [];

  if (body?.object === 'whatsapp_business_account') {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;
        const v = change.value || {};
        const assetId = v.metadata?.phone_number_id;
        const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name || '']));
        for (const m of v.messages || []) {
          const text = whatsappText(m);
          if (!text || !m.from || !m.id || !assetId) continue;
          events.push({
            kind: 'message',
            channel: 'whatsapp',
            assetId,
            userId: m.from,
            messageId: m.id,
            text,
            name: names[m.from] || '',
            contact: `+${m.from}`,
            timestamp: Number(m.timestamp) * 1000 || Date.now(),
          });
        }
      }
    }
    return events;
  }

  if (body?.object === 'page' || body?.object === 'instagram') {
    const channel = body.object === 'page' ? 'messenger' : 'instagram';
    for (const entry of body.entry || []) {
      for (const e of entry.messaging || []) {
        const assetId = String(entry.id || e.recipient?.id || '');
        if (e.message?.is_echo) {
          // For echoes the Page is the sender and the client is the recipient.
          if (e.recipient?.id && e.message.mid) {
            events.push({ kind: 'echo', channel, assetId, userId: String(e.recipient.id), messageId: e.message.mid, appId: e.message.app_id ? String(e.message.app_id) : null });
          }
          continue;
        }
        const text = messagingText(e);
        const messageId = e.message?.mid || (e.postback && `postback-${e.sender?.id}-${e.timestamp}`);
        if (!text || !e.sender?.id || !messageId || !assetId) continue;
        events.push({
          kind: 'message',
          channel,
          assetId,
          userId: String(e.sender.id),
          messageId,
          text,
          name: '',
          contact: '',
          timestamp: Number(e.timestamp) || Date.now(),
        });
      }
    }
  }
  return events;
}

module.exports = { parseWebhook };
