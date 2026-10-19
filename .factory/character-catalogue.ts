import type { Feel } from './lookfeel-catalogue';

/**
 * The twelve brand archetypes a project can start its character from. An archetype is a starting shape, not a
 * personality: the project still decides its own traits, values and behaviour at key moments. Each entry says how a
 * product with that character acts toward a person, how it speaks, what it promises, and what to take care over.
 */
export interface Archetype {
  name: string;
  /** Lower-case spellings that also mean this archetype. */
  aliases: string[];
  essence: string;
  /** How the product behaves toward the person. */
  acts: string;
  speaks: string;
  /** What it promises the person. */
  promise: string;
  feel: Feel[];
  /** When it goes wrong, or what to take care over. */
  care: string;
}

const key = (n: string): string => n.toLowerCase().replace(/[^a-z0-9]+/g, '');

const a = (
  name: string, feel: Feel[], essence: string, acts: string, speaks: string, promise: string, care: string, aliases: string[] = []
): Archetype => ({ name, aliases, essence, acts, speaks, promise, feel, care });

export const ARCHETYPES: Archetype[] = [
  a('Innocent', ['warm', 'calm', 'trustworthy'],
    'Simple, honest and hopeful.',
    'Takes the plain path, hides nothing, keeps every step easy.',
    'Short, kind, free of jargon; never sarcastic.',
    'Doing this will be easy and safe.',
    'Over-simplifying hides risks; can read as childish. Say the hard thing plainly when it matters.', ['optimist', 'pure']),
  a('Sage', ['precise', 'trustworthy', 'calm'],
    'Knows, explains and helps people understand.',
    'Shows its reasoning and its sources, gives the evidence before the advice.',
    'Clear, measured and exact; defines terms; admits what it does not know.',
    'You will understand what is happening and why.',
    'Lecturing, or too much explanation for a task done in seconds.', ['expert', 'scholar']),
  a('Explorer', ['energetic', 'bold', 'natural'],
    'Freedom, discovery and finding your own way.',
    'Opens doors rather than walking people through them; rewards curiosity.',
    'Curious and brisk; asks what you want to find, not what you must do.',
    'You can go further than you thought.',
    'People get lost; keep the basics findable and the way back obvious.', ['adventurer']),
  a('Outlaw', ['raw', 'bold', 'energetic'],
    'Breaks the rules that no longer serve people.',
    'Challenges the way things are done, says what others will not, skips ceremony.',
    'Direct, irreverent, unpolished on purpose.',
    'You do not have to do it the old way.',
    'Alienates cautious users; never apply it to safety, money or privacy moments.', ['rebel']),
  a('Magician', ['futuristic', 'luxurious', 'bold'],
    'Turns a wish into a result as if by transformation.',
    'Does the heavy part out of sight and presents the outcome.',
    'Confident and a little theatrical; speaks in outcomes.',
    'What you imagine can happen.',
    'Hiding how it works costs trust when something goes wrong; show what it did.', ['wizard', 'visionary']),
  a('Hero', ['bold', 'energetic', 'precise'],
    'Mastery, courage and finishing the hard thing.',
    'Sets clear challenges, measures progress, backs the person up when it is hard.',
    'Firm, encouraging, action first.',
    'You can do this, and we will help you do it well.',
    'Turns pressure into shame when someone fails; failure moments must stay kind.', ['warrior', 'champion']),
  a('Lover', ['warm', 'luxurious', 'handmade'],
    'Closeness, appreciation and the pleasure of the senses.',
    'Pays attention to the person, remembers what they like, takes care over detail.',
    'Warm, personal and sensory.',
    'You are seen and appreciated.',
    'Over-familiarity and privacy: personal touches need clear consent.', ['romantic']),
  a('Jester', ['playful', 'energetic', 'warm'],
    'Joy, humour and not taking it all too seriously.',
    'Lightens routine, rewards play, makes small moments enjoyable.',
    'Witty and light; humour that includes and never mocks.',
    'You will enjoy this.',
    'Humour in failure, loss or money moments hurts; it also wears thin and is hard to translate.', ['fool', 'joker', 'entertainer']),
  a('Everyman', ['warm', 'communal', 'trustworthy'],
    'Belonging, practical and one of us.',
    'Speaks and acts like a neighbour: no airs, fair prices, no fuss.',
    'Down to earth, friendly, plain words, a little humour.',
    'You belong here and you will be treated fairly.',
    'Bland by default; give it specifics so it is a character and not an absence.', ['regular guy', 'regular person', 'everyperson']),
  a('Caregiver', ['warm', 'calm', 'communal', 'trustworthy'],
    'Protects, nurtures and looks after people.',
    'Anticipates trouble, offers help before it is asked for, makes recovery easy.',
    'Gentle, reassuring, patient; says what it has done for you.',
    'We will look after you.',
    'Smothers or talks down to capable people; keep control with the person and options visible.', ['carer', 'nurturer', 'helper']),
  a('Ruler', ['luxurious', 'precise', 'heritage', 'trustworthy'],
    'Order, control and standing for quality.',
    'Sets standards, brings structure, keeps things under control.',
    'Composed, formal, authoritative; chooses words with care.',
    'Everything will be in order, and you will be in control.',
    'Cold and bureaucratic; authority without warmth feels like being managed.', ['sovereign', 'leader', 'authority']),
  a('Creator', ['handmade', 'playful', 'natural'],
    'Imagination, craft and making something that did not exist.',
    'Gives people tools and room to make things, values the work in progress.',
    'Inspiring and specific; talks about making, not just results.',
    'You can make something of your own.',
    'Too many options freeze people; give a good starting point and a clear finish.', ['maker', 'artist', 'innovator'])
];

/** An archetype by name or alias, ignoring case, spaces and hyphens. */
export function findArchetype(name: string): Archetype | undefined {
  const k = key(name);
  if (!k) return undefined;
  return ARCHETYPES.find(x => key(x.name) === k || x.aliases.some(al => key(al) === k));
}

/** Archetypes that share the most feelings with the ones asked for, best first. Ties keep list order. */
export function shortlistArchetypes(feel: Feel[], count = 4): Array<{ archetype: Archetype; matched: Feel[] }> {
  const wanted = new Set(feel);
  return ARCHETYPES
    .map((archetype, index) => ({ archetype, index, matched: archetype.feel.filter(f => wanted.has(f)) }))
    .filter(r => r.matched.length > 0)
    .sort((x, y) => y.matched.length - x.matched.length || x.index - y.index)
    .slice(0, count)
    .map(({ archetype, matched }) => ({ archetype, matched }));
}
