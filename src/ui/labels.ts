// System labels (GDD section 0): every word the app shows that is not content. Content names come from the
// strings file, through GameText. Nothing here is the reference game's text.

import type { Balance, HintId, ItemDef, ItemKind, LineKey, RejectReason, SlotId, StatKey, Tag } from '../engine';
import { TAGS } from '../engine';
import type { GameText } from '../content';
import { EXPORT_REMINDER_DAYS, EXPORT_REMINDER_RUNS } from '../save';
import { formatNumber } from './format';

export const STAT_NAME: Record<StatKey, string> = { life: 'Life', damage: 'Damage', defense: 'Defense', dexterity: 'Dexterity', luck: 'Luck' };

const percentOf = (share: number): string => `${Math.round(share * 100)}%`;

/** The one-line explanation behind every stat (GDD 8.4, D-19). The numbers in them are read from the balance table. */
export const statHelp = (balance: Balance): Record<StatKey, string> => ({
  life: `How much damage you can take. It is full at the start of every fight. Each point adds ${balance.hero.perPoint.life}.`,
  damage: 'The size of each of your hits, before the enemy’s Defense takes its share.',
  defense: 'Removes a share of every hit you take: your Defense against the enemy’s Damage.',
  dexterity: `Raises Accuracy and Evasion from the first point. Past ${balance.hero.dexterityPivot} it also raises crit chance and crit damage.`,
  luck: `Does nothing until it passes ${balance.hero.luckPivot}. Past that it raises gold and drop chances. Luck far above an enemy’s level also multiplies its drops.`,
});

export const derivedHelp = (balance: Balance): Record<string, string> => ({
  accuracy: `Your chance to hit. Equal to an enemy’s level plus ${balance.battle.ratingBase}, it hits ${percentOf(1 - balance.battle.missFactor)} of the time; lower misses much more.`,
  evasion: `Your chance to dodge. Equal to an enemy’s level plus ${balance.battle.ratingBase}, it dodges ${percentOf(balance.battle.dodgeBase)} of hits; the most it can reach is ${percentOf(balance.battle.dodgeCap)}.`,
  crit: 'A crit multiplies that hit by your crit damage.',
  extraHit: 'A chance for an attack to land twice.',
  extraAttack: 'A chance to attack twice in a turn.',
  extraTurn: 'A chance to take a second turn before the enemy acts.',
  reflect: 'Each hit you take sends this share of the enemy’s Damage back at it, whatever your own Damage is.',
  lifeRegen: 'Heals this share of your Life at the start of each of your turns after the first.',
  lastStand: 'Survive this many killing blows per fight, at 1 Life. Only the highest value worn counts.',
  growth: 'Extra stat points for every level gained while it is worn. Points already earned stay for the run. Only the highest value worn counts.',
  energy: 'Fights you can win this run. Energy gear counts only while it is worn.',
});

export const SLOT_NAME: Record<SlotId, string> = {
  weapon: 'Weapon',
  head: 'Head',
  neck: 'Neck',
  shoulders: 'Shoulders',
  body: 'Body',
  back: 'Back',
  arms: 'Arms',
  hands: 'Hands',
  finger: 'Finger',
  waist: 'Waist',
  legs: 'Legs',
  feet: 'Feet',
  offhand: 'Off hand',
  acc1: 'Accessory 1',
  acc2: 'Accessory 2',
  acc3: 'Accessory 3',
  acc4: 'Accessory 4',
  acc5: 'Accessory 5',
};

export const KIND_NAME: Record<ItemKind, string> = {
  weapon: 'Weapon',
  head: 'Head',
  neck: 'Neck',
  shoulders: 'Shoulders',
  body: 'Body',
  back: 'Back',
  arms: 'Arms',
  hands: 'Hands',
  finger: 'Finger',
  waist: 'Waist',
  legs: 'Legs',
  feet: 'Feet',
  offhand: 'Off hand',
  accessory: 'Accessory',
  key: 'Key',
};

const signed = (value: number, unit = ''): string => `${value >= 0 ? '+' : '−'}${formatNumber(Math.abs(value))}${unit}`;

const LINE_TEXT: Record<LineKey, (value: number) => string> = {
  lifeFlat: (v) => `${signed(v)} Life`,
  damageFlat: (v) => `${signed(v)} Damage`,
  defenseFlat: (v) => `${signed(v)} Defense`,
  dexterityFlat: (v) => `${signed(v)} Dexterity`,
  luckFlat: (v) => `${signed(v)} Luck`,
  lifePct: (v) => `${signed(v, '%')} Life`,
  damagePct: (v) => `${signed(v, '%')} Damage`,
  defensePct: (v) => `${signed(v, '%')} Defense`,
  dexterityPct: (v) => `${signed(v, '%')} Dexterity`,
  luckPct: (v) => `${signed(v, '%')} Luck`,
  accuracyPct: (v) => `${signed(v, '%')} Accuracy`,
  evasionPct: (v) => `${signed(v, '%')} Evasion`,
  critChance: (v) => `${signed(v, '%')} crit chance`,
  critDamage: (v) => `${signed(v, '%')} crit damage`,
  xpBonus: (v) => `${signed(v, '%')} XP`,
  goldBonus: (v) => `${signed(v, '%')} gold`,
  dropBonus: (v) => `${signed(v, '%')} drop chance`,
  lifeRegen: (v) => `Regen ${formatNumber(v)}% of Life a turn`,
  extraHit: (v) => `${formatNumber(v)}% Extra Hit`,
  extraAttack: (v) => `${formatNumber(v)}% Extra Attack`,
  extraTurn: (v) => `${formatNumber(v)}% Extra Turn`,
  reflect: (v) => `Reflect ${formatNumber(v)}%`,
  lastStand: (v) => `Last Stand ${formatNumber(v)}`,
  growth: (v) => `Growth: ${signed(v)} stat point${v === 1 ? '' : 's'} per level`,
  moveSpeed: (v) => `${signed(v, '%')} move speed`,
  energy: (v) => `${signed(v)} Energy while worn`,
};

/** An item's lines as plain words, in a fixed order. */
export const itemLines = (item: ItemDef, text: GameText, cutPercent: number): string[] => {
  const out: string[] = [];
  for (const key of Object.keys(LINE_TEXT) as LineKey[]) {
    const value = item.lines[key];
    if (value !== undefined && value !== 0) out.push(LINE_TEXT[key](value));
  }
  for (const tag of TAGS) {
    const versus = item.versus[tag];
    if (versus !== undefined && versus !== 0) out.push(`${signed(versus, '%')} damage to ${text.tag(tag)}`);
    const resist = item.resist[tag];
    if (resist !== undefined && resist !== 0) out.push(`${signed(resist)} Resistance to ${text.tag(tag)}`);
  }
  if (item.claim) out.push(`Claim: cuts your Damage by ${cutPercent}%. A boss that falls to it is claimed`);
  if (item.kind === 'key') out.push('A key. It is kept, and its door stays open');
  return out;
};

export const tagList = (tags: readonly Tag[], text: GameText): string => (tags.length === 0 ? 'None' : tags.map((tag) => text.tag(tag)).join(', '));

export const REJECTIONS: Record<RejectReason, string> = {
  'bad-seed': 'That run could not be started.',
  blocked: 'Something is in the way.',
  'unknown-spawn': 'That enemy is not there.',
  'not-adjacent': 'Walk up to it first.',
  'boss-beaten': 'Already beaten this run.',
  'no-energy': 'Not enough energy.',
  'bad-points': 'You do not have that many points to spend.',
  'bad-loadout': 'That loadout does not exist.',
  'wrong-slot': 'That item does not go in that slot.',
  'unknown-item': 'That item does not exist in this version.',
  'not-owned': 'You do not own a free copy of that item.',
  'not-for-sale': 'That item is not sold.',
  'cap-reached': 'You already own as many as you can.',
  'no-gold': 'Not enough gold.',
  'no-gems': 'Not enough gems.',
  'loadouts-full': 'There are no more loadouts to buy.',
  'bad-name': 'That name is too long.',
  'salvage-used': 'Salvage has been used this run.',
  'empty-pool': 'There is nothing to salvage yet.',
  'unknown-secret': 'There is nothing there.',
  'already-collected': 'Already collected this run.',
  'unknown-hint': '',
  'unknown-action': 'That cannot be done in this version.',
  'count-limit': 'That number cannot go any higher.',
};

/**
 * The export reminder's sentence. Either the days or the runs alone bring the reminder up, and it names only the
 * one that is overdue, or both: a count still within its limit would read as a reason when it is not one.
 */
export const exportReminderWords = (daysSinceExport: number, runsSinceExport: number): string => {
  const overdue = [
    ...(daysSinceExport >= EXPORT_REMINDER_DAYS ? [`${formatNumber(daysSinceExport)} days`] : []),
    ...(runsSinceExport >= EXPORT_REMINDER_RUNS ? [`${formatNumber(runsSinceExport)} runs`] : []),
  ];
  return `${overdue.length === 0 ? '' : `No export for ${overdue.join(' and ')}. `}The only copy of this save is on this phone.`;
};

/** The line a screen shows the first time it opens (GDD 8.4). There is no tutorial sequence. */
export const hints = (balance: Balance): Record<HintId, string> => ({
  map: 'Tap a tile to walk there, or press and drag to steer. Tap an enemy to walk up to it. Nothing attacks you: you choose every fight.',
  prefight: 'A win costs energy. A loss costs nothing, so you can back out or try again freely.',
  hero: 'Each level gives stat points. Spending them cannot be undone until the next run, when level and points start over.',
  gear: 'Gear is kept between runs. A loadout is a whole outfit you can switch to in one tap; a slot is one place in it.',
  items: 'Everything in the shop is listed with its price from the start. Gold is lost at the end of a run, so spend it.',
  bestiary: 'An enemy appears here once you have fought it. Each one shows how many drops it still holds.',
  salvage: 'Salvage takes all your gold for one chance at a drop you have missed. Once per run. The chance and the pool are shown before you pay.',
  run: 'When energy runs out, spend what is left and start the next run. Level and gold start over. Gear and permanent energy stay.',
  tool: `This is the tool for permanent energy. It cuts your Damage by ${balance.claim.damageCutPct}%. Beat a boss with it equipped and that boss is claimed: +${balance.energy.perClaim} starting energy for good. Come back for a boss once you have outgrown it.`,
});
