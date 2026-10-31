/**
 * One-shot optimizer for Social Marketing map assets.
 * Reads the original art in public/Social-Mkt and writes trimmed RGBA
 * copies next to the IT assets. Originals are left in place.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();

const characters = [
  ["haotu", "hao-duong-tu.png", "hao-duong-tu.png"],
  ["quanam", "quan-the-am-bo-tat.png", "quan-the-am-bo-tat.png"],
  ["duongtang", "duong-tang.png", "duong-tang.png"],
  ["phatto", "phat-to.png", "phat-to-nhu-lai.png"],
  ["ngokhong", "ton-ngo-khong.png", "ton-ngo-khong.png"],
  ["satang", "sa-tang.png", "sa-tang.png"],
  ["batgioi", "chu-bat-gioi.png", "chu-bat-gioi.png"],
  ["bachlongma", "bach-long-ma.png", "bach-long-ma.png"],
];

function unkey(buffer, width, height) {
  const out = Buffer.from(buffer);
  for (let i = 0; i < out.length; i += 4) {
    const alpha = out[i + 3];
    if (alpha < 12) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
    }
  }
  void width;
  void height;
  return out;
}

async function sprite(source, target) {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  await sharp(unkey(data, info.width, info.height), { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim({ threshold: 1 })
    .resize({ height: 960, withoutEnlargement: true })
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(target);
}

async function avatar(source, target) {
  // Bust portraits are square. Keep the head and shoulders, drop the lower scenery.
  const size = 500;
  const crop = 420;
  const left = Math.round((size - crop) / 2);
  await sharp(source)
    .extract({ left, top: 8, width: crop, height: crop })
    .resize(280, 280)
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(target);
}

async function main() {
  const faceDir = path.join(ROOT, "public", "Social-Mkt", "Social-MKT-face");
  const spriteDir = path.join(ROOT, "public", "Social-Mkt", "Social-Mkt");
  for (const [id, face, body] of characters) {
    const dir = path.join(ROOT, "public", "characters-social", id);
    fs.mkdirSync(dir, { recursive: true });
    await avatar(path.join(faceDir, face), path.join(dir, "avatar.png"));
    await sprite(path.join(spriteDir, body), path.join(dir, "sprite.png"));
    const spriteMeta = await sharp(path.join(dir, "sprite.png")).metadata();
    console.log(id, "sprite", spriteMeta.width + "x" + spriteMeta.height);
  }

  const maps = path.join(ROOT, "public", "maps");
  fs.mkdirSync(maps, { recursive: true });
  await sharp(path.join(ROOT, "public", "Social-Mkt", "map.png"))
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(path.join(maps, "social-map.png"));

  const centerSrc = path.join(ROOT, "public", "Social-Mkt", "social-mkt-center.png");
  const { data, info } = await sharp(centerSrc).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  await sharp(unkey(data, info.width, info.height), { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim({ threshold: 1 })
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(path.join(maps, "social-center.png"));
  console.log("maps written");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
