// The assistants people can chat with. Each one has its own link: /chat/<slug>.
// What the page shows is here; what the assistant knows is in brain/<slug>.md
// (and in data/<slug>.json for a shop with a catalogue).
const catalog = require('./catalog');

// Before 14:00 (Tunisia time) a technician still goes out the same day.
const technicianCall = (now) => {
  const hour = (now.getUTCHours() + 1) % 24;
  return hour < 14 ? "Un technicien vous appelle aujourd'hui" : 'Un technicien vous appelle demain matin';
};

const BOTS = {
  'clim-express': {
    name: 'Clim Express',
    logo: { src: '/img/brand/clim-express.webp' },
    colors: { accent: '#00769C', soft: '#E6F7FE', ink: '#005776' },
    demo: true,
    brain: 'clim-express.md',
    welcome: ['Aslema 😊 Marhbe bik fi Clim Express', 'Chnowa t7eb ta3mel: installation, entretien wala réparation?'],
    starters: ['El clim ma3adech tbarred', 'N7eb nrakkeb clim', '9adech el entretien?'],
    profile: {
      kind: 'Entreprise de services · Sfax',
      photo: '/img/clim.webp',
      about: 'Installation, entretien et réparation de climatiseurs, à domicile.',
      skills: ['Donne les prix', 'Prend vos coordonnées', 'Un technicien vous rappelle'],
      hours: 'Tous les jours · 8:00 – 20:00',
    },
    details: {
      fields: [
        { key: 'name', label: 'Nom', hint: "The client's name" },
        { key: 'phone', label: 'Téléphone', hint: 'Tunisian phone number, 8 digits' },
        { key: 'area', label: 'Quartier', hint: 'Neighbourhood or town, e.g. "Sakiet Ezzit"' },
        { key: 'need', label: 'Besoin', hint: 'The job in a few words, always in French even if the client wrote Derja, e.g. "Clim Samsung, ne refroidit plus"' },
      ],
      title: 'Demande enregistrée',
      subtitle: 'Transmise à Clim Express',
      footer: technicianCall,
    },
  },

  'yasmine-photo': {
    name: 'Yasmine Photographe',
    logo: { src: '/img/brand/yasmine-photo.webp' },
    colors: { accent: '#A24B36', soft: '#FFEFEB', ink: '#7A3525' },
    demo: true,
    brain: 'yasmine-photo.md',
    welcome: ['Ahla 😊 Marhbe bik', 'Chnowa séance t7eb: portrait, famille wala grossesse?'],
    starters: ['N7eb shooting famille', '9adech el portrait?', 'Anhi nhar famma place?'],
    profile: {
      kind: 'Photographe freelance · Sfax',
      photo: '/img/photo.webp',
      about: 'Séances portrait, famille, grossesse et nouveau-né, en studio ou en extérieur.',
      skills: ['Présente les séances et les prix', 'Propose les créneaux libres', 'Enregistre votre rendez-vous'],
      hours: 'Fermé le lundi',
    },
    // When someone would rather talk to Yasmine by phone first.
    details: {
      fields: [
        { key: 'name', label: 'Nom', hint: "The client's name" },
        { key: 'phone', label: 'Téléphone', hint: 'Tunisian phone number, 8 digits' },
        { key: 'need', label: 'Sujet', hint: 'What they want to talk about, in a few French words, e.g. "Questions sur la séance famille"' },
      ],
      title: 'Demande de rappel',
      subtitle: 'Transmise à Yasmine',
      footer: () => 'Yasmine vous appelle très vite',
    },
    booking: {
      // Opening times by day of the week, 0 = Sunday. Monday closed.
      hours: {
        0: ['10:00', '11:30'],
        1: [],
        2: ['10:00', '11:30', '15:00', '16:30'],
        3: ['10:00', '11:30', '15:00', '16:30'],
        4: ['10:00', '11:30', '15:00', '16:30'],
        5: ['15:00', '16:30'],
        6: ['10:00', '11:30', '15:00', '16:30'],
      },
      daysAhead: 14,
      noticeHours: 3,
      title: 'Demande envoyée',
      subtitle: 'Yasmine vous confirme très vite',
      footer: 'En attente de confirmation',
    },
  },

  'patisserie-nour': {
    name: 'Pâtisserie Nour',
    logo: { src: '/img/brand/patisserie-nour.webp' },
    colors: { accent: '#9D3E5C', soft: '#FCEEF2', ink: '#7A2E47' },
    demo: true,
    brain: 'patisserie-nour.md',
    welcome: ['Aslema 😊 Marhbe bik fi Pâtisserie Nour', 'Chnowa t7eb: gâteau, pâtisserie tunisienne wala plateau?'],
    starters: ['Chnowa famma gâteaux?', '9adech el baklawa?', 'N7eb gâteau l 10 personnes'],
    profile: {
      kind: 'Pâtisserie · Sfax',
      photo: null,
      about: 'Gâteaux sur commande et pâtisserie tunisienne, en retrait ou livrés à Sfax.',
      skills: ['Montre le catalogue avec les prix', 'Conseille selon le nombre de personnes', 'Prend la commande'],
      hours: 'Tous les jours · 8:00 – 20:00',
    },
    catalog: require('../data/patisserie-nour.json'),
    order: {
      title: 'Commande envoyée',
      subtitle: 'Pâtisserie Nour vous confirme très vite',
      footer: 'En attente de confirmation',
    },
  },

  digiplus: {
    name: 'DigiPlus AI',
    // Our own logo keeps its rounded square, on white.
    logo: { src: '/logo.png', inset: true },
    colors: { accent: '#B44F00', soft: '#FFF0E6', ink: '#7A3A0C' },
    demo: false,
    brain: 'digiplus.md',
    welcome: ['Aslema 😊 Marhbe bik fi DigiPlus', 'T7eb assistant kima hedha lel activité mte3ek?'],
    starters: ['Kifech ya5dem?', '9adech yji?', 'Ey, n7eb wa7ed'],
    profile: {
      kind: 'Assistant de chat · Sfax',
      photo: null,
      about: "Posez vos questions sur DigiPlus AI : comment ça marche, les tarifs, et ce qu'il peut faire pour votre activité.",
      skills: ['Explique comment ça marche', 'Donne les tarifs', 'On vous rappelle'],
      hours: 'Répond 24h/24',
    },
    details: {
      fields: [
        { key: 'name', label: 'Nom', hint: "The person's name" },
        { key: 'business', label: 'Activité', hint: 'Their business and city in a few words, always in French, e.g. "Salon de coiffure, Sfax"' },
        { key: 'phone', label: 'Téléphone', hint: 'Tunisian phone number, 8 digits' },
        { key: 'plan', label: 'Formule', hint: 'The plan they want: "Starter", "Pro" or "Business", or "À choisir" if they have not chosen' },
      ],
      title: 'Demande enregistrée',
      subtitle: 'Transmise à DigiPlus',
      footer: () => 'DigiPlus vous appelle très vite',
    },
  },
};

for (const [slug, bot] of Object.entries(BOTS)) bot.slug = slug;

const get = (slug) => (Object.hasOwn(BOTS, slug) ? BOTS[slug] : null);

// Only what the chat page needs.
const publicInfo = (bot) => ({
  slug: bot.slug,
  name: bot.name,
  logo: bot.logo,
  colors: bot.colors,
  demo: bot.demo,
  welcome: bot.welcome,
  starters: bot.starters,
  profile: bot.profile,
  catalog: bot.catalog ? catalog.publicView(bot.catalog) : null,
});

const all = () => Object.values(BOTS).map(publicInfo);

module.exports = { get, publicInfo, all };
