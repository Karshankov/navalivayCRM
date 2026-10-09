import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// .env лежит рядом с сервером, а запускают его и из корня проекта тоже.
// Без явного пути dotenv искал бы файл в текущей папке и молча брал пустые
// значения: база подменялась на дефолтную, а локальные флаги не включались.
const serverDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(serverDir, ".env") });

process.env.PORT = "3001";
await import("./index.js");
