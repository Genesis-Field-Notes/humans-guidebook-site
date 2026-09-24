#!/usr/bin/env node

import { mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import os from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bookFile = path.join(root, "book-data.js");
const behaviorFile = path.join(root, "behavior-data.js");
const backMatterFile = path.join(root, "back-matter-data.js");
const audioDirectory = path.join(root, "audio");
const voiceId = process.env.ELEVENLABS_VOICE_ID || "z78r5be3XfFdGOPQefrh";
const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const outputFormat = process.env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128";
const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
const runFile = promisify(execFile);
const args = process.argv.slice(2);

function help() {
  console.log(`Generate Exi narration for A Human's Guide to the Universe.

Usage:
  node scripts/generate-narration.mjs --list
  node scripts/generate-narration.mjs <section-id> --dry-run
  node scripts/generate-narration.mjs <section-id> [--force]
  node scripts/generate-narration.mjs --all-behaviors [--force]
  node scripts/generate-narration.mjs --all-back-matter [--force]
  node scripts/generate-narration.mjs --all-cuisine [--force]

Environment:
  ELEVENLABS_API_KEY        required for generation
  ELEVENLABS_VOICE_ID       defaults to Exi (${voiceId})
  ELEVENLABS_MODEL_ID       defaults to ${modelId}
  ELEVENLABS_OUTPUT_FORMAT  defaults to ${outputFormat}`);
}

function decodeHtml(value) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function readAssignment(file, variableName) {
  const source = await readFile(file, "utf8");
  const prefix = `window.${variableName} =`;
  if (!source.trimStart().startsWith(prefix)) throw new Error(`${path.basename(file)} is not a ${variableName} data file.`);
  return JSON.parse(source.trim().slice(prefix.length).replace(/;$/, "").trim());
}

function serializeAssignment(variableName, data) {
  if (variableName !== "BOOK_DATA") return `window.${variableName} = ${JSON.stringify(data,null,2)};\n`;
  const meta = JSON.stringify(data.meta);
  const sections = data.sections.map((section) => JSON.stringify(section)).join(",\n");
  return `window.${variableName} = {\"meta\":${meta},\"sections\":[${sections}]};\n`;
}

function narrationText(section) {
  const parts = [section.title];
  for (const block of section.blocks) {
    const text = decodeHtml(block.html).trim();
    if (text) parts.push(text);
  }
  return parts.join("\n\n");
}

function narrationChunks(text, maximumLength = 9500) {
  const paragraphs = text.split(/\n\n+/);
  const chunks = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (paragraph.length > maximumLength) throw new Error(`A narration paragraph exceeds ${maximumLength} characters.`);
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maximumLength) current = candidate;
    else {
      chunks.push(current);
      current = paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function synthesize(text, apiKey) {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
    body: JSON.stringify({ text, model_id: modelId })
  });
  if (!response.ok) throw new Error(`ElevenLabs returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length < 1024) throw new Error("ElevenLabs returned an unexpectedly small audio file.");
  return audio;
}

async function markNarrationReady(sectionId) {
  for (const [file, variableName] of [[bookFile,"BOOK_DATA"],[behaviorFile,"HUMAN_SURVIVAL_BEHAVIORS"],[backMatterFile,"BACK_MATTER_ONE"]]) {
    const data=await readAssignment(file,variableName); const sections=Array.isArray(data) ? data : data.sections;
    const section=sections.find((entry)=>entry.id===sectionId);
    if (!section) continue; section.narration=true;
    await writeFile(file,serializeAssignment(variableName,data)); return;
  }
}

async function generate(section, { force = false, dryRun = false } = {}) {
  const text = narrationText(section);
  const destination = path.join(audioDirectory, `${section.id}.mp3`);
  if (dryRun) {
    console.log(`\n[${section.id}] ${text.length.toLocaleString()} characters\n${text}\n`);
    return;
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is required. Keep it in your shell or an untracked .env file; never commit it.");
  if (!force) {
    try {
      await readFile(destination);
      throw new Error(`${path.relative(root, destination)} already exists. Use --force to replace it.`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  const temporary = `${destination}.tmp`;
  const chunks = narrationChunks(text);
  let audio;
  if (chunks.length === 1) {
    audio = await synthesize(chunks[0], apiKey);
    await writeFile(temporary, audio);
  } else {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "guidebook-narration-"));
    try {
      const partFiles = [];
      for (let index = 0; index < chunks.length; index += 1) {
        const part = path.join(temporaryDirectory, `part-${String(index).padStart(3, "0")}.mp3`);
        await writeFile(part, await synthesize(chunks[index], apiKey));
        partFiles.push(part);
      }
      const concatFile = path.join(temporaryDirectory, "concat.txt");
      await writeFile(concatFile, partFiles.map((part) => `file '${part.replaceAll("'", "'\\''")}'`).join("\n"));
      await runFile(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", "-f", "mp3", "-y", temporary]);
      audio = await readFile(temporary);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
  try {
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  await markNarrationReady(section.id);
  console.log(`Created ${path.relative(root, destination)} (${(audio.length / 1024 / 1024).toFixed(2)} MB) and enabled its player.`);
}

if (args.includes("--help") || args.includes("-h")) {
  help();
  process.exit(0);
}

const book = await readAssignment(bookFile, "BOOK_DATA");
const cuisine = book.sections.filter((section) => section.label?.startsWith("Earth Cuisine "));
const behaviors = await readAssignment(behaviorFile, "HUMAN_SURVIVAL_BEHAVIORS");
const backMatter = await readAssignment(backMatterFile, "BACK_MATTER_ONE");
if (args.includes("--list")) {
  for (const section of [...cuisine,...behaviors,...backMatter]) console.log(`${section.id}\t${section.title}`);
  process.exit(0);
}

const selected = args.includes("--all-behaviors")
  ? behaviors
  : args.includes("--all-back-matter") ? backMatter
    : args.includes("--all-cuisine") ? cuisine
      : [...cuisine,...behaviors,...backMatter].filter((section)=>section.id===args.find((arg)=>!arg.startsWith("--")));

if (!selected.length) {
  help();
  process.exitCode = 1;
} else {
  for (const section of selected) await generate(section, { force: args.includes("--force"), dryRun: args.includes("--dry-run") });
}
