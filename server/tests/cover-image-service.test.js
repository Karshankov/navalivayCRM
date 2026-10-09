import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "navalivay-cover-image-"));
process.env.DATABASE_FILE = path.join(tempDir, "test.db");
process.env.UPLOADS_DIR = path.join(tempDir, "uploads");
process.env.BOT_TOKEN = "";

const { initDb, db } = await import("../db.js");
const { resolveCoverImage, resolveImageThumbnail } = await import(
  "../services/image-thumbnail-service.js"
);
const sharp = (await import("sharp")).default;

// Windows держит файл открытым, пока sharp кэширует его у себя: без этого
// тест не может убрать файл, чтобы проверить восстановление.
sharp.cache(false);

initDb();

/**
 * Картинка 8x8, где левая половина полностью прозрачная, а правая красная.
 * Собираем её на месте: захардкоженный base64 легко оказывается без альфы, и
 * тогда проверка прозрачности молча ничего не проверяет.
 */
const raw = Buffer.alloc(8 * 8 * 4);
for (let i = 0; i < 8 * 8; i += 1) {
  const x = i % 8;
  raw[i * 4] = 255;
  raw[i * 4 + 3] = x < 4 ? 0 : 255;
}
const transparentPng =
  "data:image/png;base64," +
  (await sharp(raw, { raw: { width: 8, height: 8, channels: 4 } }).png().toBuffer()).toString(
    "base64",
  );

function fileFor(url) {
  return path.join(process.env.UPLOADS_DIR, url.replace("/uploads/", ""));
}

let failed = 0;
function check(name, fn) {
  try {
    return fn().then(
      () => console.log(`OK: ${name}`),
      (error) => {
        failed += 1;
        console.error(`FAIL: ${name}\n  ${error.message}`);
      },
    );
  } catch (error) {
    failed += 1;
    console.error(`FAIL: ${name}\n  ${error.message}`);
    return Promise.resolve();
  }
}

await check("обложка кладётся файлом и отдаётся адресом, а не base64", async () => {
  const url = await resolveCoverImage(transparentPng, { sourceId: "g-1" });
  assert.ok(url.startsWith("/uploads/thumbnails/covers/"), `получили ${url}`);
  assert.ok(fs.existsSync(fileFor(url)), "файл обложки не создан");
});

await check("прозрачность не превращается в чёрный фон", async () => {
  const url = await resolveCoverImage(transparentPng, { sourceId: "g-1" });
  const meta = await sharp(fileFor(url)).metadata();
  assert.equal(meta.hasAlpha, true, "альфа-канал потерян");

  const { data, info } = await sharp(fileFor(url))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  // Левый край был прозрачным, правый — красным.
  assert.equal(data[3], 0, "прозрачный пиксель стал непрозрачным");
  const rightEdge = (info.width - 1) * 4;
  assert.equal(data[rightEdge + 3], 255, "непрозрачный пиксель стал прозрачным");
});

await check("повторный вызов берёт готовый файл, а не режет заново", async () => {
  const first = await resolveCoverImage(transparentPng, { sourceId: "g-1" });
  const mtime = fs.statSync(fileFor(first)).mtimeMs;
  const second = await resolveCoverImage(transparentPng, { sourceId: "g-1" });
  assert.equal(second, first);
  assert.equal(fs.statSync(fileFor(first)).mtimeMs, mtime, "файл перезаписан зря");
});

await check("пропавший файл восстанавливается, а не отдаётся битой ссылкой", async () => {
  const url = await resolveCoverImage(transparentPng, { sourceId: "g-1" });
  fs.unlinkSync(fileFor(url));
  // Запись в кэше осталась: без проверки файла витрина отдавала бы 404 вечно.
  const again = await resolveCoverImage(transparentPng, { sourceId: "g-1" });
  assert.equal(again, url);
  assert.ok(fs.existsSync(fileFor(again)), "файл не восстановлен");
});

await check("обложка и миниатюра поиска не пишутся в один файл", async () => {
  const cover = await resolveCoverImage(transparentPng, { sourceId: "g-1" });
  const thumb = await resolveImageThumbnail(transparentPng, { sourceId: "g-1" });
  assert.notEqual(cover, thumb, "разные размеры делят один файл");
  assert.ok(thumb.startsWith("/uploads/thumbnails/search/"), `получили ${thumb}`);

  const coverMeta = await sharp(fileFor(cover)).metadata();
  const thumbMeta = await sharp(fileFor(thumb)).metadata();
  // Поиску нужен квадрат 96x96, обложке — вписанный размер до 240.
  assert.equal(thumbMeta.width, 96);
  assert.ok(coverMeta.width <= 240 && coverMeta.height <= 240);
});

db.close();
fs.rmSync(tempDir, { recursive: true, force: true });

if (failed) {
  console.error(`Cover image service: ${failed} проверок упало`);
  process.exit(1);
}
console.log("Cover image service: all tests passed");
