// Converte os papéis de parede de public/theme_moldura (PNG, fonte) em WebP otimizado
// em public/wallpapers/<estilo>-<tema>.webp. Rode: node scripts/build-wallpapers.mjs
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const SRC = "public/theme_moldura";
const OUT = "public/wallpapers";
// Nome do arquivo → identidade visual (black → dark, light → white).
const COLORS = { black: "dark", red: "red", white: "white", light: "white" };

mkdirSync(OUT, { recursive: true });
for (const style of readdirSync(SRC)) {
  for (const file of readdirSync(join(SRC, style))) {
    const color = file.replace(/\.png$/i, "").split("_").find((part) => part in COLORS);
    if (!color) continue;
    const target = join(OUT, `${style}-${COLORS[color]}.webp`);
    const info = await sharp(join(SRC, style, file))
      .resize({ width: 1920, withoutEnlargement: true })
      .webp({ quality: 78, effort: 6 })
      .toFile(target);
    console.log(target, info.width, "x", info.height, Math.round(info.size / 1024), "KB");
  }
}
