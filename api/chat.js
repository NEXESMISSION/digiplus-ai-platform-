// The chat page's only endpoint.
//   GET    /api/chat?bot=clim-express&visitor=<uuid>   → the assistant and the conversation so far
//   POST   /api/chat {bot, visitor, texts, batch}      → the assistant's answer
//   DELETE /api/chat {bot, visitor}                    → forget this conversation
const chat = require('../lib/reply');
const { HttpError, json, readBody } = require('../lib/http');

const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.headers['x-real-ip'] || req.socket?.remoteAddress || '';

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      return json(res, 200, await chat.load({ slug: url.searchParams.get('bot'), visitor: url.searchParams.get('visitor') }));
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      return json(res, 200, await chat.send({ slug: body.bot, visitor: body.visitor, texts: body.texts, batch: body.batch, ip: clientIp(req) }));
    }
    if (req.method === 'DELETE') {
      const body = await readBody(req);
      await chat.restart({ slug: body.bot, visitor: body.visitor });
      return json(res, 200, { ok: true });
    }
    res.setHeader('Allow', 'GET, POST, DELETE');
    return json(res, 405, { error: 'method_not_allowed' });
  } catch (e) {
    if (e instanceof chat.ChatError || e instanceof HttpError) return json(res, e.status, { error: e.code });
    console.error(`[api/chat] ${req.method} failed: ${e.stack || e.message}`);
    return json(res, 500, { error: 'server_error' });
  }
};
