// Hand-written synonym map, applied token-by-token after normalization.
// Keep entries lowercase and singular — de-pluralization runs first.
// This is deliberately small and curated: a huge thesaurus makes the matcher
// accept wrong answers, which is worse than rejecting a right one (the host
// can override a rejection with the number keys; they can't un-ring a bell).

export const SYNONYMS = new Map(Object.entries({
  // devices
  tv: 'television',
  telly: 'television',
  cell: 'phone',
  cellphone: 'phone',
  mobile: 'phone',
  smartphone: 'phone',
  iphone: 'phone',
  android: 'phone',
  pc: 'computer',
  laptop: 'computer',
  console: 'gameconsole',
  xbox: 'gameconsole',
  playstation: 'gameconsole',
  ps4: 'gameconsole',
  ps5: 'gameconsole',
  nintendo: 'gameconsole',
  switch: 'gameconsole',
  earbud: 'headphone',
  airpod: 'headphone',
  earphone: 'headphone',
  headset: 'headphone',

  // home
  fridge: 'refrigerator',
  freezer: 'refrigerator',
  couch: 'sofa',
  settee: 'sofa',
  restroom: 'bathroom',
  toilet: 'bathroom',
  loo: 'bathroom',
  washroom: 'bathroom',
  lavatory: 'bathroom',
  lamp: 'light',
  bin: 'trash',
  garbage: 'trash',
  rubbish: 'trash',
  laundry: 'clothe',
  washing: 'clothe',
  dish: 'plate',
  mug: 'cup',

  // people
  kid: 'child',
  children: 'child',
  mum: 'mom',
  mother: 'mom',
  mommy: 'mom',
  father: 'dad',
  daddy: 'dad',
  spouse: 'partner',
  colleague: 'coworker',
  workmate: 'coworker',

  // food
  soda: 'softdrink',
  pop: 'softdrink',
  coke: 'softdrink',
  fries: 'frenchfry',
  chips: 'frenchfry',
  icecream: 'icecream',
  yoghurt: 'yogurt',
  takeaway: 'takeout',
  spaghetti: 'pasta',
  bolognese: 'pasta',
  lasagne: 'lasagna',
  chilli: 'chili',

  // transport
  auto: 'car',
  automobile: 'car',
  vehicle: 'car',
  tyre: 'tire',
  petrol: 'gas',
  gasoline: 'gas',
  lorry: 'truck',

  // misc
  cash: 'money',
  buck: 'money',
  dollar: 'money',
  quid: 'money',
  job: 'work',
  employment: 'work',
  gym: 'exercise',
  workout: 'exercise',
  jogging: 'running',
  vacation: 'holiday',
  film: 'movie',
  sneaker: 'shoe',
  trainer: 'shoe',
  jumper: 'sweater',
  sweatshirt: 'sweater',
  specs: 'glass',
  spectacle: 'glass',
  sunglass: 'glass',
  remote: 'remotecontrol',
  clicker: 'remotecontrol',
}));

// Multi-word phrases collapsed to a single token BEFORE synonym lookup,
// so "ice cream" and "icecream" land in the same place.
export const PHRASES = [
  [/\bice cream\b/g, 'icecream'],
  [/\bsoft drink\b/g, 'softdrink'],
  [/\bfrench fry\b/g, 'frenchfry'],
  [/\bremote control\b/g, 'remotecontrol'],
  [/\bgame console\b/g, 'gameconsole'],
  [/\bvideo game\b/g, 'videogame'],
  [/\bpeanut butter\b/g, 'peanutbutter'],
  [/\bfast food\b/g, 'fastfood'],
  [/\bcell phone\b/g, 'phone'],
  [/\bmobile phone\b/g, 'phone'],
  [/\balarm clock\b/g, 'alarmclock'],
  [/\bair pod\b/g, 'headphone'],
  // "washing up" is the dishes, but "washing" on its own is laundry, and the
  // synonym map turns every "washing" into clothes. Both chore questions carry
  // Laundry AND the dishes on the same board, so without this the British
  // phrasing landed on the wrong tile.
  [/\bwashing up\b/g, 'dishes'],
];

/**
 * Words that can sit in a phrase without changing what thing is being named.
 *
 * This list is what keeps token-set containment honest. Containment says "one
 * answer's words are a subset of what was typed", which only means the same
 * thing when the leftover words are noise: "check their phone" is "check
 * phone" plus a possessive. It is NOT the same thing when a leftover word
 * carries meaning — "measuring tape" is not "tape", "hot dog" is not "dog",
 * "ice bath" is not "bath". So anything absent from this list blocks the match
 * and leaves the decision to the fuzzy pass.
 *
 * Err towards leaving a word OUT. A word wrongly listed here accepts wrong
 * answers; a word wrongly missing only sends a near miss to the fuzzy pass.
 */
export const WEAK_WORDS = new Set([
  // articles, determiners, possessives — these survive mid-phrase, where the
  // leading-filler strip in normalize() cannot reach them
  'a', 'an', 'the', 'my', 'your', 'his', 'her', 'their', 'our', 'its',
  'some', 'any', 'other', 'another', 'own', 'same', 'that', 'this', 'these', 'those',
  // adjectives that describe the thing without naming a different one:
  // "old batteries" is the Batteries answer
  'old', 'new', 'dead', 'spare', 'extra', 'broken',
  // vague subjects and objects
  'people', 'person', 'someone', 'somebody', 'something', 'anything', 'everything',
  'everyone', 'everybody', 'thing', 'stuff', 'one', 'it', 'them', 'they', 'you',
  // first- and third-person subjects: "I check my phone", "we overslept",
  // "he lost his keys" name the same thing as the bare answer
  'i', 'im', 'ive', 'id', 'ill', 'we', 'he', 'she', 'me', 'us', 'myself', 'themselves',
  'yourself', 'themself',
  'guy', 'lot', 'bit', 'kind', 'sort', 'type', 'pair',
  // light verbs and auxiliaries that pad a phrase rather than name an action
  'be', 'being', 'is', 'am', 'are', 'was', 'were', 'do', 'doing', 'doe', 'did',
  'have', 'having', 'ha', 'had', 'get', 'getting', 'go', 'going', 'gone',
  'make', 'making', 'take', 'taking', 'let', 'letting', 'try', 'trying',
  'want', 'wanting', 'need', 'needing', 'can', 'will', 'would', 'should',
  // prepositions and conjunctions
  'of', 'to', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'about',
  'into', 'onto', 'over', 'under', 'out', 'up', 'off', 'down', 'away', 'back',
  'and', 'or', 'but', 'so', 'than', 'then', 'when', 'while', 'as', 'if',
  // intensifiers and vague quantity
  'very', 'really', 'just', 'too', 'quite', 'pretty', 'much', 'many', 'more',
  'most', 'less', 'least', 'all', 'always', 'never', 'often', 'usually',
  'already', 'still', 'again', 'even', 'also',
]);
