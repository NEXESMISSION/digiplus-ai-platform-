// What the pages report: a page opened, and how long it stayed open.
//   POST {id, visitor, session, page, bot, source, device}   → a page was opened
//   POST {id, seconds, events}                               → it was closed
// No personal data is accepted here; see lib/analytics.js.
const crypto = require('crypto');
const analytics = require('../lib/analytics');
const { json, readBody, UUID } = require('../lib/http');

const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
const hashIp = (ip) => crypto.createHash('sha256').update(`digiplus-ai:${ip || 'unknown'}`).digest('hex').slice(0, 32);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'method_not_allowed' });
  }
  try {
    const body = await readBody(req);
    const id = String(body.id || '');
    if (!UUID.test(id)) return json(res, 400, { error: 'bad_id' });

    if (body.page) await analytics.view({ ...body, id, ipHash: hashIp(clientIp(req)) });
    else await analytics.leave({ id, seconds: body.seconds, events: body.events });

    return json(res, 200, { ok: true });
  } catch (e) {
    console.error(`[api/track] ${e.message}`);
    return json(res, 200, { ok: false }); // never break a page over a count
  }
};
