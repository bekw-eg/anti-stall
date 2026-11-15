/**
 * Образ аксолотля игрока: цвет спрайта и по одному аксессуару на слот (голова, лицо, шея).
 * Хранится в users.avatar как JSON. Пока игрок ничего не выбрал, цвет считается из id (стабильно и разнообразно),
 * аксессуаров нет. Новый образ проверяется по каталогу и уровню игрока — подменить закрытую вещь нельзя.
 */
import { AVATAR } from './catalog.js';
import { E } from './errors.js';

const FREE_SKINS = AVATAR.skins.filter((s) => s.minLevel <= 1).map((s) => s.id);
const SKIN = new Map(AVATAR.skins.map((s) => [s.id, s]));
const ITEM = new Map(AVATAR.items.map((i) => [i.id, i]));

function defaultSkin(userId) {
  let h = 0;
  for (const ch of String(userId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FREE_SKINS[h % FREE_SKINS.length];
}

/** Образ для ответа API: всегда полный объект {skin, head, face, neck}. Битый или устаревший JSON — по умолчанию. */
export function avatarOf(row) {
  const base = { skin: defaultSkin(row.id ?? row.user_id), head: null, face: null, neck: null };
  if (!row.avatar) return base;
  try {
    const a = JSON.parse(row.avatar);
    const out = { ...base };
    if (SKIN.has(a.skin)) out.skin = a.skin;
    for (const slot of AVATAR.slots) if (ITEM.get(a[slot])?.slot === slot) out[slot] = a[slot];
    return out;
  } catch {
    return base;
  }
}

/** Открыта ли вещь: по уровню и, если у вещи есть условие unlock, по статистике игрока (например, победы в Harvest). */
const isOpen = (x, level, stats) => x.minLevel <= level && (!x.unlock || (stats?.[x.unlock.stat] ?? 0) >= x.unlock.count);

/** Что игроку уже доступно — для страницы образа (клиент только показывает, проверяет сервер). */
export function unlockedOf(level, stats) {
  return { skins: AVATAR.skins.filter((s) => isOpen(s, level, stats)).map((s) => s.id), items: AVATAR.items.filter((i) => isOpen(i, level, stats)).map((i) => i.id) };
}

/** Проверка нового образа: неизвестный цвет/вещь — 400, вещь не своего слота — 400, закрытая уровнем или игрой — 409. */
export function parseAvatar(value, level, stats = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw E.badRequest('INVALID_FIELD', 'avatar: объект {skin, head, face, neck}', { field: 'avatar' });
  const skin = SKIN.get(value.skin);
  if (!skin) throw E.badRequest('INVALID_FIELD', `avatar.skin: ${AVATAR.skins.map((s) => s.id).join(' | ')}`, { field: 'avatar.skin' });
  if (skin.minLevel > level) throw E.conflict('AVATAR_LOCKED', `«${skin.title}» откроется на ${skin.minLevel} уровне`, { item: skin.id, minLevel: skin.minLevel });
  const out = { skin: skin.id, head: null, face: null, neck: null };
  for (const slot of AVATAR.slots) {
    const id = value[slot];
    if (id === undefined || id === null) continue;
    const item = ITEM.get(id);
    if (!item || item.slot !== slot) throw E.badRequest('INVALID_FIELD', `avatar.${slot}: неизвестная вещь`, { field: `avatar.${slot}` });
    if (item.minLevel > level) throw E.conflict('AVATAR_LOCKED', `«${item.title}» откроется на ${item.minLevel} уровне`, { item: item.id, minLevel: item.minLevel });
    if (!isOpen(item, level, stats)) throw E.conflict('AVATAR_LOCKED', `«${item.title}»: ${item.unlock.label}`, { item: item.id, unlock: item.unlock });
    out[slot] = item.id;
  }
  return out;
}
