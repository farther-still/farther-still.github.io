// The files under data/ that ship with the build. Each map is named here, because imports are static
// (ARCHITECTURE section 2); scripts/check-content.ts fails if a zone has no map in this list.

import balance from '../../data/balance.json';
import enemies from '../../data/enemies.json';
import items from '../../data/items.json';
import z01 from '../../data/maps/z01.json';
import z02 from '../../data/maps/z02.json';
import strings from '../../data/strings.en.json';
import zones from '../../data/zones.json';

export const BUNDLED = { balance, zones, enemies, items, maps: [z01, z02], strings } as const;
