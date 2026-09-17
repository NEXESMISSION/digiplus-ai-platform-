// Safety net: nothing in this project may generate images (or videos) with the paid API.
// Pictures are made in ChatGPT in the browser, which is already included in the account.
// Requiring this file replaces fetch with one that refuses those endpoints.
const BLOCKED = /\/v1\/(images|videos)\b/i;
const original = globalThis.fetch;

if (!globalThis.__noImageApi) {
  globalThis.__noImageApi = true;
  globalThis.fetch = function fetch(input, init) {
    const url = typeof input === 'string' ? input : input?.url || String(input || '');
    if (BLOCKED.test(url)) {
      throw new Error(
        'Blocked: this project never generates images with the paid API (it cost $5.79 in one day). ' +
          'Make the picture in ChatGPT in the browser and save it in the project.'
      );
    }
    return original.call(this, input, init);
  };
}

module.exports = { BLOCKED };
