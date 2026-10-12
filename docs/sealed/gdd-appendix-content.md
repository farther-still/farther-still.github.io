# SEALED: GDD appendix S, world and names

**Spoilers. Michael does not open this file** (decisions Q12 and G2 in `docs/GDD.md`). Written 2026-10-12 for the Phase 1 gate.

This appendix gives the themes and names behind the placeholders in `docs/GDD.md`. Every name here is a display name and can change; content IDs never carry them (decision D-07). Everything is original to Steadfast.

## S1. Premise

A mountain with a pilgrim stair cut into it, from a toll gate at the mountain's foot to an observatory at the summit. Nobody has finished the climb in living memory. The hero sets out from the gate each morning and gets as far as strength allows before turning back, which is the run. What the hero carries home is kept; what the hero learned on the way up fades overnight, which is why level resets.

The tone is dry and a little wry, not grim. Enemies are the stair's residents and hazards more than villains.

How the systems read in this world:

| System | In the world |
|---|---|
| Energy | The hero's wind for the day |
| Permanent-energy tool | The **Notched Walking Stick**. The toll keeper hands it over on losing: "you'll want this more than a sword". Finishing a guardian with nothing but a walking stick proves you have its measure, and you cut a notch |
| Claim | A notch on the stick |
| Salvage | **The Ragpicker**, who combs the lower stair for what climbers dropped and will look for something of yours if you empty your purse |
| Waypoints | **Bell shrines**. Ring one you have paid to restore and you are standing at it |
| Gems | Offerings left at shrines, which is why restoring a shrine costs them |
| Keys | A winch handle and a gate token |
| Marked enemies | A resident carrying a bundle |
| Sealed door | The observatory's roof hatch |

## S2. Tags

| Placeholder | Name | Reads as |
|---|---|---|
| E1 | Frost | Cold of the high stair |
| E2 | Storm | Wind and lightning at the top of the stair |
| E3 | Blight | Bites, stings and rot of the gorge and the cloud wood |
| T1 | Wild | Animals |
| T2 | Sworn | People with a post to keep: toll keepers and stewards |
| T3 | Graven | Carved things that move |
| T4 | Hollow | Things made of weather: steam, mist, echoes |

## S3. Zones

Tags and boss counts match GDD section 7.5. Only gate bosses and bosses with a structural job are named here; the rest are authored with their zones.

| Zone | Name | Theme | Families (tags, role) | Bosses and gates |
|---|---|---|---|---|
| Z1 | Lowgate Terraces | Farm terraces and the toll gate at the mountain's foot | Terrace geese (Wild, standard); terrace hares (Wild, glass); gate hands (Sworn, bruiser) | 1 boss. Gate boss: the Toll Keeper (Sworn), who hands over the Notched Walking Stick |
| Z2 | Teahouse Switchbacks | Abandoned tea terraces and a shuttered teahouse on a zigzag path | Tea-snatcher macaques (Wild, flurry); kettle wisps (Hollow, glass) | 2 bosses. Gate boss: the Proprietress (Hollow). The other is the hidden optional boss in S4 |
| Z3 | Ropewalk Gorge | Rope bridges across a deep cut in the mountain | Bridge adders (Blight Wild, glass); gorge kites (Wild, flurry); bridge weavers (Wild, mender) | 2 bosses. First: the Great Kite (Wild), which can drop the winch handle. Gate boss: the Winchmaster's Hound (Blight Wild). Optional key door: the lower winch house, opened by the winch handle |
| Z4 | Cloudmoss Wood | A wet, quiet wood inside the cloud layer | Moss creepers (Blight Wild, bruiser); pollen drifts (Blight Hollow, mender); mist prowlers (Hollow, glass) | 2 bosses. Gate boss: the Mossback (Blight Wild) |
| Z5 | The Graven Cloister | A monastery whose statues kept working after the monks left | Cloister stewards (Sworn, armored); courtyard figures (Graven, bruiser); gutter grotesques (Graven, flurry) | 2 bosses. First: the Bell Steward (Sworn), who hands over the gate token. Required key door: the refectory gate, opened by the gate token. Gate boss: the Abbot in Stone (Graven) |
| Z6 | Icefall Stair | The stair turns to ice beside a waterfall that no longer moves | Rime foxes (Frost Wild, flurry); eave icicles (Frost Hollow, glass); shellback tortoises (Frost Wild, armored) | 3 bosses. Gate boss: the Glacier's Tooth (Frost Hollow) |
| Z7 | Thunderhead Tor | A ring of standing stones inside a permanent storm | Gust shapes (Storm Hollow, flurry); lightning rods (Storm Graven, armored); thunder echoes (Storm Hollow, mender) | 3 bosses. Gate boss: the Anvil Cloud (Storm Hollow) |
| Z8 | The Last Observatory | Brass instruments, cold lenses and whatever still watches the sky | Lens keepers (Graven, armored); draught shapes (Hollow, glass); roof ravens (Wild, flurry). Each family comes in Frost, Storm and Blight variants | 3 bosses. Final boss: the Astronomer (Storm Graven). Beyond it: the roof hatch, sealed |

## S4. Secrets and keys in v1

v1 has four optional secrets: two hidden stashes, one shortcut and one hidden optional boss. The boss is one of Z2's two bosses, so it is already counted in the GDD's zone table.

- Hidden stash 1: behind the drying racks in Lowgate Terraces. Meant to be found early, to teach that walls can be false.
- Hidden stash 2: under the third rope bridge in Ropewalk Gorge.
- Shortcut: a herder's track inside Cloudmoss Wood, from the bell shrine straight to the Mossback's clearing, cutting out the long loop. It bypasses no gate.
- Hidden optional boss: the Teahouse Cat (Wild), asleep in the teahouse cellar behind a hidden tile. It sits at the top of Z2's level band with the highest modifiers the GDD allows, which makes it the strongest thing in its zone and the first "come back later" target. It needs no rule beyond GDD section 5.4.

v1 has two keys, matching GDD section 7.2:

- The winch handle opens the optional door in Z3. It is an ordinary drop from Z3's first boss, and the door says its key is in Z3.
- The gate token opens the required door in Z5. It is a guaranteed handover from Z5's first boss, and the door says its key is in Z5.

## S5. Naming rules for content authors

- Items are named for what they are and where they are from: a material or owner, then the object. Plain and concrete, for example "Picker's Wicker Shield" or "Rimefox Stole".
- Shop tiers are named by material, rising: reed, oak, slate, brass. No "+1" suffixes and no tier adjectives such as "greater".
- Energy accessories are pace beads, counted on the climb to steady the breath.
- Stat-points-per-level accessories are pilgrim badges, one from each shrine order.
- Bosses have a title, not a personal name.
- No name may match a name in the reference game, and no item category may borrow the reference game's theme for that category. The automated check in GDD section 7.9 enforces the first against a private list; the second is for the verifier pass.
