/**
 * Отрисовка поля Harvest на canvas (перенос рендера из prototypes/harvest): фон-грядки, корзины с аксолотлями,
 * помидоры, всплывающие очки, кляксы на земле, лёд замороженных корзин и «клякса на экране».
 * Рендер ничего не решает: он рисует то, что ему передали (дождь из зерна + кадр сервера + локальная корзина).
 */
import type { AvatarLook } from "@/api/tomato";
import { ITEM_ART, SKIN_SRC } from "./Axolotl";
import { HV, KINDS, type HarvestKind } from "./harvestEngine";

const { W, H, RIM, GROUND, BASKET_W, BASKET_H } = HV;
const INK = "#3B2422";

export interface DrawBasket { id: string; name: string; x: number; color: string; isMe: boolean; frozen: boolean; splat: boolean; look: AvatarLook | null }
export interface DrawItem { id: number; kind: HarvestKind; r: number; x: number; y: number; spin: number }
export interface Spot { x: number; y: number; r: number; rot: number }
export interface DrawFrame { items: DrawItem[]; baskets: DrawBasket[]; mult: number; spots: Spot[] | null; spotAlpha: number }

/** Картинки спрайтов (одна на цвет), грузятся один раз на всё приложение. */
const sprites = new Map<string, HTMLImageElement>();
function sprite(skin: string) {
  let img = sprites.get(skin);
  if (!img && typeof Image !== "undefined") {
    img = new Image();
    img.src = SKIN_SRC[skin as keyof typeof SKIN_SRC];
    sprites.set(skin, img);
  }
  return img;
}

export function createRenderer(canvas: HTMLCanvasElement, { mini = false } = {}) {
  const ctx = canvas.getContext("2d");
  const fx: { x: number; y: number; text: string; bad?: boolean; gold?: boolean; life: number }[] = [];
  const splats: { x: number; kind: HarvestKind; life: number }[] = [];
  const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let scale = 1;
  function resize() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    scale = canvas.width / W;
  }
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  ro?.observe(canvas);
  resize();

  if (!ctx) return { draw: () => undefined, pop: () => undefined, splat: () => undefined, tick: () => undefined, clear: () => undefined, destroy: () => ro?.disconnect() };
  const c = ctx;
  const font = (px: number, fam: "n" | "d" = "d") => `${fam === "n" ? "800" : "400"} ${px}px ${fam === "n" ? "Nunito, sans-serif" : "'Luckiest Guy', Rubik, sans-serif"}`;
  const rr = (x: number, y: number, w: number, h: number, r: number) => { c.beginPath(); c.roundRect(x, y, w, h, r); };

  function tomato(it: DrawItem) {
    const k = KINDS[it.kind];
    c.save(); c.translate(it.x, it.y);
    c.fillStyle = INK; c.beginPath(); c.ellipse(0, 4, it.r, it.r * 0.92, 0, 0, 7); c.fill();
    c.fillStyle = k.color; c.strokeStyle = INK; c.lineWidth = 2.5;
    c.beginPath(); c.ellipse(0, 0, it.r, it.r * 0.92, 0, 0, 7); c.fill(); c.stroke();
    if (it.kind === "rotten") {
      c.fillStyle = INK;
      for (const [sx, sy, sr] of [[-6, -3, 3.5], [5, 4, 2.5], [6, -7, 2]]) { c.beginPath(); c.arc(sx, sy, sr, 0, 7); c.fill(); }
      if (!reduce) { const a = it.spin * 3; c.beginPath(); c.arc(Math.cos(a) * 26, -18 + Math.sin(a * 1.3) * 6, 2.2, 0, 7); c.fill(); }
    } else {
      c.fillStyle = "rgba(255,255,255,.55)"; c.beginPath(); c.ellipse(-it.r * 0.38, -it.r * 0.35, it.r * 0.22, it.r * 0.14, -0.6, 0, 7); c.fill();
    }
    c.rotate(reduce ? 0 : Math.sin(it.spin) * 0.25);
    c.fillStyle = it.kind === "rotten" ? "#8F8A5E" : "#8EA04A"; c.lineWidth = 2;
    c.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5; c.lineTo(Math.cos(a) * 9, -it.r * 0.8 + Math.sin(a) * 5);
      const b = a + Math.PI / 5; c.lineTo(Math.cos(b) * 3.5, -it.r * 0.8 + Math.sin(b) * 2);
    }
    c.closePath(); c.fill(); c.stroke();
    if (it.kind === "golden" && !reduce) {
      c.strokeStyle = INK; c.lineWidth = 2; const s = 5 + Math.sin(it.spin * 3) * 2;
      c.beginPath(); c.moveTo(it.r + 6, -it.r); c.lineTo(it.r + 6, -it.r - s * 2); c.moveTo(it.r + 6 - s, -it.r - s); c.lineTo(it.r + 6 + s, -it.r - s); c.stroke();
    }
    c.restore();
  }

  function blob(x: number, y: number, r: number, rot: number, alpha: number) {
    c.save(); c.translate(x, y); c.rotate(rot); c.globalAlpha = alpha;
    c.fillStyle = "#E26D5A"; c.strokeStyle = INK; c.lineWidth = 3;
    c.beginPath(); c.arc(0, 0, r, 0, 7);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * 6.28, d = r * (0.95 + (i % 3) * 0.12), s = r * (0.22 + (i % 2) * 0.12);
      c.moveTo(Math.cos(a) * d + s, Math.sin(a) * d); c.arc(Math.cos(a) * d, Math.sin(a) * d, s, 0, 7);
    }
    c.fill();
    c.fillStyle = "#F6EFEC";
    for (let i = 0; i < 6; i++) { const a = i * 1.7, d = r * 0.45; c.beginPath(); c.ellipse(Math.cos(a) * d, Math.sin(a) * d, r * 0.07, r * 0.04, a, 0, 7); c.fill(); }
    c.restore();
  }

  /** Аксолотль игрока выглядывает из корзины: голова спрайта и надетые вещи (пиксели той же сетки 14 px). */
  function axolotl(look: AvatarLook | null, x: number) {
    if (!look) return;
    const img = sprite(look.skin);
    const sw = 336, sh = 280, sx = 56, sy = 0; // голова и жабры
    const dw = mini ? 74 : 92, dh = (dw * sh) / sw;
    const dx = x - dw / 2, dy = RIM + 18 - dh;
    if (img?.complete && img.naturalWidth) c.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    const k = dw / sw;
    for (const slot of [look.neck, look.face, look.head]) {
      const art = slot ? ITEM_ART[slot] : null;
      if (!art) continue;
      art.rows.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) {
          const ch = row[rx];
          if (ch === ".") continue;
          c.fillStyle = art.colors[ch];
          const px = (art.x + rx) * 14 - sx, py = (art.y + ry) * 14 - sy;
          c.fillRect(dx + px * k, dy + py * k, 14 * k + 0.4, 14 * k + 0.4);
        }
      });
    }
  }

  function basket(p: DrawBasket) {
    const w = BASKET_W, h = BASKET_H, top = RIM - 4;
    c.save();
    c.imageSmoothingEnabled = false;
    if (!p.isMe) c.globalAlpha = 0.9;
    axolotl(p.look, p.x);
    c.translate(p.x, top);
    const path = () => { c.beginPath(); c.moveTo(-w / 2, 0); c.lineTo(w / 2, 0); c.lineTo(w / 2 - 12, h); c.lineTo(-w / 2 + 12, h); c.closePath(); };
    c.save(); c.translate(0, 6); c.fillStyle = INK; path(); c.fill(); c.restore();
    c.fillStyle = p.color; c.strokeStyle = INK; c.lineWidth = p.isMe ? 3.5 : 2.5; path(); c.fill(); c.stroke();
    c.lineWidth = 2; c.strokeStyle = "rgba(59,36,34,.35)";
    for (let i = 1; i < 3; i++) { const y = (h * i) / 3, inset = (12 * i) / 3; c.beginPath(); c.moveTo(-w / 2 + inset + 4, y); c.lineTo(w / 2 - inset - 4, y); c.stroke(); }
    c.fillStyle = INK; rr(-w / 2 - 4, -5, w + 8, 9, 5); c.fill();
    if (p.frozen) {
      c.globalAlpha = 0.85; c.fillStyle = "#CFE6EE"; c.strokeStyle = INK; c.lineWidth = 2.5;
      rr(-w / 2 - 10, -16, w + 20, h + 22, 10); c.fill(); c.stroke();
      c.globalAlpha = 1; c.strokeStyle = "#FFFFFF"; c.lineWidth = 3;
      c.beginPath(); c.moveTo(-w / 2 + 2, -8); c.lineTo(-w / 2 + 22, -8); c.moveTo(w / 2 - 30, h - 2); c.lineTo(w / 2 - 4, h - 2); c.stroke();
    }
    if (p.splat && !p.isMe) blob(0, h / 2, 26, p.x, 0.95);
    if (!mini) {
      c.globalAlpha = 1;
      c.font = font(15, "n");
      const label = p.frozen ? `${p.name} · заморожен` : p.splat && !p.isMe ? `${p.name} · в кляксах` : p.name;
      const tw = c.measureText(label).width + 20;
      c.fillStyle = p.isMe ? "#EAA695" : p.frozen ? "#CFE6EE" : "#FFFFFF"; c.strokeStyle = INK; c.lineWidth = 2;
      rr(-tw / 2, h + 12, tw, 24, 12); c.fill(); c.stroke();
      c.fillStyle = INK; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(label, 0, h + 24.5);
    }
    c.restore();
  }

  /**
   * Фон как у поля Tower Defense: луг в клетку (#D9DE9F / #E4E9B8) с пучками травы, цветы, кусты и камни,
   * внизу — розовая каменная дорожка (как тропа TD), на которой стоят корзины.
   */
  const CELL = 100;
  const decor = (() => {
    const out: { x: number; y: number; kind: number }[] = [];
    for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 10; gx++) {
      const h = (Math.imul(gx + 1, 73856093) ^ Math.imul(gy + 1, 19349663)) >>> 0;
      if (h % 5 > 1) continue;
      out.push({ x: gx * CELL + 20 + ((h >>> 3) % 60), y: gy * CELL + 20 + ((h >>> 9) % 60), kind: (h >>> 5) % 4 });
    }
    return out.filter((d) => d.y < RIM - 40);
  })();
  const stones = (() => {
    const out: { x: number; y: number; rx: number; ry: number }[] = [];
    let a = 7;
    const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
    for (let x = 14; x < W; x += 38) for (const row of [0, 1]) out.push({ x: x + (row ? 19 : 0) + rnd() * 6, y: GROUND + 14 + row * 18 + rnd() * 4, rx: 12 + rnd() * 4, ry: 6 + rnd() * 2 });
    return out;
  })();
  function deco(d: { x: number; y: number; kind: number }) {
    c.save(); c.translate(d.x, d.y);
    if (d.kind === 0 || d.kind === 1) {
      c.fillStyle = d.kind === 0 ? "#ff9ccc" : "#ffe066";
      for (let i = 0; i < 5; i++) { const ang = (i * 72 * Math.PI) / 180; c.beginPath(); c.arc(7 * Math.cos(ang), 7 * Math.sin(ang), 5, 0, 7); c.fill(); }
      c.fillStyle = d.kind === 0 ? "#fff3a0" : "#e8590c"; c.beginPath(); c.arc(0, 0, 3.5, 0, 7); c.fill();
    } else if (d.kind === 2) {
      c.fillStyle = "#3f8f3a"; c.beginPath(); c.arc(-9, 2, 12, 0, 7); c.arc(9, 3, 11, 0, 7); c.fill();
      c.fillStyle = "#4fa847"; c.beginPath(); c.arc(0, -6, 13, 0, 7); c.fill();
      c.fillStyle = "#e03131"; c.beginPath(); c.arc(4, -10, 2.5, 0, 7); c.fill();
    } else {
      c.fillStyle = "rgba(0,0,0,.18)"; c.beginPath(); c.ellipse(0, 5, 14, 5, 0, 0, 7); c.fill();
      c.fillStyle = "#a8a29e"; c.strokeStyle = "#78716c"; c.lineWidth = 2;
      c.beginPath(); c.moveTo(-13, 4); c.quadraticCurveTo(-12, -10, 0, -11); c.quadraticCurveTo(13, -8, 13, 4); c.closePath(); c.fill(); c.stroke();
    }
    c.restore();
  }
  function background() {
    for (let gy = 0; gy * CELL < GROUND; gy++) for (let gx = 0; gx * CELL < W; gx++) {
      c.fillStyle = (gx + gy) % 2 ? "#D9DE9F" : "#E4E9B8";
      c.fillRect(gx * CELL, gy * CELL, CELL, CELL);
    }
    c.strokeStyle = "#B7BE7A"; c.lineWidth = 3; c.lineCap = "round";
    for (let gy = 0; gy * CELL < GROUND - 20; gy++) for (let gx = 0; gx * CELL < W; gx++) {
      const x = gx * CELL + ((gx * 37 + gy * 17) % 60) + 20, y = gy * CELL + ((gx * 23 + gy * 41) % 60) + 25;
      c.beginPath(); c.moveTo(x - 5, y + 7); c.lineTo(x, y - 7); c.lineTo(x + 5, y + 7); c.stroke();
    }
    if (!mini) for (const d of decor) deco(d);
    c.fillStyle = "#EAA695"; c.fillRect(0, GROUND, W, H - GROUND);
    c.fillStyle = "#c7b39a"; c.strokeStyle = "#9c8667"; c.lineWidth = 1.5;
    for (const st of stones) { c.beginPath(); c.ellipse(st.x, st.y, st.rx, st.ry, 0, 0, 7); c.fill(); c.stroke(); }
    c.fillStyle = INK; c.fillRect(0, GROUND, W, 3);
  }

  function draw(f: DrawFrame) {
    c.setTransform(scale, 0, 0, scale, 0, 0);
    background();
    for (const s of splats) {
      c.globalAlpha = Math.max(0, Math.min(1, s.life));
      c.fillStyle = KINDS[s.kind].color;
      c.beginPath(); c.ellipse(s.x, GROUND + 2, 26, 7, 0, 0, 7); c.fill();
      c.beginPath(); c.arc(s.x - 18, GROUND - 6, 4, 0, 7); c.arc(s.x + 20, GROUND - 9, 3, 0, 7); c.fill();
    }
    c.globalAlpha = 1;
    for (const b of f.baskets) if (!b.isMe) basket(b);
    for (const b of f.baskets) if (b.isMe) basket(b);
    for (const it of f.items) tomato(it);
    for (const p of fx) {
      c.globalAlpha = Math.max(0, Math.min(1, p.life * 1.6));
      c.font = font(p.gold ? 34 : 28); c.textAlign = "center"; c.textBaseline = "alphabetic"; c.lineWidth = 5; c.strokeStyle = "#FFFFFF";
      c.fillStyle = p.bad ? "#7D625E" : INK;
      c.strokeText(p.text, p.x, p.y); c.fillText(p.text, p.x, p.y);
    }
    c.globalAlpha = 1;
    if (!mini && f.mult > 1) {
      c.font = font(26); c.textAlign = "left"; c.textBaseline = "top";
      const txt = `комбо ×${f.mult}`, tw = c.measureText(txt).width + 28;
      c.fillStyle = INK; rr(20, 26, tw, 38, 19); c.fill();
      c.fillStyle = "#EAA695"; c.strokeStyle = INK; c.lineWidth = 2.5; rr(20, 20, tw, 38, 19); c.fill(); c.stroke();
      c.fillStyle = INK; c.fillText(txt, 34, 29);
    }
    if (f.spots) for (const s of f.spots) blob(s.x, s.y, s.r, s.rot, f.spotAlpha * 0.97);
  }

  return {
    draw,
    pop(x: number, text: string, opts: { bad?: boolean; gold?: boolean } = {}) { fx.push({ x, y: RIM - 30, text, ...opts, life: 1 }); },
    splat(x: number, kind: HarvestKind) { splats.push({ x, kind, life: 1.4 }); },
    tick(dt: number) {
      for (const p of fx) { p.life -= dt * 1.2; if (!reduce) p.y -= dt * 60; }
      for (const s of splats) s.life -= dt * 0.8;
      for (const arr of [fx, splats] as { life: number }[][]) for (let i = arr.length - 1; i >= 0; i--) if (arr[i].life <= 0) arr.splice(i, 1);
    },
    clear() { fx.length = 0; splats.length = 0; },
    destroy() { ro?.disconnect(); },
  };
}
export type HarvestRenderer = ReturnType<typeof createRenderer>;

/** Кляксы на весь экран игрока (шутка «Клякса»): 6 штук по полю, стираются кликом. */
export function makeSpots(seed: number): Spot[] {
  let a = seed >>> 0;
  const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  return Array.from({ length: 6 }, (_, i) => ({ x: 130 + (i % 3) * 330 + rnd() * 120, y: 90 + Math.floor(i / 3) * 190 + rnd() * 80, r: 62 + rnd() * 40, rot: rnd() * 6.28 }));
}
