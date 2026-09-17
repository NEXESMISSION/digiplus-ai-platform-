// What an assistant can do besides talking: save a client's details, or book a time.
// The AI calls these as tools; each returns a short result for the AI and, when it worked,
// a card the client sees in the chat.
const store = require('./store');
const schedule = require('./schedule');
const catalogs = require('./catalog');

// "22 123 456", "+216 22123456", "0021622123456" → "22123456"
function tunisianPhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('00216')) digits = digits.slice(5);
  if (digits.length === 11 && digits.startsWith('216')) digits = digits.slice(3);
  return /^[2-9]\d{7}$/.test(digits) ? digits : null;
}
const showPhone = (d) => `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`;

const clean = (value, max = 160) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const stringProps = (entries) => Object.fromEntries(entries.map(([key, description]) => [key, { type: 'string', description }]));

function definitions(bot) {
  const tools = [];
  if (bot.details) {
    const fields = bot.details.fields;
    tools.push({
      type: 'function',
      function: {
        name: 'save_details',
        description:
          "Send the client's request to the business so they call the client back. Call it once you have every field. The client then sees a card with these details.",
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: fields.map((f) => f.key),
          properties: stringProps(fields.map((f) => [f.key, f.hint])),
        },
      },
    });
  }
  if (bot.catalog) {
    tools.push(
      {
        type: 'function',
        function: {
          name: 'show_products',
          description:
            'Show products from the catalogue as cards with photo and price. Use it when the client asks what there is, a kind of product, or a product by name. Leave query and category empty to show a selection.',
          strict: true,
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['query', 'category'],
            properties: stringProps([
              ['query', 'Words from the client, e.g. "chocolat", "baklawa", "anniversaire", or empty'],
              ['category', `A category id (${bot.catalog.categories.map((c) => c.id).join(', ')}) or empty`],
            ]),
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'save_order',
          description:
            'Send the order to the shop. Call it once you have the products with their size, retrait or livraison (with the address for livraison), the day and time, the name and the phone. The client then sees the order with the total.',
          strict: true,
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['items', 'delivery', 'address', 'day', 'time', 'name', 'phone'],
            properties: {
              items: {
                type: 'array',
                description: 'The products ordered',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['product', 'option', 'quantity'],
                  properties: {
                    product: { type: 'string', description: 'Product id from the catalogue, e.g. "fraisier"' },
                    option: { type: 'string', description: 'The size exactly as in the catalogue, e.g. "10 personnes" or "1 kg"' },
                    quantity: { type: 'integer', description: 'How many, usually 1' },
                  },
                },
              },
              delivery: { type: 'string', enum: ['retrait', 'livraison'], description: 'Pick-up at the shop or delivery' },
              address: { type: 'string', description: 'Delivery address, or empty for retrait' },
              day: { type: 'string', description: 'Day of pick-up or delivery, YYYY-MM-DD' },
              time: { type: 'string', description: 'Time, HH:MM, between opening and closing' },
              name: { type: 'string', description: "The client's name" },
              phone: { type: 'string', description: 'Tunisian phone number, 8 digits' },
            },
          },
        },
      }
    );
  }
  if (bot.booking) {
    tools.push({
      type: 'function',
      function: {
        name: 'book_appointment',
        description:
          'Send a booking request for one of the free times. Call it once you have the séance, a free time the client chose, their name and their phone. The client then sees a card with the booking.',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['service', 'date', 'time', 'name', 'phone'],
          properties: stringProps([
            ['service', 'The séance in French with its length, e.g. "Shooting famille · 1h"'],
            ['date', 'Day of a free time, YYYY-MM-DD'],
            ['time', 'Hour of that free time, HH:MM'],
            ['name', "The client's name"],
            ['phone', 'Tunisian phone number, 8 digits'],
          ]),
        },
      },
    });
  }
  return tools;
}

// Demo bookings don't block anyone else: every visitor sees the full calendar.
async function freeSlots(bot, now = new Date()) {
  const taken = bot.demo ? [] : await store.takenTimes(bot.slug, now);
  return schedule.freeSlots(bot.booking, taken, now);
}

async function saveDetails(bot, conversation, args) {
  const data = {};
  for (const field of bot.details.fields) {
    const value = clean(args[field.key]);
    if (!value) return { result: `Not saved: "${field.key}" is missing. Ask the client for it.` };
    data[field.key] = value;
  }
  const phone = tunisianPhone(data.phone);
  if (!phone) return { result: 'Not saved: the phone number is not a Tunisian number with 8 digits. Ask the client to write it again.' };
  data.phone = showPhone(phone);

  const previous = await store.latestRequest(conversation.id, 'details');
  if (previous && JSON.stringify(previous.data) === JSON.stringify(data)) {
    return { result: 'Already saved with the same details earlier in this chat. Do not save again.' };
  }
  await store.saveRequest({ bot: bot.slug, conversationId: conversation.id, kind: 'details', data, status: 'new' });

  const { title, subtitle } = bot.details;
  const footer = bot.details.footer(new Date());
  return {
    result: `Saved. The client now sees a card with these details, ending with: "${footer}". Thank them in one short line and say what happens next, matching that line. Do not repeat the details.`,
    card: {
      type: 'summary',
      icon: 'check',
      title,
      subtitle,
      rows: bot.details.fields.map((f) => [f.label, data[f.key]]),
      footer,
    },
  };
}

async function bookAppointment(bot, conversation, args) {
  const slots = await freeSlots(bot);
  const slot = slots.find((s) => s.date === clean(args.date) && s.time === clean(args.time));
  if (!slot) {
    const some = slots.slice(0, 8).map((s) => `${s.day} ${s.time}`).join(', ');
    return { result: `Not booked: ${args.date} ${args.time} is not a free time. Free times include: ${some}. Ask the client to pick one.` };
  }
  const service = clean(args.service, 80);
  const name = clean(args.name, 80);
  if (!service || !name) return { result: 'Not booked: the séance or the name is missing. Ask the client.' };
  const phone = tunisianPhone(args.phone);
  if (!phone) return { result: 'Not booked: the phone number is not a Tunisian number with 8 digits. Ask the client to write it again.' };

  const data = { service, date: slot.date, time: slot.time, name, phone: showPhone(phone) };
  // One booking request per chat: choosing another time moves it.
  const previous = await store.latestRequest(conversation.id, 'booking');
  if (previous && previous.status === 'pending') {
    await store.updateRequest(previous.id, { data, starts_at: slot.at });
  } else {
    await store.saveRequest({ bot: bot.slug, conversationId: conversation.id, kind: 'booking', data, startsAt: slot.at, status: 'pending' });
  }

  const { title, subtitle, footer } = bot.booking;
  return {
    result:
      'Booking request sent. The client now sees a card with the séance, the time and their name. Thank them in one short line and say Yasmine confirms soon. Do not repeat the details.',
    card: {
      type: 'summary',
      icon: 'clock',
      title,
      subtitle,
      rows: [
        ['Séance', service],
        ['Quand', `${slot.day}, ${slot.time}`],
        ['Client', name],
        ['Téléphone', data.phone],
      ],
      footer,
      pending: true,
    },
  };
}

function showProducts(bot, args) {
  const found = catalogs.search(bot.catalog, { query: clean(args.query, 80), category: clean(args.category, 40) });
  if (!found.length) {
    return { result: `Nothing in the catalogue matches "${args.query}". Say so kindly and offer what exists (categories: ${bot.catalog.categories.map((c) => c.name).join(', ')}).` };
  }
  const view = catalogs.publicView(bot.catalog);
  const cards = found.map((p) => view.products.find((v) => v.id === p.id));
  return {
    result: `The client now sees these products as cards with photo and price: ${found
      .map((p) => `${p.name} (${p.options.map((o) => `${o.label} ${o.price}dt`).join(', ')})`)
      .join('; ')}. Don't list them again: in one short line, ask which one they want, or answer their question.`,
    card: { type: 'products', items: cards.map(({ id, name, image, from, options }) => ({ id, name, image, from, options })) },
  };
}

async function saveOrder(bot, conversation, args) {
  const catalog = bot.catalog;
  const priced = catalogs.priceOrder(catalog, { items: args.items, delivery: args.delivery });
  if (priced.error) return { result: `Not saved: ${priced.error} Ask the client.` };

  const today = schedule.todayYmd();
  const day = clean(args.day, 10);
  const time = clean(args.time, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < today) return { result: `Not saved: the day must be today (${today}) or later. Ask the client which day.` };
  if (priced.lines.some((l) => l.category !== 'tunisien') && day <= today) {
    return { result: 'Not saved: cakes, plateaux and mignardises must be ordered 24h in advance, so the day must be tomorrow or later. Tell the client and ask for another day.' };
  }
  if (!/^\d{2}:\d{2}$/.test(time) || time < catalog.hours.open || time > catalog.hours.close) {
    return { result: `Not saved: the time must be between ${catalog.hours.open} and ${catalog.hours.close}. Ask the client.` };
  }
  const delivery = args.delivery === 'livraison' ? 'livraison' : 'retrait';
  const address = clean(args.address, 160);
  if (delivery === 'livraison' && !address) return { result: 'Not saved: the delivery address is missing. Ask the client.' };
  const name = clean(args.name, 80);
  if (!name) return { result: "Not saved: the client's name is missing. Ask the client." };
  const phone = tunisianPhone(args.phone);
  if (!phone) return { result: 'Not saved: the phone number is not a Tunisian number with 8 digits. Ask the client to write it again.' };

  const data = { items: priced.lines, fee: priced.fee, total: priced.total, delivery, address, day, time, name, phone: showPhone(phone) };
  const previous = await store.latestRequest(conversation.id, 'order');
  if (previous && previous.status === 'pending') await store.updateRequest(previous.id, { data, starts_at: schedule.instant(day, time).toISOString() });
  else {
    await store.saveRequest({ bot: bot.slug, conversationId: conversation.id, kind: 'order', data, startsAt: schedule.instant(day, time).toISOString(), status: 'pending' });
  }

  const when = `${schedule.shortDay(day)}, ${time}`;
  const rows = [
    ...priced.lines.map((l) => [`${l.name} · ${l.option}${l.quantity > 1 ? ` × ${l.quantity}` : ''}`, `${l.price}dt`]),
    ...(priced.fee ? [['Livraison', `${priced.fee}dt`]] : []),
    ['Total', `${priced.total}dt`],
    [delivery === 'livraison' ? 'Livraison' : 'Retrait', when],
    ...(delivery === 'livraison' ? [['Adresse', address]] : []),
    ['Client', name],
    ['Téléphone', data.phone],
  ];
  const { title, subtitle, footer } = bot.order;
  return {
    result: `Order sent. Total ${priced.total}dt. The client now sees a card with the products, the total and the time. Thank them in one short line and say the shop confirms soon. Do not repeat the details.`,
    card: { type: 'summary', icon: 'clock', title, subtitle, rows, footer, pending: true },
  };
}

async function run(bot, conversation, name, args) {
  if (name === 'save_details' && bot.details) return saveDetails(bot, conversation, args || {});
  if (name === 'book_appointment' && bot.booking) return bookAppointment(bot, conversation, args || {});
  if (name === 'show_products' && bot.catalog) return showProducts(bot, args || {});
  if (name === 'save_order' && bot.catalog) return saveOrder(bot, conversation, args || {});
  return { result: `Unknown tool ${name}.` };
}

// The free-times card the page shows when the assistant asks the client to pick a time:
// a morning and an afternoon time for each of the next days, so the first buttons cover two days.
async function slotsCard(bot) {
  const byDay = new Map();
  for (const slot of await freeSlots(bot)) byDay.set(slot.date, [...(byDay.get(slot.date) || []), slot]);
  const picked = [];
  for (const times of byDay.values()) {
    const afternoon = times.find((s, i) => i > 0 && s.time >= '13:00') || times[1];
    picked.push(...[times[0], afternoon].filter(Boolean));
    if (picked.length >= 12) break;
  }
  const slots = picked.slice(0, 12).map(({ date, time, day, text }) => ({ date, time, day, text }));
  return { type: 'slots', title: 'Créneaux disponibles', slots };
}

module.exports = { definitions, run, freeSlots, slotsCard, tunisianPhone };
