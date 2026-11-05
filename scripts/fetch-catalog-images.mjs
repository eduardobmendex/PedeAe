// Baixa as fotos do Pexels (supabase/catalog/imagens.mjs) e grava em public/catalog/
// reduzidas para o cardápio. Quem já existe não é baixado de novo. Links externos não são baixados.
//
//   node scripts/fetch-catalog-images.mjs
import { existsSync, mkdirSync, statSync } from "node:fs";
import sharp from "sharp";
import { photos } from "../supabase/catalog/imagens.mjs";

const dir = "public/catalog";
mkdirSync(dir, { recursive: true });

const pexelsUrl = (id) => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=1200`;
const sources = Object.keys(photos).map((id) => [id, pexelsUrl(id)]);

let total = 0;
for (const [name, url] of sources) {
  const file = `${dir}/${name}.webp`;
  if (!existsSync(file)) {
    const res = await fetch(url, { headers: { "user-agent": "PedeAe-catalog-fetch/1.0" } });
    if (!res.ok) throw new Error(`foto ${name}: HTTP ${res.status}`);
    await sharp(Buffer.from(await res.arrayBuffer()))
      .resize(900, 675, { fit: "cover", withoutEnlargement: true })
      .webp({ quality: 72 })
      .toFile(file);
  }
  total += statSync(file).size;
}
console.log(`${sources.length} fotos em ${dir} (${Math.round(total / 1024)} KB)`);
