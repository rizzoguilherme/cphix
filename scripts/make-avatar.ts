// Gera a foto de perfil do bot em assets/cphix-avatar.png (640x640), para Telegram e WhatsApp.
import { mkdirSync, writeFileSync } from "node:fs";
import { renderAvatarPng } from "../src/brand";

mkdirSync("assets", { recursive: true });
writeFileSync("assets/cphix-avatar.png", renderAvatarPng());
console.log("Avatar salvo em assets/cphix-avatar.png");
