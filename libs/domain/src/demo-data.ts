// Demo data for a person trying the app on staging: garages in Timișoara and
// six other cities with full price lists, drivers with cars and history, and
// an account holding every role. Run by Node (type stripping) after seed.ts,
// by the staging reset, so it imports nothing from the workspace.
//
// It keeps clear of what the end-to-end suite counts on staging: no garage in
// București, Cluj-Napoca or Constanța, nothing on a seeded garage or account,
// no file waiting for an admin, and no account under @example.test (the seed's
// clearDay() deletes their requests). Written once: a second run changes
// nothing.
import { Client } from 'pg';

if (process.env['APP_ENV'] === 'production') {
  console.error('demo data refused: APP_ENV=production');
  process.exit(1);
}

// The person the demo is for: every role, each at its own garage.
const OWNER = { email: 'hutanugeorge40@gmail.com', name: 'George Huțanu' };
const DOMAIN = 'motorfix-demo.test';
// The seed's driver: its password hash and accepted texts are copied, so every
// demo account signs in with the seed password, under the texts in force.
const SEED_ACCOUNT = 'sofer@example.test';

type Brand =
  | 'audi'
  | 'bmw'
  | 'dacia'
  | 'ford'
  | 'mercedes-benz'
  | 'renault'
  | 'skoda'
  | 'tesla'
  | 'toyota'
  | 'volkswagen';
type Fuel = 'petrol' | 'diesel' | 'hybrid' | 'electric';

// Jobs the catalogue lacks; the API's loader only adds and renames its own.
const NEW_JOBS: [string, string, string, boolean][] = [
  [
    'rear-brakes',
    'Plăcuțe și discuri de frână spate',
    'Rear brake pads and discs',
    true,
  ],
  ['timing-belt', 'Kit distribuție cu curea', 'Timing belt kit', true],
  ['clutch-kit', 'Kit ambreiaj', 'Clutch kit', true],
  ['tyre-change', 'Schimb anvelope sezonier', 'Seasonal tyre change', false],
  ['wheel-balancing', 'Echilibrare roți', 'Wheel balancing', false],
  ['battery-replacement', 'Înlocuire baterie', 'Battery replacement', false],
  ['itp-check', 'Verificare înainte de ITP', 'Pre-inspection check', true],
  ['dpf-cleaning', 'Curățare filtru de particule', 'DPF cleaning', true],
  ['spark-plugs', 'Schimb bujii', 'Spark plug replacement', false],
  [
    'ev-battery-check',
    'Verificare baterie de tracțiune',
    'EV traction battery check',
    true,
  ],
];

// A middle-of-the-market price per job, in bani, and its minutes; each garage
// scales it by its tier.
const BASE: Record<string, [number, number, number]> = {
  'ac-regas': [25000, 38000, 45],
  'battery-replacement': [45000, 90000, 30],
  'clutch-kit': [180000, 350000, 360],
  diagnosis: [15000, 25000, 30],
  'dpf-cleaning': [60000, 110000, 180],
  'ev-battery-check': [30000, 50000, 60],
  'front-brakes': [80000, 140000, 120],
  'itp-check': [10000, 18000, 45],
  'oil-service': [25000, 45000, 60],
  'rear-brakes': [70000, 120000, 120],
  'spark-plugs': [15000, 35000, 45],
  'suspension-alignment': [30000, 45000, 90],
  'timing-belt': [120000, 250000, 300],
  'timing-chain': [400000, 700000, 480],
  'tyre-change': [12000, 20000, 40],
  'wheel-balancing': [8000, 15000, 30],
};

const ALL: Fuel[] = ['petrol', 'diesel', 'hybrid', 'electric'];
const COMBUSTION: Fuel[] = ['petrol', 'diesel', 'hybrid'];

// What a kind of garage works on, refuses and prices. `extra` are brand
// prices: the job, the brand and how much above the garage's own.
const PROFILES: Record<
  string,
  {
    brands: Partial<Record<Brand, Fuel[] | 'refuses'>>;
    jobs: string[];
    extra?: [string, Brand, number][];
  }
> = {
  budget: {
    brands: {
      dacia: ['petrol', 'diesel'],
      ford: ['petrol', 'diesel'],
      renault: ['petrol', 'diesel'],
      skoda: ['petrol', 'diesel'],
      tesla: 'refuses',
    },
    jobs: [
      'oil-service',
      'front-brakes',
      'rear-brakes',
      'timing-belt',
      'clutch-kit',
      'itp-check',
      'tyre-change',
      'wheel-balancing',
      'spark-plugs',
    ],
  },
  diesel: {
    brands: {
      dacia: ['diesel'],
      ford: ['diesel'],
      renault: ['diesel'],
      skoda: ['diesel'],
      volkswagen: ['diesel'],
    },
    extra: [['dpf-cleaning', 'volkswagen', 1.15]],
    jobs: [
      'diagnosis',
      'oil-service',
      'timing-belt',
      'clutch-kit',
      'dpf-cleaning',
      'front-brakes',
      'itp-check',
    ],
  },
  ev: {
    brands: {
      tesla: ['electric'],
      toyota: ['hybrid', 'electric'],
      volkswagen: ['electric'],
    },
    extra: [
      ['ev-battery-check', 'tesla', 1.3],
      ['front-brakes', 'tesla', 1.2],
    ],
    jobs: [
      'diagnosis',
      'ev-battery-check',
      'front-brakes',
      'rear-brakes',
      'ac-regas',
      'suspension-alignment',
      'tyre-change',
    ],
  },
  general: {
    brands: {
      dacia: COMBUSTION,
      ford: COMBUSTION,
      renault: COMBUSTION,
      skoda: COMBUSTION,
      tesla: 'refuses',
      toyota: COMBUSTION,
      volkswagen: COMBUSTION,
    },
    extra: [['timing-belt', 'volkswagen', 1.1]],
    jobs: [
      'diagnosis',
      'oil-service',
      'front-brakes',
      'rear-brakes',
      'timing-belt',
      'clutch-kit',
      'ac-regas',
      'suspension-alignment',
      'itp-check',
      'battery-replacement',
      'spark-plugs',
    ],
  },
  mobile: {
    brands: {
      dacia: COMBUSTION,
      ford: COMBUSTION,
      renault: COMBUSTION,
      skoda: COMBUSTION,
      toyota: COMBUSTION,
      volkswagen: COMBUSTION,
    },
    jobs: [
      'diagnosis',
      'oil-service',
      'battery-replacement',
      'spark-plugs',
      'tyre-change',
    ],
  },
  premium: {
    brands: {
      audi: COMBUSTION,
      bmw: COMBUSTION,
      dacia: 'refuses',
      'mercedes-benz': COMBUSTION,
      volkswagen: COMBUSTION,
    },
    extra: [
      ['oil-service', 'bmw', 1.25],
      ['oil-service', 'mercedes-benz', 1.3],
      ['front-brakes', 'bmw', 1.35],
      ['front-brakes', 'mercedes-benz', 1.4],
      ['timing-chain', 'bmw', 1.2],
    ],
    jobs: [
      'diagnosis',
      'oil-service',
      'front-brakes',
      'rear-brakes',
      'timing-chain',
      'ac-regas',
      'suspension-alignment',
      'dpf-cleaning',
      'battery-replacement',
    ],
  },
  tyres: {
    brands: {
      audi: ALL,
      bmw: ALL,
      dacia: ALL,
      ford: ALL,
      'mercedes-benz': ALL,
      renault: ALL,
      skoda: ALL,
      tesla: ALL,
      toyota: ALL,
      volkswagen: ALL,
    },
    jobs: [
      'tyre-change',
      'wheel-balancing',
      'suspension-alignment',
      'battery-replacement',
      'itp-check',
    ],
  },
};

const CITIES: Record<string, string> = {
  arad: 'Arad',
  brasov: 'Brașov',
  craiova: 'Craiova',
  iasi: 'Iași',
  oradea: 'Oradea',
  sibiu: 'Sibiu',
  timisoara: 'Timișoara',
};

// One staff card: a name, what they do, and an account when they sign in.
type Staff = [
  name: string,
  speciality: string,
  title: string,
  years: number,
  account?: true,
];

interface DemoGarage {
  slug: string;
  name: string;
  city: string;
  at: [number, number];
  address: string;
  kind: 'company' | 'pfa' | 'ii' | 'mobile';
  profile: string;
  tier: number;
  lifts: number;
  // Finished jobs, each with a review, and the rating they lean towards.
  reviews: number;
  quality: number;
  owner: string;
  staff: Staff[];
  receptionist?: string;
  saturday?: true;
  courtesy?: number | 'free';
  knownFor?: string;
  brandNote?: string;
  radiusKm?: number;
}

const GARAGES: DemoGarage[] = [
  {
    address: 'Calea Șagului 120, Timișoara',
    at: [45.7365, 21.205],
    brandNote:
      'Lucrăm pe benzină, diesel și hibrid; nu reparăm mașini electrice.',
    city: 'timisoara',
    kind: 'company',
    knownFor:
      'Distribuții și ambreiaje făcute în aceeași zi, cu piese garantate.',
    lifts: 3,
    name: 'Atelier George',
    owner: OWNER.name,
    profile: 'general',
    quality: 4.7,
    receptionist: 'Laura Ene',
    reviews: 9,
    saturday: true,
    slug: 'demo-atelier-george',
    staff: [
      ['Florin Bălan', 'Motor, Distribuție', 'Mecanic șef', 14, true],
      ['Cristian Dumitrescu', 'Frâne, Suspensie', 'Mecanic', 6],
      ['Alex Pop', 'Diagnoză electrică', 'Electrician auto', 4],
    ],
    tier: 1,
  },
  {
    address: 'Strada Ștefan cel Mare 31, Timișoara',
    at: [45.758, 21.24],
    city: 'timisoara',
    courtesy: 120,
    kind: 'company',
    lifts: 2,
    name: 'Service Auto Fabric',
    owner: 'Sorin Vlad',
    profile: 'general',
    quality: 4.6,
    reviews: 14,
    slug: 'demo-service-fabric',
    staff: [
      ['Ionuț Rusu', 'Motor, Cutii de viteze', 'Mecanic șef', 18, true],
      ['Paul Moldovan', 'Climatizare, Electrică', 'Mecanic', 7],
    ],
    tier: 1.1,
  },
  {
    address: 'Calea Aradului 75, Timișoara',
    at: [45.7745, 21.2195],
    city: 'timisoara',
    kind: 'pfa',
    knownFor: 'Specialiști în motoare diesel și filtre de particule.',
    lifts: 2,
    name: 'Garaj Calea Aradului',
    owner: 'Dorin Muntean',
    profile: 'diesel',
    quality: 4.4,
    reviews: 6,
    slug: 'demo-garaj-calea-aradului',
    staff: [['Marius Tănase', 'Injecție diesel', 'Mecanic', 9]],
    tier: 0.95,
  },
  {
    address: 'Strada Petőfi Sándor 12, Dumbrăvița',
    at: [45.797, 21.242],
    brandNote: 'Doar BMW, Mercedes-Benz, Audi și Volkswagen.',
    city: 'timisoara',
    courtesy: 150,
    kind: 'company',
    knownFor: 'Service premium pentru mărci germane, cu mașină de schimb.',
    lifts: 4,
    name: 'Premium Motors Dumbrăvița',
    owner: 'Andreea Kovács',
    profile: 'premium',
    quality: 4.9,
    receptionist: 'Bianca Szabo',
    reviews: 11,
    saturday: true,
    slug: 'demo-premium-dumbravita',
    staff: [
      ['Robert Lazăr', 'BMW, Mercedes-Benz', 'Tehnician principal', 16, true],
      ['Gabriel Neagu', 'Diagnoză, Electronică', 'Tehnician', 8],
      ['Ștefan Iliescu', 'Distribuție, Motor', 'Mecanic', 11],
    ],
    tier: 1.6,
  },
  {
    address: 'Strada Gheorghe Lazăr 40, Timișoara',
    at: [45.753, 21.215],
    city: 'timisoara',
    kind: 'company',
    knownFor: 'Electrice și hibride: baterii, frâne regenerative, climatizare.',
    lifts: 2,
    name: 'EV Lab Timișoara',
    owner: 'Victor Constantin',
    profile: 'ev',
    quality: 4.8,
    reviews: 5,
    slug: 'demo-ev-lab-timisoara',
    staff: [['Adrian Mihai', 'Baterii de tracțiune', 'Tehnician EV', 5, true]],
    tier: 1.3,
  },
  {
    address: 'Strada Principală 210, Giroc',
    at: [45.7, 21.24],
    city: 'timisoara',
    kind: 'ii',
    lifts: 2,
    name: 'Service Giroc',
    owner: 'Nicolae Barbu',
    profile: 'budget',
    quality: 4.3,
    reviews: 12,
    saturday: true,
    slug: 'demo-service-giroc',
    staff: [['Liviu Toma', 'Frâne, Ambreiaj', 'Mecanic', 20]],
    tier: 0.8,
  },
  {
    address: 'Calea Lipovei 54, Timișoara',
    at: [45.777, 21.26],
    city: 'timisoara',
    kind: 'ii',
    lifts: 2,
    name: 'Atelier Calea Lipovei',
    owner: 'Emil Stoica',
    profile: 'diesel',
    quality: 4.5,
    reviews: 4,
    slug: 'demo-atelier-lipovei',
    staff: [['Bogdan Ciobanu', 'Injecție, Turbo', 'Mecanic', 10]],
    tier: 1,
  },
  {
    address: 'Strada Freidorf 9, Timișoara',
    at: [45.742, 21.185],
    city: 'timisoara',
    kind: 'pfa',
    knownFor:
      'Anvelope, echilibrare și geometrie, fără programare de dimineață.',
    lifts: 1,
    name: 'Anvelope Freidorf',
    owner: 'Raul Ardelean',
    profile: 'tyres',
    quality: 0,
    reviews: 0,
    saturday: true,
    slug: 'demo-anvelope-freidorf',
    staff: [],
    tier: 0.9,
  },
  {
    address: 'Strada Brândușei 7, Timișoara',
    at: [45.76, 21.23],
    city: 'timisoara',
    kind: 'mobile',
    knownFor: 'Vin la tine: schimb de ulei, baterii și bujii în parcare.',
    lifts: 0,
    name: 'Mecanic Mobil Timiș',
    owner: 'Cosmin Petrescu',
    profile: 'mobile',
    quality: 4.8,
    radiusKm: 25,
    reviews: 7,
    slug: 'demo-mecanic-mobil-timis',
    staff: [],
    tier: 1,
  },
  {
    address: 'Calea Torontalului 90, Timișoara',
    at: [45.772, 21.197],
    city: 'timisoara',
    courtesy: 'free',
    kind: 'company',
    lifts: 5,
    name: 'Turbo Service Complex',
    owner: 'Daniel Georgescu',
    profile: 'general',
    quality: 4.6,
    receptionist: 'Monica Iordache',
    reviews: 16,
    saturday: true,
    slug: 'demo-turbo-service-complex',
    staff: [
      ['Valentin Oprea', 'Motor, Turbo', 'Șef atelier', 22, true],
      ['Sebastian Matei', 'Suspensie, Geometrie', 'Mecanic', 5],
      ['Claudiu Radu', 'Climatizare', 'Mecanic', 3],
      ['Ovidiu Pavel', 'Diagnoză', 'Electrician auto', 12],
    ],
    tier: 1.2,
  },
  {
    address: 'Strada Iosif Nemoianu 5, Timișoara',
    at: [45.748, 21.2],
    city: 'timisoara',
    kind: 'pfa',
    lifts: 1,
    name: 'Service Iosefin',
    owner: 'Petru Lungu',
    profile: 'general',
    quality: 3.9,
    reviews: 3,
    slug: 'demo-service-iosefin',
    staff: [],
    tier: 0.95,
  },
  {
    address: 'Calea Lugojului 30, Ghiroda',
    at: [45.764, 21.295],
    city: 'timisoara',
    kind: 'ii',
    lifts: 1,
    name: 'Auto Ghiroda',
    owner: 'Gheorghe Sârbu',
    profile: 'budget',
    quality: 4,
    reviews: 2,
    slug: 'demo-auto-ghiroda',
    staff: [],
    tier: 0.85,
  },
  {
    address: 'Bulevardul Revoluției 44, Arad',
    at: [46.186, 21.315],
    city: 'arad',
    kind: 'company',
    lifts: 3,
    name: 'Service Arad Centru',
    owner: 'Lucian Crișan',
    profile: 'general',
    quality: 4.5,
    reviews: 8,
    saturday: true,
    slug: 'demo-service-arad-centru',
    staff: [['Tudor Pop', 'Motor', 'Mecanic șef', 13]],
    tier: 1,
  },
  {
    address: 'Strada Ovidiu 3, Arad',
    at: [46.18, 21.345],
    city: 'arad',
    kind: 'pfa',
    lifts: 1,
    name: 'Auto Micălaca',
    owner: 'Ilie Faur',
    profile: 'budget',
    quality: 4.2,
    reviews: 3,
    slug: 'demo-auto-micalaca',
    staff: [],
    tier: 0.85,
  },
  {
    address: 'Strada Nufărului 60, Oradea',
    at: [47.035, 21.95],
    city: 'oradea',
    courtesy: 100,
    kind: 'company',
    lifts: 3,
    name: 'Service Nufărul Oradea',
    owner: 'Zoltan Nagy',
    profile: 'premium',
    quality: 4.7,
    reviews: 6,
    slug: 'demo-service-oradea-nufarul',
    staff: [['Attila Varga', 'BMW, Audi', 'Tehnician', 15]],
    tier: 1.4,
  },
  {
    address: 'Strada Turnișorului 18, Sibiu',
    at: [45.806, 24.13],
    city: 'sibiu',
    kind: 'company',
    lifts: 2,
    name: 'Atelier Turnișor',
    owner: 'Hans Roth',
    profile: 'general',
    quality: 4.6,
    reviews: 5,
    slug: 'demo-atelier-sibiu-turnisor',
    staff: [['Mihai Fleșeriu', 'Distribuție', 'Mecanic', 9]],
    tier: 1.05,
  },
  {
    address: 'Strada Hărmanului 22, Brașov',
    at: [45.665, 25.6],
    city: 'brasov',
    kind: 'company',
    lifts: 2,
    name: 'Service Tractorul Brașov',
    owner: 'Remus Bratu',
    profile: 'diesel',
    quality: 4.4,
    reviews: 7,
    slug: 'demo-service-brasov-tractorul',
    staff: [['Sergiu Dragomir', 'Diesel', 'Mecanic', 12]],
    tier: 1,
  },
  {
    address: 'Strada Lungă 150, Brașov',
    at: [45.64, 25.615],
    city: 'brasov',
    kind: 'company',
    lifts: 1,
    name: 'EV Garage Brașov',
    owner: 'Irina Manole',
    profile: 'ev',
    quality: 5,
    reviews: 2,
    slug: 'demo-ev-garage-brasov',
    staff: [],
    tier: 1.3,
  },
  {
    address: 'Șoseaua Păcurari 88, Iași',
    at: [47.175, 27.555],
    city: 'iasi',
    kind: 'company',
    lifts: 2,
    name: 'Service Păcurari',
    owner: 'Costel Ungureanu',
    profile: 'general',
    quality: 4.5,
    reviews: 6,
    slug: 'demo-service-iasi-pacurari',
    staff: [['Răzvan Apostol', 'Motor, Frâne', 'Mecanic', 8]],
    tier: 1,
  },
  {
    address: 'Strada Sărărie 12, Iași',
    at: [47.15, 27.62],
    city: 'iasi',
    kind: 'mobile',
    lifts: 0,
    name: 'Mecanic Mobil Iași',
    owner: 'Vasile Cozma',
    profile: 'mobile',
    quality: 4.9,
    radiusKm: 15,
    reviews: 4,
    slug: 'demo-mecanic-mobil-iasi',
    staff: [],
    tier: 1,
  },
  {
    address: 'Strada Lăpușului 7, Craiova',
    at: [44.325, 23.81],
    city: 'craiova',
    kind: 'pfa',
    lifts: 2,
    name: 'Service Lăpuș Craiova',
    owner: 'Marin Dobrescu',
    profile: 'budget',
    quality: 4.1,
    reviews: 5,
    slug: 'demo-service-craiova-lapus',
    staff: [],
    tier: 0.8,
  },
];

// Where the owner works besides their own garage.
const OWNER_DESK = 'demo-service-fabric';
const OWNER_BENCH = 'demo-garaj-calea-aradului';

type Car = [
  brand: Brand,
  model: string,
  year: number,
  fuel: Fuel,
  engine: string,
  km: number,
  plate: string,
];

const DRIVERS: [name: string, city: string, cars: Car[]][] = [
  [
    'Ana Popa',
    'timisoara',
    [['dacia', 'Sandero', 2020, 'petrol', '1.0 TCe', 54000, 'TM20ANA']],
  ],
  [
    'Mihai Rădulescu',
    'timisoara',
    [['volkswagen', 'Golf', 2017, 'diesel', '2.0 TDI', 168000, 'TM17MRD']],
  ],
  [
    'Ioana Stoian',
    'timisoara',
    [['toyota', 'Corolla', 2021, 'hybrid', '1.8 Hybrid', 41000, 'TM21IOS']],
  ],
  [
    'Bogdan Herman',
    'timisoara',
    [
      ['bmw', 'X3', 2019, 'diesel', '2.0d', 112000, 'TM19BHX'],
      ['skoda', 'Fabia', 2012, 'petrol', '1.2', 189000, 'TM12BOG'],
    ],
  ],
  [
    'Diana Fodor',
    'timisoara',
    [['tesla', 'Model 3', 2022, 'electric', 'Long Range', 38000, 'TM22EVD']],
  ],
  [
    'Radu Cernea',
    'timisoara',
    [['ford', 'Focus', 2016, 'diesel', '1.5 TDCi', 201000, 'TM16RCF']],
  ],
  [
    'Elena Mureșan',
    'arad',
    [['renault', 'Clio', 2018, 'petrol', '0.9 TCe', 87000, 'AR18ELM']],
  ],
  [
    'Florin Gal',
    'arad',
    [['skoda', 'Octavia', 2019, 'diesel', '2.0 TDI', 143000, 'AR19FGO']],
  ],
  [
    'Csaba Tóth',
    'oradea',
    [['audi', 'A4', 2018, 'diesel', '2.0 TDI', 156000, 'BH18CST']],
  ],
  [
    'Andreea Bucur',
    'sibiu',
    [['dacia', 'Duster', 2021, 'petrol', '1.3 TCe', 46000, 'SB21ANB']],
  ],
  [
    'Vlad Enache',
    'brasov',
    [['volkswagen', 'Passat', 2016, 'diesel', '2.0 TDI', 234000, 'BV16VEP']],
  ],
  [
    'Simona Tudose',
    'brasov',
    [['toyota', 'RAV4', 2020, 'hybrid', '2.5 Hybrid', 72000, 'BV20SIM']],
  ],
  [
    'Cătălin Moraru',
    'iasi',
    [['dacia', 'Logan', 2015, 'diesel', '1.5 dCi', 245000, 'IS15CAM']],
  ],
  [
    'Larisa Popovici',
    'craiova',
    [['ford', 'Kuga', 2019, 'petrol', '1.5 EcoBoost', 98000, 'DJ19LAP']],
  ],
];

const OWNER_CARS: Car[] = [
  ['dacia', 'Duster', 2019, 'diesel', '1.5 dCi', 128000, 'TM12GHU'],
  ['bmw', 'Seria 3', 2016, 'diesel', '320d', 176000, 'TM07HUT'],
];

const REVIEW_TEXTS: [number, string][] = [
  [
    5,
    'Foarte serioși, au terminat înainte de ora promisă și prețul a fost cel din ofertă.',
  ],
  [
    5,
    'Mi-au explicat tot ce au schimbat și mi-au arătat piesele vechi. Recomand.',
  ],
  [5, 'Programare rapidă, atelier curat, mașina predată spălată.'],
  [4, 'Lucrare bună, dar am așteptat puțin la predare.'],
  [4, 'Preț corect. Data viitoare aș vrea să fiu sunat când e gata.'],
  [4, 'Au rezolvat problema din prima, recepția a fost amabilă.'],
  [
    3,
    'Lucrarea e bună, dar costul final a fost spre capătul de sus al ofertei.',
  ],
  [3, 'Au întârziat o zi cu piesele, în rest în regulă.'],
  [2, 'A trebuit să revin pentru același zgomot.'],
];

const REPLIES = [
  'Mulțumim! Vă așteptăm cu drag la următoarea revizie.',
  'Vă mulțumim pentru încredere și pentru recenzie.',
  'Ne pare rău pentru întârziere, am schimbat furnizorul de piese.',
];

// A fixed sequence, so every run on an empty database writes the same data.
let state = 20261030;
function random(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(list: readonly T[]): T =>
  list[Math.floor(random() * list.length)] as T;

// Whole lei, to the nearest 10.
const lei = (bani: number) => Math.round(bani / 1000) * 1000;

const slugOf = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '.')
    .replace(/^\.|\.$/g, '');

// A fiscal code with its control digit right: seven digits weighted
// 7 5 3 2 1 7 5 3 2 once padded to nine.
function cui(n: number): string {
  const body = String(1000000 + (n % 9000000)).padStart(9, '0');
  const total = [7, 5, 3, 2, 1, 7, 5, 3, 2].reduce(
    (sum, w, i) => sum + Number(body[i]) * w,
    0,
  );
  return body.replace(/^0+/, '') + String(((total * 10) % 11) % 10);
}

function hours(saturday: boolean, mobile: boolean) {
  const day = mobile ? [['09:00', '19:00']] : [['08:00', '17:00']];
  return {
    fri: day,
    mon: day,
    sat: saturday ? [['09:00', '14:00']] : [],
    sun: [],
    thu: day,
    tue: day,
    wed: day,
  };
}

interface Built {
  id: string;
  def: DemoGarage;
  ownerId: string;
  // Staff cards that take jobs, the owner's first when they have one.
  mechanics: string[];
  jobs: string[];
}

interface Driver {
  id: string;
  city: string;
  cars: { id: string; car: Car }[];
}

// A mobile mechanic is a PFA with a registered seat and no workshop
// address; a garage the other way round.
const legalPlace = (def: DemoGarage, code: string) =>
  def.kind === 'mobile'
    ? ['pfa', code, null, def.address]
    : [null, code, def.address, null];

// Whether a courtesy car costs, and its price per day in bani.
const courtesyPrice = (def: DemoGarage) =>
  typeof def.courtesy === 'number' ? [true, def.courtesy * 100] : [false, null];

// A cheaper garage quotes diagnosis "from", a premium one the clutch.
const openEnded = (job: string, tier: number) =>
  (job === 'diagnosis' && tier < 1) || (job === 'clutch-kit' && tier > 1.1);

type Profile = (typeof PROFILES)[string];
type PriceRow = (
  job: string,
  brand: string | null,
  range: [number, number | null],
  minutes: number,
  position: number,
  visible?: boolean,
) => Promise<unknown>;

interface JobOpening {
  booking: string;
  carIndex: number;
  driver: Driver;
  finalPrice: number;
  garage: Built;
  job: string;
  jobStatus: 'to_do' | 'in_work' | 'done';
  mechanic: string | null;
  minutes: number;
  slot: Date;
}

class Demo {
  readonly jobTypes = new Map<string, { id: string; name: string }>();
  readonly brands = new Map<string, { id: string; name: string }>();
  readonly built: Built[] = [];
  readonly drivers: Driver[] = [];
  owner = '';
  private seed!: {
    hash: string;
    consents: { kind: string; version: string }[];
  };

  private readonly db: Client;

  constructor(db: Client) {
    this.db = db;
  }

  async rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.db.query(sql, params)).rows as T[];
  }

  async one<T>(sql: string, params: unknown[] = []): Promise<T> {
    const [row] = await this.rows<T>(sql, params);
    if (!row) throw new Error(`no row from: ${sql.slice(0, 60)}`);
    return row;
  }

  async id(sql: string, params: unknown[] = []): Promise<string> {
    return (await this.one<{ id: string }>(sql, params)).id;
  }

  // A Bucharest wall-clock time `days` from today, moved off weekends when
  // it must land on a working day.
  async at(days: number, minutes: number, workday = false): Promise<Date> {
    for (let d = days; ; d += Math.sign(days) || 1) {
      const { t, dow } = await this.one<{ t: Date; dow: number }>(
        `SELECT t, extract(isodow FROM t AT TIME ZONE 'Europe/Bucharest')::int AS dow
         FROM (SELECT (date_trunc('day', now() AT TIME ZONE 'Europe/Bucharest')
                + $1 * interval '1 day' + $2 * interval '1 minute') AT TIME ZONE 'Europe/Bucharest' AS t) s`,
        [d, minutes],
      );
      if (!workday || dow <= 5) return t;
    }
  }

  async load() {
    const seed = await this.rows<{ password_hash: string; id: string }>(
      `SELECT i.password_hash, a.id FROM account a
       JOIN account_identity i ON i.account_id = a.id AND i.method = 'password'
       WHERE a.email = $1`,
      [SEED_ACCOUNT],
    );
    const first = seed[0];
    if (!first)
      throw new Error(`run the seed first: ${SEED_ACCOUNT} is missing`);
    this.seed = {
      consents: await this.rows(
        `SELECT kind::text, text_version AS version FROM account_consent WHERE account_id = $1`,
        [first.id],
      ),
      hash: first.password_hash,
    };
    for (const [key, ro, en, lift] of NEW_JOBS) {
      await this.db.query(
        `INSERT INTO job_type (id, key, name_ro, name_en, status, needs_lift, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'approved', $4, now())
         ON CONFLICT (key) DO NOTHING`,
        [key, ro, en, lift],
      );
    }
    for (const row of await this.rows<{
      id: string;
      key: string;
      name_ro: string;
    }>('SELECT id, key, name_ro FROM job_type')) {
      this.jobTypes.set(row.key, { id: row.id, name: row.name_ro });
    }
    for (const row of await this.rows<{
      id: string;
      key: string;
      name: string;
    }>('SELECT id, key, name FROM brand')) {
      this.brands.set(row.key, row);
    }
    const missing = Object.keys(BASE).filter((key) => !this.jobTypes.has(key));
    if (missing.length)
      throw new Error(`job types missing: ${missing.join(', ')}`);
  }

  // An account under the seed password, accepted texts and roles; its
  // creation day some months back, so the admin's lists read naturally.
  async account(
    email: string,
    name: string,
    roles: string[],
    city: string | null,
  ): Promise<string> {
    const id = await this.id(
      `INSERT INTO account (id, email, email_verified_at, name, last_role, city, created_at)
       VALUES (gen_random_uuid(), $1, now(), $2, $3::role, $4, now() - $5 * interval '1 day')
       RETURNING id`,
      [email, name, roles[0], city, 20 + Math.floor(random() * 400)],
    );
    for (const role of roles) {
      await this.db.query(
        'INSERT INTO account_role (account_id, role) VALUES ($1, $2::role)',
        [id, role],
      );
    }
    await this.db.query(
      `INSERT INTO account_identity (id, account_id, method, subject, password_hash)
       VALUES (gen_random_uuid(), $1, 'password', $2, $3)`,
      [id, email, this.seed.hash],
    );
    for (const { kind, version } of this.seed.consents) {
      await this.db.query(
        `INSERT INTO account_consent (id, account_id, kind, text_version, language, method)
         VALUES (gen_random_uuid(), $1, $2::consent_kind, $3, 'ro', 'password')`,
        [id, kind, version],
      );
    }
    return id;
  }

  async car(
    ownerId: string,
    [brand, model, year, fuel, engine, km, plate]: Car,
    n: number,
  ) {
    const id = await this.id(
      `INSERT INTO car (id, owner_id, brand_id, model, year, fuel, engine, odometer_km, plate,
                        itp_until, rca_until, idempotency_key, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::fuel, $6, $7, $8,
               current_date + $9 * interval '1 day', current_date + $10 * interval '1 day',
               $11, now() - interval '400 days')
       RETURNING id`,
      [
        ownerId,
        this.brands.get(brand)?.id,
        model,
        year,
        fuel,
        engine,
        km,
        plate,
        // Some inspections due soon, so the reminders have something to say.
        n % 3 === 0 ? 18 : 120 + n * 9,
        n % 4 === 1 ? 25 : 200 + n * 5,
        `demo-${n}`,
      ],
    );
    await this.db.query(
      `INSERT INTO car_ownership (id, car_id, account_id, access, from_date, opened_at)
       VALUES (gen_random_uuid(), $1, $2, 'owner', current_date - interval '400 days', now() - interval '400 days')`,
      [id, ownerId],
    );
    return id;
  }

  async people() {
    this.owner = await this.account(
      OWNER.email,
      OWNER.name,
      ['garage', 'driver', 'receptionist', 'mechanic', 'admin'],
      'Timișoara',
    );
    let n = 0;
    for (const [name, city, cars] of DRIVERS) {
      const id = await this.account(
        `${slugOf(name)}@${DOMAIN}`,
        name,
        ['driver'],
        CITIES[city] ?? null,
      );
      const driver: Driver = { cars: [], city, id };
      for (const car of cars)
        driver.cars.push({ car, id: await this.car(id, car, n++) });
      this.drivers.push(driver);
    }
    const mine: Driver = { cars: [], city: 'timisoara', id: this.owner };
    for (const car of OWNER_CARS)
      mine.cars.push({ car, id: await this.car(this.owner, car, n++) });
    return mine;
  }

  async garage(def: DemoGarage, n: number): Promise<Built> {
    const profile = PROFILES[def.profile];
    if (!profile) throw new Error(`no profile ${def.profile}`);
    const id = await this.listing(def, n);
    const { mechanics, ownerId } = await this.staff(def, id, n);
    await this.catalogue(def, profile, id, ownerId, n);
    const built = { def, id, jobs: profile.jobs, mechanics, ownerId };
    this.built.push(built);
    return built;
  }

  // The approved listing, its verification and its facilities.
  async listing(def: DemoGarage, n: number): Promise<string> {
    const approvedMonths = 2 + (n % 12);
    const id = await this.id(
      `INSERT INTO garage (id, name, slug, status, approved_at, last_checked_on, created_at,
         labour_from_bani, labour_to_bani, hours, lift_count, phone, known_for, brand_note,
         business_kind, mobile_legal_form, cui, address, seat_address, latitude, longitude,
         city_key, city_name, service_radius_km, payment_cash, payment_card, payment_transfer,
         courtesy_car_paid, courtesy_car_price_per_day_bani, rar_activities, profile_version)
       VALUES (gen_random_uuid(), $1, $2, 'approved',
         date_trunc('month', now()) - $3 * interval '1 month' + interval '9 days 9 hours',
         (date_trunc('month', now()) - $3 * interval '1 month' + interval '9 days')::date,
         date_trunc('month', now()) - $3 * interval '1 month',
         $4, $5, $6::jsonb, $7, $8, $9, $10, $11::business_kind, $12::mobile_legal_form, $13,
         $14, $15, $16, $17, $18, $19, $20, true, $21, $22, $23, $24,
         (SELECT coalesce(array_agg(code ORDER BY code), '{}') FROM rar_activity), 1)
       RETURNING id`,
      [
        def.name,
        def.slug,
        approvedMonths,
        lei(14000 * def.tier),
        lei(22000 * def.tier),
        JSON.stringify(hours(Boolean(def.saturday), def.kind === 'mobile')),
        def.lifts,
        `+4072${String(1000000 + n * 7919).slice(-7)}`,
        def.knownFor ?? null,
        def.brandNote ?? null,
        def.kind,
        ...legalPlace(def, cui(n * 104729 + 31337)),
        def.at[0],
        def.at[1],
        def.city,
        CITIES[def.city],
        def.radiusKm ?? null,
        def.tier >= 1,
        def.kind === 'company',
        ...courtesyPrice(def),
      ],
    );
    await this.db.query(
      `INSERT INTO verification_file (id, garage_id, status, opened_at, decided_at, decided_by, submitted_at)
       SELECT gen_random_uuid(), g.id, 'approved', g.created_at, g.approved_at, a.id, g.created_at
       FROM garage g, account a WHERE g.id = $1 AND a.email = 'admin@example.test'`,
      [id],
    );
    await this.db.query(
      `INSERT INTO verification_check (id, file_id, kind)
       SELECT gen_random_uuid(), f.id, k FROM verification_file f
       CROSS JOIN unnest(enum_range(NULL::verification_check_kind)) AS k WHERE f.garage_id = $1`,
      [id],
    );
    await this.db.query(
      `INSERT INTO garage_document_cycle (garage_id, due_on)
       SELECT id, ((approved_at AT TIME ZONE 'Europe/Bucharest')::date + interval '12 months')::date
       FROM garage WHERE id = $1`,
      [id],
    );
    const facilities = [
      ...(def.courtesy ? ['courtesy_car'] : []),
      ...(def.lifts >= 3 ? ['waiting_area'] : []),
      ...(def.profile === 'premium' ? ['pickup_dropoff'] : []),
    ];
    for (const facility of facilities) {
      await this.db.query(
        'INSERT INTO garage_facility (garage_id, facility) VALUES ($1, $2::garage_facility_kind)',
        [id, facility],
      );
    }
    return id;
  }

  // The owner: a member, and a card of their own unless it is the demo's
  // owner, whose one card is the mechanic's at another garage.
  async staff(def: DemoGarage, id: string, n: number) {
    const isMine = def.owner === OWNER.name;
    const ownerId = isMine
      ? this.owner
      : await this.account(
          `${slugOf(def.owner)}@${DOMAIN}`,
          def.owner,
          ['garage'],
          CITIES[def.city] ?? null,
        );
    await this.db.query(
      `INSERT INTO garage_member (garage_id, account_id, role) VALUES ($1, $2, 'owner')`,
      [id, ownerId],
    );
    const mechanics: string[] = [];
    if (!isMine) {
      mechanics.push(
        await this.id(
          `INSERT INTO mechanic (id, garage_id, account_id, name, is_owner, on_profile, can_move_bookings,
             can_answer_quotes, can_record_final_price, role_title, years)
           VALUES (gen_random_uuid(), $1, $2, $3, true, $4, true, true, true, 'Proprietar', $5)
           RETURNING id`,
          [id, ownerId, def.owner, def.staff.length === 0, 10 + (n % 15)],
        ),
      );
    }
    for (const [name, speciality, title, years, hasAccount] of def.staff) {
      const accountId = hasAccount
        ? await this.account(
            `${slugOf(name)}@${DOMAIN}`,
            name,
            ['mechanic'],
            CITIES[def.city] ?? null,
          )
        : null;
      mechanics.push(
        await this.id(
          `INSERT INTO mechanic (id, garage_id, account_id, name, speciality, specialties, role_title, years,
             on_profile, can_move_bookings, can_answer_quotes, can_record_final_price)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, string_to_array($4, ', '), $5, $6, true, $7, $7, true)
           RETURNING id`,
          [id, accountId, name, speciality, title, years, years >= 10],
        ),
      );
    }
    if (def.receptionist) {
      const desk = await this.account(
        `${slugOf(def.receptionist)}@${DOMAIN}`,
        def.receptionist,
        ['receptionist'],
        CITIES[def.city] ?? null,
      );
      await this.db.query(
        `INSERT INTO garage_member (garage_id, account_id, role) VALUES ($1, $2, 'receptionist')`,
        [id, desk],
      );
    }
    return { mechanics, ownerId };
  }

  // Brands and fuels, prices, and the jobs ticked for each brand taken.
  async catalogue(
    def: DemoGarage,
    profile: Profile,
    id: string,
    ownerId: string,
    n: number,
  ) {
    await this.brandsTaken(id, profile);
    const price = (
      job: string,
      brand: string | null,
      range: [number, number | null],
      minutes: number,
      position: number,
      visible = true,
    ) =>
      this.db.query(
        `INSERT INTO garage_price (id, garage_id, job_type_id, brand_id, from_bani, to_bani, duration_minutes,
           visible, position, updated_at, updated_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, now(), $9)`,
        [
          id,
          this.jobTypes.get(job)?.id,
          brand && this.brands.get(brand)?.id,
          ...range,
          minutes,
          visible,
          position,
          ownerId,
        ],
      );
    await this.prices(def, profile, n, price);
    await this.db.query(
      `INSERT INTO garage_brand_job (garage_id, brand_id, job_type_id)
       SELECT gb.garage_id, gb.brand_id, j.id FROM garage_brand gb
       JOIN job_type j ON j.key = ANY($2)
       WHERE gb.garage_id = $1 AND gb.stance = 'works_on'`,
      [id, profile.jobs],
    );
  }

  async brandsTaken(id: string, profile: Profile) {
    for (const [brand, fuels] of Object.entries(profile.brands)) {
      const takes = fuels !== 'refuses';
      const has = (fuel: Fuel) => takes && fuels.includes(fuel);
      await this.db.query(
        `INSERT INTO garage_brand (garage_id, brand_id, stance, petrol, diesel, hybrid, electric, updated_at)
         VALUES ($1, $2, $3::garage_brand_stance, $4, $5, $6, $7, now())`,
        [
          id,
          this.brands.get(brand)?.id,
          takes ? 'works_on' : 'does_not_take',
          has('petrol'),
          has('diesel'),
          has('hybrid'),
          has('electric'),
        ],
      );
    }
  }

  async prices(def: DemoGarage, profile: Profile, n: number, price: PriceRow) {
    // One garage in three keeps its pre-inspection check off the public list.
    for (const [position, job] of profile.jobs.entries()) {
      const [from, to, minutes] = BASE[job] ?? [0, 0, 0];
      const spread = 0.9 + random() * 0.2;
      await price(
        job,
        null,
        [
          lei(from * def.tier * spread),
          openEnded(job, def.tier) ? null : lei(to * def.tier * spread),
        ],
        minutes,
        position,
        !(job === 'itp-check' && n % 3 === 0),
      );
    }
    await this.brandPrices(def, profile, price);
  }

  // What a brand costs over the base price, where the garage charges more.
  async brandPrices(def: DemoGarage, profile: Profile, price: PriceRow) {
    for (const [job, brand, factor] of profile.extra ?? []) {
      if (!profile.jobs.includes(job)) continue;
      const [from, to, minutes] = BASE[job] ?? [0, 0, 0];
      await price(
        job,
        brand,
        [lei(from * def.tier * factor), lei(to * def.tier * factor)],
        Math.round(minutes * 1.2),
        profile.jobs.indexOf(job),
      );
    }
  }

  // The demo's owner works the desk at one garage and the bench at another.
  async ownerElsewhere() {
    const desk = this.garageBy(OWNER_DESK);
    const bench = this.garageBy(OWNER_BENCH);
    await this.db.query(
      `INSERT INTO garage_member (garage_id, account_id, role) VALUES ($1, $2, 'receptionist')`,
      [desk.id, this.owner],
    );
    const card = await this.id(
      `INSERT INTO mechanic (id, garage_id, account_id, name, speciality, specialties, role_title, years,
         on_profile, can_move_bookings, can_answer_quotes, can_record_final_price)
       VALUES (gen_random_uuid(), $1, $2, $3, 'Diagnoză, Injecție diesel', ARRAY['Diagnoză', 'Injecție diesel'],
               'Mecanic', 7, true, true, true, true)
       RETURNING id`,
      [bench.id, this.owner, OWNER.name],
    );
    bench.mechanics.unshift(card);
  }

  garageBy(slug: string): Built {
    const found = this.built.find((b) => b.def.slug === slug);
    if (!found) throw new Error(`no demo garage ${slug}`);
    return found;
  }

  // A request from the driver's car for one job to the garages, `hoursAgo`
  // old; returns its id and each garage's recipient row.
  async request(
    driver: Driver,
    carIndex: number,
    job: string,
    garages: Built[],
    hoursAgo: number,
    status: string,
  ) {
    const { id: carId, car } = driver.cars[carIndex] ??
      driver.cars[0] ?? { car: undefined, id: '' };
    if (!car) throw new Error('driver without a car');
    const [brand, model, year, fuel, engine] = car;
    const requestId = await this.id(
      `INSERT INTO quote_request (id, driver_id, car_id, car_brand, car_model, car_year, car_fuel, car_engine,
         description, status, created_at, expires_at, idempotency_key)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::fuel, $7, $8, $9::quote_request_status,
         now() - $10 * interval '1 hour', now() - $10 * interval '1 hour' + interval '7 days',
         'demo-' || gen_random_uuid()::text)
       RETURNING id`,
      [
        driver.id,
        carId,
        this.brands.get(brand)?.name,
        model,
        year,
        fuel,
        engine,
        pick(DESCRIPTIONS),
        status,
        hoursAgo,
      ],
    );
    const requestJob = await this.id(
      `INSERT INTO request_job (id, request_id, job_type_id, position) VALUES (gen_random_uuid(), $1, $2, 0) RETURNING id`,
      [requestId, this.jobTypes.get(job)?.id],
    );
    const recipients: string[] = [];
    for (const garage of garages) {
      recipients.push(
        await this.id(
          `INSERT INTO request_recipient (id, request_id, garage_id, status, source, created_at)
           VALUES (gen_random_uuid(), $1, $2, 'waiting', $3::request_source, now() - $4 * interval '1 hour')
           RETURNING id`,
          [
            requestId,
            garage.id,
            pick(['search', 'map', 'home', 'saved']),
            hoursAgo,
          ],
        ),
      );
    }
    return { recipients, requestId, requestJob };
  }

  // The garage's quote on its recipient row, priced from its own list.
  async quote(
    garage: Built,
    sent: { requestId: string; requestJob: string },
    recipientId: string,
    job: string,
    slot: Date,
    status: string,
  ) {
    const [from, to, minutes] = BASE[job] ?? [0, 0, 60];
    await this.db.query(
      `UPDATE request_recipient SET status = 'quoted', answered_at = now() WHERE id = $1`,
      [recipientId],
    );
    const quote = await this.id(
      `INSERT INTO quote (id, request_id, recipient_id, garage_id, from_bani, to_bani, duration_minutes, slot,
         note, status, sent_at, accepted_at, expires_at, idempotency_key)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9::quote_status, least(now(), $7::timestamptz - interval '2 days'),
         CASE WHEN $9::text = 'accepted' THEN least(now(), $7::timestamptz - interval '1 day') END,
         greatest(now(), $7::timestamptz) + interval '5 days', gen_random_uuid()::text)
       RETURNING id`,
      [
        sent.requestId,
        recipientId,
        garage.id,
        lei(from * garage.def.tier),
        lei(to * garage.def.tier),
        minutes,
        slot,
        random() < 0.5 ? 'Piesele le comandăm noi, ajung într-o zi.' : null,
        status,
      ],
    );
    await this.db.query(
      `INSERT INTO quote_job (id, quote_id, request_job_id, included) VALUES (gen_random_uuid(), $1, $2, true)`,
      [quote, sent.requestJob],
    );
    return {
      from: lei(from * garage.def.tier),
      minutes,
      quote,
      to: lei(to * garage.def.tier),
    };
  }

  // A booking on the accepted quote with its job; a confirmed one holds its
  // mechanic and lift on the calendar.
  async booking(
    garage: Built,
    driver: Driver,
    carIndex: number,
    job: string,
    slot: Date,
    status: 'awaiting_confirmation' | 'confirmed' | 'completed',
    jobStatus: 'to_do' | 'in_work' | 'done' | null,
    wanted: string | null | undefined = garage.mechanics[0],
  ) {
    const sent = await this.request(
      driver,
      carIndex,
      job,
      [garage],
      72 + Math.floor(random() * 48),
      'sent',
    );
    const { quote, minutes, from, to } = await this.quote(
      garage,
      sent,
      sent.recipients[0] ?? '',
      job,
      slot,
      'accepted',
    );
    const confirmed = status !== 'awaiting_confirmation';
    // The calendar refuses a mechanic or a lift held twice at once: take the
    // one asked for when free, else another, else none.
    const { lift, mechanic } = confirmed
      ? await this.free(garage, wanted ?? null, slot, minutes)
      : { lift: null, mechanic: null };
    const booking = await this.id(
      `INSERT INTO booking (id, quote_id, request_id, garage_id, driver_id, starts_at, duration_minutes, status,
         confirm_by, confirmed_at, confirmed_by, mechanic_id, lift, completed_at, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::timestamptz, $6::int, $7::booking_status,
         least(now(), $5::timestamptz) + interval '1 day', CASE WHEN $8::boolean THEN least(now(), $5::timestamptz - interval '1 day') END,
         CASE WHEN $8::boolean THEN $9::uuid END, CASE WHEN $8::boolean THEN $10::uuid END, $11::int,
         CASE WHEN $7::text = 'completed' THEN $5::timestamptz + $6::int * interval '1 minute' END, least(now(), $5::timestamptz - interval '1 day'))
       RETURNING id`,
      [
        quote,
        sent.requestId,
        garage.id,
        driver.id,
        slot,
        minutes,
        status,
        confirmed,
        garage.ownerId,
        mechanic,
        lift,
      ],
    );
    await this.db.query(
      `UPDATE quote_request SET status = $2::quote_request_status WHERE id = $1`,
      [
        sent.requestId,
        {
          awaiting_confirmation: 'booked',
          completed: 'done',
          confirmed: jobStatus === 'in_work' ? 'in_work' : 'booked',
        }[status],
      ],
    );
    if (confirmed) {
      await this.db.query(
        `INSERT INTO booking_segment (booking_id, garage_id, mechanic_id, lift, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz + $6::int * interval '1 minute')`,
        [booking, garage.id, mechanic, lift, slot, minutes],
      );
    }
    if (!jobStatus) return { booking, from, to };
    const finalPrice = lei(from + (to - from) * random());
    const jobId = await this.openJob({
      booking,
      carIndex,
      driver,
      finalPrice,
      garage,
      job,
      jobStatus,
      mechanic,
      minutes,
      slot,
    });
    return { booking, finalPrice, from, jobId, to };
  }

  // The booking's job, its stages so far, and when done, its repair on the
  // car's history.
  async openJob(o: JobOpening): Promise<string> {
    const { id: carId, car } = o.driver.cars[o.carIndex] ??
      o.driver.cars[0] ?? { car: undefined, id: '' };
    const odometer = car?.[5] ?? null;
    const done = o.jobStatus === 'done';
    const jobId = await this.id(
      `INSERT INTO job (id, booking_id, garage_id, car_id, driver_id, mechanic_id, status, started_at,
         finished_at, handed_over_at, received_at, final_price_bani, final_price_recorded_by, odometer_km,
         worked_seconds, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::job_status,
         CASE WHEN $6::text <> 'to_do' THEN $7::timestamptz END,
         CASE WHEN $8::boolean THEN $7::timestamptz + $9::int * interval '1 minute' END,
         CASE WHEN $8::boolean THEN $7::timestamptz + ($9::int + 30) * interval '1 minute' END,
         CASE WHEN $6::text <> 'to_do' THEN $7::timestamptz END,
         CASE WHEN $8::boolean THEN $10::int END, CASE WHEN $8::boolean THEN $11::uuid END, $12::int,
         CASE WHEN $8::boolean THEN $9::int * 60 ELSE 0 END, least(now(), $7::timestamptz - interval '1 day'))
       RETURNING id`,
      [
        o.booking,
        o.garage.id,
        carId,
        o.driver.id,
        o.mechanic,
        o.jobStatus,
        o.slot,
        done,
        o.minutes,
        o.finalPrice,
        o.garage.ownerId,
        odometer,
      ],
    );
    await this.stages(jobId, o);
    if (o.jobStatus === 'in_work') await this.steps(jobId, o);
    if (done) {
      await this.db.query(
        `INSERT INTO repair (id, car_id, job_id, source, what, garage_name, garage_id, done_on, odometer_km, cost_bani)
         VALUES (gen_random_uuid(), $1, $2, 'motorfix', $3, $4, $5, ($6::timestamptz AT TIME ZONE 'Europe/Bucharest')::date, $7, $8)`,
        [
          carId,
          jobId,
          this.jobTypes.get(o.job)?.name,
          o.garage.def.name,
          o.garage.id,
          o.slot,
          odometer,
          o.finalPrice,
        ],
      );
    }
    return jobId;
  }

  async stages(jobId: string, o: JobOpening) {
    const stages: [string | null, string][] = [[null, 'to_do']];
    if (o.jobStatus !== 'to_do') stages.push(['to_do', 'in_work']);
    if (o.jobStatus === 'done') stages.push(['in_work', 'done']);
    for (const [i, [from, to]] of stages.entries()) {
      await this.db.query(
        `INSERT INTO job_stage_entry (id, job_id, from_status, to_status, actor_id, actor_role, mechanic_id, at)
         VALUES (gen_random_uuid(), $1, $2::job_status, $3::job_status,
           coalesce((SELECT account_id FROM mechanic WHERE id = $4::uuid), $5::uuid), 'mechanic', $4,
           least(now(), $6::timestamptz + $7::int * interval '1 minute'))`,
        [
          jobId,
          from,
          to,
          o.mechanic,
          o.garage.ownerId,
          o.slot,
          i * Math.max(1, Math.round(o.minutes / 2)),
        ],
      );
    }
  }

  // A job in work: its checklist, the first step ticked.
  async steps(jobId: string, o: JobOpening) {
    const labels = [
      'Recepție și verificare',
      this.jobTypes.get(o.job)?.name ?? o.job,
      'Probă de drum',
    ];
    for (const [position, label] of labels.entries()) {
      await this.db.query(
        `INSERT INTO job_step (id, job_id, position, label, done_at, done_by)
         VALUES (gen_random_uuid(), $1, $2, $3, CASE WHEN $2::int = 0 THEN now() END,
           CASE WHEN $2::int = 0 THEN coalesce((SELECT account_id FROM mechanic WHERE id = $4::uuid), $5::uuid) END)`,
        [jobId, position, label, o.mechanic, o.garage.ownerId],
      );
    }
  }

  async free(
    garage: Built,
    wanted: string | null,
    slot: Date,
    minutes: number,
  ) {
    const busy = (column: string) =>
      this.rows<{ v: string | number }>(
        `SELECT ${column} AS v FROM booking_segment
         WHERE ${column} IS NOT NULL AND ($1::text = 'mechanic_id' OR garage_id = $2)
           AND tstzrange(starts_at, ends_at, '[)') && tstzrange($3::timestamptz, $3::timestamptz + $4::int * interval '1 minute', '[)')`,
        [column, garage.id, slot, minutes],
      ).then((rows) => new Set(rows.map((r) => String(r.v))));
    const people = await busy('mechanic_id');
    const lifts = await busy('lift');
    const candidates = [wanted, ...garage.mechanics].filter((m): m is string =>
      Boolean(m),
    );
    const mechanic = candidates.find((m) => !people.has(m)) ?? null;
    const lift =
      Array.from({ length: garage.def.lifts }, (_, i) => i + 1).find(
        (l) => !lifts.has(String(l)),
      ) ?? null;
    return { lift, mechanic };
  }

  // A finished job's review, the rating leaning to the garage's quality,
  // and now and then the owner's reply.
  async review(
    garage: Built,
    driver: Driver,
    jobId: string,
    mechanic: string | null,
    at: Date,
    paid: number,
    rating?: number,
  ) {
    const lean = garage.def.quality;
    const stars =
      rating ??
      Math.max(1, Math.min(5, Math.round(lean + (random() - 0.5) * 1.6)));
    const text = pick(
      REVIEW_TEXTS.filter(([r]) => Math.abs(r - stars) <= 1).map(([, t]) => t),
    );
    const review = await this.id(
      `INSERT INTO review (id, source, job_id, driver_id, garage_id, mechanic_id, rating, text, paid_bani, status, posted_at, created_at)
       VALUES (gen_random_uuid(), 'job', $1, $2, $3, $4, $5, $6, $7, 'published', $8::timestamptz + interval '1 day', $8::timestamptz + interval '1 day')
       RETURNING id`,
      [
        jobId,
        driver.id,
        garage.id,
        mechanic,
        stars,
        text,
        random() < 0.6 ? paid : null,
        at,
      ],
    );
    if (random() < 0.35) {
      await this.db.query(
        `INSERT INTO review_reply (id, review_id, garage_id, text, posted_at, posted_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4::timestamptz + interval '2 days', $5)`,
        [
          review,
          garage.id,
          stars <= 3 ? REPLIES[2] : pick(REPLIES.slice(0, 2)),
          at,
          garage.ownerId,
        ],
      );
    }
  }

  driversIn(city: string) {
    const local = this.drivers.filter((d) => d.city === city);
    return local.length ? local : this.drivers;
  }

  // Months of finished, reviewed work, then the days ahead.
  async history(garage: Built, n: number) {
    const drivers = this.driversIn(garage.def.city);
    for (let k = 0; k < garage.def.reviews; k++) {
      const driver = drivers[(n + k) % drivers.length] as Driver;
      const job = garage.jobs[(n * 3 + k) % garage.jobs.length] as string;
      const slot = await this.at(
        -(6 + k * 17 + (n % 9)),
        9 * 60 + 60 * (k % 6),
        true,
      );
      const mechanic =
        garage.mechanics[k % Math.max(1, garage.mechanics.length)] ?? null;
      const done = await this.booking(
        garage,
        driver,
        k % driver.cars.length,
        job,
        slot,
        'completed',
        'done',
        mechanic,
      );
      await this.review(
        garage,
        driver,
        done.jobId ?? '',
        mechanic,
        slot,
        done.finalPrice ?? 0,
      );
    }
  }

  // The days ahead: requests waiting for an answer, a quote the driver is
  // still weighing, and the calendar. The owner's garage gets the most, the
  // other Timișoara garages more than the rest.
  async ahead(garage: Built, n: number) {
    const ownGarage = garage.def.slug === 'demo-atelier-george';
    const timisoara = garage.def.city === 'timisoara';
    const busier = Number(ownGarage) + Number(timisoara);
    const drivers = this.driversIn(garage.def.city).filter(
      (d) => d.id !== this.owner,
    );
    const driver = (k: number) => drivers[(n + k) % drivers.length] as Driver;
    const job = (k: number) =>
      garage.jobs[(n + k) % garage.jobs.length] as string;
    for (let k = 0; k < 1 + busier; k++) {
      await this.request(driver(k), 0, job(k), [garage], 2 + k * 5, 'sent');
    }
    const asked = await this.request(
      driver(3),
      0,
      job(3),
      [garage],
      30,
      'quoted',
    );
    await this.quote(
      garage,
      asked,
      asked.recipients[0] ?? '',
      job(3),
      await this.at(3, 10 * 60, true),
      'waiting',
    );
    for (let k = 0; k < 1 + busier * 1.5; k++) {
      await this.booking(
        garage,
        driver(4 + k),
        0,
        job(4 + k),
        await this.at(1 + k, (8 + 2 * k) * 60 + 30, true),
        'confirmed',
        'to_do',
        garage.mechanics[k % Math.max(1, garage.mechanics.length)],
      );
    }
    if (ownGarage) {
      await this.booking(
        garage,
        driver(9),
        0,
        job(9),
        await this.at(2, 13 * 60, true),
        'awaiting_confirmation',
        null,
      );
    }
    await this.today(garage, timisoara, driver);
  }

  // In work today at each Timișoara garage with a lift, and at the garage
  // where the owner holds a mechanic's card, a job of theirs tomorrow.
  async today(
    garage: Built,
    timisoara: boolean,
    driver: (k: number) => Driver,
  ) {
    if (timisoara && garage.def.lifts > 0) {
      await this.booking(
        garage,
        driver(10),
        0,
        garage.jobs[0] as string,
        await this.at(0, 8 * 60),
        'confirmed',
        'in_work',
      );
    }
    if (garage.def.slug === OWNER_BENCH) {
      await this.booking(
        garage,
        driver(11),
        0,
        'dpf-cleaning',
        await this.at(1, 14 * 60, true),
        'confirmed',
        'to_do',
      );
    }
  }

  // The owner as a driver: two quotes to compare on the Duster's brakes and a
  // third garage still silent, the BMW booked at the German specialist, and
  // last month's service at Giroc, reviewed.
  async ownerAsDriver(mine: Driver) {
    const fabric = this.garageBy('demo-service-fabric');
    const turbo = this.garageBy('demo-turbo-service-complex');
    const iosefin = this.garageBy('demo-service-iosefin');
    const sent = await this.request(
      mine,
      0,
      'front-brakes',
      [fabric, turbo, iosefin],
      26,
      'quoted',
    );
    await this.quote(
      fabric,
      sent,
      sent.recipients[0] ?? '',
      'front-brakes',
      await this.at(2, 9 * 60, true),
      'waiting',
    );
    await this.quote(
      turbo,
      sent,
      sent.recipients[1] ?? '',
      'front-brakes',
      await this.at(3, 11 * 60, true),
      'waiting',
    );
    const premium = this.garageBy('demo-premium-dumbravita');
    await this.booking(
      premium,
      mine,
      1,
      'oil-service',
      await this.at(6, 10 * 60, true),
      'confirmed',
      'to_do',
    );
    const giroc = this.garageBy('demo-service-giroc');
    const slot = await this.at(-35, 9 * 60, true);
    const done = await this.booking(
      giroc,
      mine,
      0,
      'timing-belt',
      slot,
      'completed',
      'done',
    );
    await this.review(
      giroc,
      mine,
      done.jobId ?? '',
      giroc.mechanics[0] ?? null,
      slot,
      done.finalPrice ?? 0,
      5,
    );
    for (const garage of [
      premium,
      turbo,
      this.garageBy('demo-ev-lab-timisoara'),
    ]) {
      await this.db.query(
        'INSERT INTO saved_garage (account_id, garage_id) VALUES ($1, $2)',
        [this.owner, garage.id],
      );
    }
  }

  // Ratings and counts as the reviews would have written them.
  async figures() {
    await this.db.query(
      `UPDATE garage g SET rating = s.rating, review_count = s.n
       FROM (SELECT garage_id, round(avg(rating)::numeric, 1) AS rating, count(*)::int AS n
             FROM review WHERE status = 'published' GROUP BY garage_id) s
       WHERE g.id = s.garage_id AND g.slug LIKE 'demo-%'`,
    );
    await this.db.query(
      `UPDATE mechanic m SET rating = s.rating, review_count = s.n
       FROM (SELECT mechanic_id, round(avg(rating)::numeric, 1) AS rating, count(*)::int AS n
             FROM review WHERE status = 'published' AND mechanic_id IS NOT NULL GROUP BY mechanic_id) s
       JOIN mechanic m2 ON m2.id = s.mechanic_id JOIN garage g ON g.id = m2.garage_id AND g.slug LIKE 'demo-%'
       WHERE m.id = s.mechanic_id`,
    );
  }
}

const DESCRIPTIONS = [
  'Scârțâie la frânare, mai ales dimineața.',
  'A apărut martorul de motor după un drum lung.',
  'Vreau revizia anuală înainte de ITP.',
  'Vibrează volanul peste 100 km/h.',
  'Nu mai răcește aerul condiționat.',
  'Pornește greu pe frig.',
];

async function demo(db: Client): Promise<string> {
  const loaded = await db.query(
    `SELECT 1 FROM garage WHERE slug = 'demo-atelier-george'`,
  );
  if (loaded.rowCount) return 'demo data: already loaded';
  const taken = await db.query('SELECT 1 FROM account WHERE email = $1', [
    OWNER.email,
  ]);
  if (taken.rowCount)
    throw new Error(
      `${OWNER.email} already has an account; reset the database first`,
    );
  const run = new Demo(db);
  await run.load();
  const mine = await run.people();
  for (const [n, def] of GARAGES.entries()) await run.garage(def, n);
  await run.ownerElsewhere();
  for (const [n, garage] of run.built.entries()) await run.history(garage, n);
  for (const [n, garage] of run.built.entries()) await run.ahead(garage, n);
  await run.ownerAsDriver(mine);
  await run.figures();
  return (
    `demo data: ${run.built.length} garages in ${new Set(GARAGES.map((g) => g.city)).size} cities, ` +
    `${run.drivers.length} drivers; ${OWNER.email} holds every role`
  );
}

async function main() {
  const db = new Client({ connectionString: process.env['DATABASE_URL'] });
  await db.connect();
  try {
    await db.query('BEGIN');
    const summary = await demo(db);
    await db.query('COMMIT');
    console.log(summary);
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    'demo data failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
