// Bella's spoken lines. Single source of truth: the game reads this for
// subtitles and Web Speech, and tools/render-voice.mjs renders the same text
// to audio/host/*.mp3 so the keys line up with data/voice-manifest.json.
//
// Several takes per bucket so a long match doesn't sound like a soundboard.
// {name} is substituted at runtime and is deliberately kept OUT of the
// rendered audio — the clip stops before the name, which is why the lines
// below read naturally without it.

export const HOST_LINES = {
  showOpen: [
    'Welcome to BellaFox Feud!',
    "It's time to play the Feud!",
  ],
  faceoff: [
    'Here comes the question.',
    'Hands ready.',
    'Top answer wins control.',
  ],
  goodAnswer: [
    'Good answer!',
    'Show me that one!',
    'Yes!',
    "That's up there!",
    'Nice one.',
    'There it is!',
  ],
  topAnswer: [
    'Number one answer!',
    'Top of the board!',
    "That's the big one!",
  ],
  strike: [
    'Oh, no.',
    'Not up there.',
    'Strike.',
    "Sorry, that's not it.",
    'Nope.',
    'Afraid not.',
  ],
  threeStrikes: [
    "That's three strikes. Let's go to the steal.",
    'Three strikes! The board is open for a steal.',
  ],
  stealWin: [
    'Stolen! That is the game right there.',
    'They took it!',
  ],
  stealFail: [
    'Nope. The board stays.',
    "Not this time, the points stay put.",
  ],
  bank: [
    'Points on the board.',
    'Those points are banked.',
    'Onto the scoreboard they go.',
  ],
  boardCleared: [
    'The whole board! Outstanding!',
    'They swept it!',
  ],
  roundOpen: [
    'Next round.',
    'Here we go again.',
  ],
  fmIntro: [
    "It's time for Fast Money!",
    'Fast Money. Five questions, the clock is running.',
  ],
  fmLookaway: [
    'Look away, please.',
    'Eyes off the screen.',
  ],
  fmGo: [
    'Clock starts now.',
    "Here's your first question.",
  ],
  fmTimeUp: [
    "Time's up!",
    "That's time.",
  ],
  fmDuplicate: [
    'We have a duplicate answer. One more question.',
    "That one's already been said. Here's a replacement.",
  ],
  fmWin: [
    'They did it! Big winners!',
    'Over the top! What a finish!',
  ],
  fmLose: [
    'So close. Not quite there.',
    "They came up short, but what a run.",
  ],
  winner: [
    'And that is your winner!',
    'What a match!',
  ],
};

/** Pick a random take. Returns { key, text } for speak(). */
export function hostLine(bucket) {
  const lines = HOST_LINES[bucket];
  if (!lines?.length) return { key: null, text: '' };
  return { key: `host:${bucket}`, text: lines[Math.floor(Math.random() * lines.length)] };
}
