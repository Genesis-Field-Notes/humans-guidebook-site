#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entries = [
  ["back-matter-1-introduction", "Back Matter I", "After Contact: The Human Spark in the Names of Things", "00-after-contact.md"],
  ["nomenclature-particle-strange", "Nomenclature Entry 01", "The Particle Is Strange. This Is Now Its Name.", "01-particle-is-strange.md"],
  ["nomenclature-program-called-what-it-does", "Nomenclature Entry 02", "The Program Is Called What It Does.", "02-program-is-called-what-it-does.md"],
  ["nomenclature-first-specimen-common", "Nomenclature Entry 03", "The First Specimen Is “Common.”", "03-first-specimen-common.md"],
  ["nomenclature-name-is-wrong", "Nomenclature Entry 04", "The Name Is Wrong. It Has Seniority.", "04-name-is-wrong.md"],
  ["nomenclature-resembled-a-horse", "Nomenclature Entry 05", "It Resembled a Horse from One Direction.", "05-resembled-a-horse.md"],
  ["nomenclature-named-after-humans", "Nomenclature Entry 06", "Humans Name Things After Humans.", "06-humans-name-things-after-humans.md"],
  ["nomenclature-machine-personality", "Nomenclature Entry 07", "The Machine Has Developed a Personality.", "07-machine-has-developed-a-personality.md"],
  ["nomenclature-henry-atlantic", "Supplemental Field Entry", "Henry Has Crossed the Atlantic.", "07a-henry-crossed-the-atlantic.md"],
  ["nomenclature-species-personality", "Nomenclature Entry 08", "The Species Has Acquired a Personality.", "08-species-has-acquired-a-personality.md"],
];

function inlineMarkdown(value) {
  return value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>").replace(/\*([^*]+)\*/g,"<em>$1</em>");
}

function markdownBlocks(source) {
  const blocks = []; let paragraph = [];
  const flush = () => { if (!paragraph.length) return; const raw = paragraph.join(" ").replace(/\s{2,}/g," ").trim(); if (raw) blocks.push({type:blocks.length?"paragraph":"opening",html:inlineMarkdown(raw)}); paragraph=[]; };
  for (const line of source.replace(/\r/g,"").split("\n")) {
    const trimmed=line.trim();
    if (!trimmed) { flush(); continue; }
    if (/^#{1,2}\s/.test(trimmed)||trimmed==="---") { flush(); continue; }
    if (/^###\s/.test(trimmed)) { flush(); blocks.push({type:"subheading",html:inlineMarkdown(trimmed.replace(/^###\s+/,""))}); continue; }
    if (/^[-*]\s+/.test(trimmed)||/^\d+\.\s+/.test(trimmed)) { flush(); blocks.push({type:"bullet",html:inlineMarkdown(trimmed.replace(/^(?:[-*]|\d+\.)\s+/,""))}); continue; }
    if (/^>\s?/.test(trimmed)) { flush(); blocks.push({type:"paragraph",html:`<em>${inlineMarkdown(trimmed.replace(/^>\s?/,""))}</em>`}); continue; }
    paragraph.push(trimmed.replace(/\s{2}$/, ""));
  }
  flush(); return blocks;
}

const sections=[];
for (const [id,label,title,filename] of entries) {
  const source=await readFile(path.join(root,"drafts","back-matter-1",filename),"utf8");
  sections.push({id,label,title,visualMode:"nomenclature",narration:false,blocks:markdownBlocks(source)});
}
await writeFile(path.join(root,"back-matter-data.js"),`window.BACK_MATTER_ONE = ${JSON.stringify(sections,null,2)};\n`);
console.log(`Built back-matter-data.js with ${sections.length} sections.`);
