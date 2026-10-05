import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

function readJson(rel){
  return JSON.parse(fs.readFileSync(path.resolve(ROOT, rel), "utf8"));
}
function num(name,fallback){
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}
function bool(name,fallback){
  const v = process.env[name];
  if(v == null || v === "") return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

const base = readJson("config/config.json");

export const config = {
  host: process.env.HOST || "127.0.0.1",
  port: num("PORT",3000),
  tiktokUsername: process.env.TIKTOK_USERNAME || "",
  adminToken: process.env.ADMIN_TOKEN || "",
  allowTestApi: bool("ALLOW_TEST_API",false),
  auction: {
    ...base.auction,
    minGiftCoins: num("MIN_GIFT_COINS",base.auction.minGiftCoins),
    mainSeconds: num("MAIN_SECONDS",base.auction.mainSeconds),
    finalSeconds: num("FINAL_SECONDS",base.auction.finalSeconds),
    finalResetSeconds: num("FINAL_RESET_SECONDS",base.auction.finalResetSeconds),
    nextRoundDelaySeconds: num("NEXT_ROUND_DELAY_SECONDS",base.auction.nextRoundDelaySeconds)
  },
  roblox: {
    ...base.roblox,
    enabled: bool("ROBLOX_DELIVERY_ENABLED",false),
    dryRun: bool("ROBLOX_DRY_RUN",true),
    universeId: process.env.ROBLOX_UNIVERSE_ID || "",
    apiKey: process.env.ROBLOX_OPEN_CLOUD_API_KEY || "",
    topic: process.env.ROBLOX_TOPIC || base.roblox.topic
  },
  awards: readJson("config/auction-awards-v1.json")
};
