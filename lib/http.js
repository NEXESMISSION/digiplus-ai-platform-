// Small helpers shared by the API endpoints.

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// Vercel parses JSON bodies into req.body; the local server doesn't, so read the stream then.
async function readBody(req) {
  try {
    if (req.body !== undefined && req.body !== null && req.body !== '') {
      if (typeof req.body === 'string') return JSON.parse(req.body);
      if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8'));
      return req.body;
    }
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 20_000) throw new HttpError(413, 'too_large');
    }
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'bad_json');
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

module.exports = { HttpError, json, readBody, UUID };
