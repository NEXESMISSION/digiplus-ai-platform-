// Bot configuration (one per bot): defaults, validation and data-size measurement.
const crypto = require('crypto');

const DEFAULT_GOALS = [
  {
    key: 'understand_client',
    label: 'Understand the client',
    enabled: true,
    instructions:
      'Find out who the client is and what they really need: their business, the problem they want solved, budget range, timeline and who makes the decision. Ask one or two questions at a time, naturally, never like a form.',
  },
  {
    key: 'clarify_idea',
    label: "Make the client's idea clearer",
    enabled: true,
    instructions:
      'When the idea is vague, help shape it: repeat back what you understood, suggest a simple structure, point out missing pieces, and give a short summary of the clearer idea so the client can confirm it.',
  },
  {
    key: 'explain_pricing',
    label: 'Explain our prices',
    enabled: true,
    instructions:
      'Explain packages and prices clearly, using ONLY the pricing information you were given. Connect the price to the value for this client, and recommend the package that fits their needs. Never invent prices, discounts or deals.',
  },
  {
    key: 'close_deals',
    label: 'Close the deal',
    enabled: true,
    instructions:
      'When the client shows interest, guide them to a decision: recommend a package, answer objections honestly, and ask for a concrete next step (confirm the order, book a call, or leave their phone/email). Confident, never pushy.',
  },
  {
    key: 'collect_contact',
    label: 'Collect contact details',
    enabled: false,
    instructions:
      "Before the conversation ends, politely ask for the client's name and phone number or email so the team can follow up.",
  },
];

const DEFAULTS = {
  businessName: 'My Business',
  botName: 'Assistant',
  businessDescription: '',
  welcomeMessage: 'Hi! 👋 How can I help you today?',
  tone: 'Friendly, professional and confident. Short, clear sentences. Warm, but not over the top.',
  languageRule:
    'Reply in the same language, dialect and alphabet as the client: Arabic letters → Arabic letters, Arabizi/Latin letters (e.g. "9adeh", "3andi") → Latin letters, French → French, English → English. Never mix alphabets in one message.',
  knowledge: [],
  faqs: [],
  packages: [],
  pricingNotes: '',
  rules: '',
  handoff: '',
  goals: DEFAULT_GOALS,
  autoSummary: true,
  askClientInfo: 'optional',
  fallbackMessage: "Sorry, I'm having a technical problem right now. Please try again in a moment.",
  accentColor: '#4f46e5',
};

const str = (v, max, fallback = '') => (typeof v === 'string' ? v.slice(0, max) : fallback);
const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max).filter((x) => x && typeof x === 'object') : null);

function sanitizeSettings(input) {
  const i = input && typeof input === 'object' ? input : {};
  const d = DEFAULTS;

  const knowledge = list(i.knowledge, 200);
  const faqs = list(i.faqs, 500);
  const packages = list(i.packages, 100);
  const goals = list(i.goals, 30);

  return {
    businessName: str(i.businessName, 200, d.businessName),
    botName: str(i.botName, 100, d.botName),
    businessDescription: str(i.businessDescription, 20000, d.businessDescription),
    welcomeMessage: str(i.welcomeMessage, 2000, d.welcomeMessage),
    tone: str(i.tone, 5000, d.tone),
    languageRule: str(i.languageRule, 1000, d.languageRule),
    knowledge: knowledge
      ? knowledge
          .map((k) => ({ title: str(k.title, 200), content: str(k.content, 100000) }))
          .filter((k) => k.title.trim() || k.content.trim())
      : d.knowledge,
    faqs: faqs
      ? faqs.map((f) => ({ q: str(f.q, 1000), a: str(f.a, 6000) })).filter((f) => f.q.trim() || f.a.trim())
      : d.faqs,
    packages: packages
      ? packages
          .map((p) => ({ name: str(p.name, 200), price: str(p.price, 200), includes: str(p.includes, 6000) }))
          .filter((p) => p.name.trim() || p.price.trim() || p.includes.trim())
      : d.packages,
    pricingNotes: str(i.pricingNotes, 10000, d.pricingNotes),
    rules: str(i.rules, 10000, d.rules),
    handoff: str(i.handoff, 2000, d.handoff),
    goals: goals
      ? goals
          .map((g) => ({
            key: /^[a-z0-9_]{1,60}$/.test(g.key) ? g.key : `custom_${crypto.randomBytes(4).toString('hex')}`,
            label: str(g.label, 200),
            enabled: bool(g.enabled, true),
            instructions: str(g.instructions, 3000),
          }))
          .filter((g) => g.label.trim())
      : d.goals,
    autoSummary: bool(i.autoSummary, d.autoSummary),
    askClientInfo: oneOf(i.askClientInfo, ['off', 'optional', 'required'], d.askClientInfo),
    fallbackMessage: str(i.fallbackMessage, 1000, d.fallbackMessage),
    accentColor: /^#[0-9a-f]{6}$/i.test(i.accentColor) ? i.accentColor : d.accentColor,
  };
}

// Characters of business data the bot sends to the AI with every reply (limited per plan).
function dataSize(s) {
  const parts = [
    s.businessDescription, s.tone, s.languageRule, s.pricingNotes, s.rules, s.handoff, s.welcomeMessage,
    ...s.knowledge.flatMap((k) => [k.title, k.content]),
    ...s.faqs.flatMap((f) => [f.q, f.a]),
    ...s.packages.flatMap((p) => [p.name, p.price, p.includes]),
    ...s.goals.filter((g) => g.enabled).flatMap((g) => [g.label, g.instructions]),
  ];
  return parts.reduce((n, x) => n + (x ? x.length : 0), 0);
}

module.exports = { DEFAULTS, DEFAULT_GOALS, sanitizeSettings, dataSize };
