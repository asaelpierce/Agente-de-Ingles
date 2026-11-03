// Pronunciation engine for Brazilian learners — General American (en-US).
//
// Pipeline (deterministic; the AI never writes the respelling):
//   1. text -> tokens: special tech tokens (C++, .NET), numbers (decimals, $, %, ordinals, years), acronyms as letters
//   2. tokens -> phonemes from a pronunciation dictionary (CMUdict + curated tech terms), heteronyms chosen by context
//      (I live / a live demo, I read / I read it yesterday), rule-based -s/-ed/-ing derivation; anything else is
//      returned as "missing" (never guessed here)
//   3. connected speech on the whole phrase: weak forms of function words, flap T/D, linking, pauses
//   4. syllables (maximal onset) and lexical stress from the dictionary; sentence stress on one-syllable content words
//   5. phonemes -> IPA, and phonemes -> Portuguese-style respelling through a fixed phoneme table.
//      Sounds that do not exist in Brazilian Portuguese are kept distinct and tagged, never replaced
//      by a Brazilian sound (TH stays th/dh, American R is flagged, final L is not turned into "u").
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const OVERRIDES = require("./overrides");

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

let DICT = null;
function dict() {
  if (DICT) return DICT;
  DICT = new Map();
  const txt = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, "cmudict.txt.gz"))).toString("utf8");
  for (const line of txt.split("\n")) {
    const i = line.indexOf("\t");
    if (i > 0) DICT.set(line.slice(0, i), line.slice(i + 1).replace(/#.*$/, "").trim()); // some entries carry "# comment"
  }
  return DICT;
}

const VOWELS = new Set(["AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"]);
const CONS = new Set(["B", "CH", "D", "DH", "F", "G", "HH", "JH", "K", "L", "M", "N", "NG", "P", "R", "S", "SH", "T", "TH", "V", "W", "Y", "Z", "ZH"]);
const ARPABET_SYMBOLS = [...VOWELS, ...CONS];

function parse(arpa) {
  return String(arpa).trim().split(/\s+/).map((t) => {
    const m = t.match(/^([A-Z]+)([012])?$/);
    if (!m || !(VOWELS.has(m[1]) || CONS.has(m[1]))) throw new Error("bad phone " + t);
    if (VOWELS.has(m[1]) && m[2] === undefined) throw new Error("vowel without stress " + t);
    return VOWELS.has(m[1]) ? { p: m[1], v: true, s: Number(m[2]) } : { p: m[1], v: false };
  });
}
function validArpabet(arpa) { try { const ph = parse(arpa); return ph.length > 0 && ph.some(x => x.v); } catch (e) { return false; } }

// ---------- 1. text normalization and tokens ----------
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function numberWords(n) {
  if (!Number.isFinite(n) || n < 0 || n >= 1e12 || Math.floor(n) !== n) return null;
  if (n < 20) return [ONES[n]];
  if (n < 100) return [TENS[Math.floor(n / 10)]].concat(n % 10 ? [ONES[n % 10]] : []);
  if (n < 1000) return [ONES[Math.floor(n / 100)], "hundred"].concat(n % 100 ? numberWords(n % 100) : []);
  for (const [size, name] of [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]]) {
    if (n >= size) return numberWords(Math.floor(n / size)).concat([name], n % size ? numberWords(n % size) : []);
  }
  return null;
}
function yearWords(n) { // 1100-1999 and 2010-2099 are read in pairs: nineteen ninety-nine, twenty twenty-six
  const hi = Math.floor(n / 100), lo = n % 100;
  if (lo === 0) return numberWords(hi).concat(["hundred"]);
  return numberWords(hi).concat(lo < 10 ? ["oh"].concat(numberWords(lo)) : numberWords(lo));
}
const ORD = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };
function ordinalWords(n) {
  const w = numberWords(n); if (!w) return null;
  const last = w[w.length - 1];
  w[w.length - 1] = ORD[last] || (/ty$/.test(last) ? last.replace(/ty$/, "tieth") : last + "th");
  return w;
}
const DIGIT = ["oh", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
// a number token -> spoken words, or null when it cannot be read reliably
function spokenNumber(tok) {
  let m;
  if ((m = tok.match(/^(\d+)(st|nd|rd|th)$/i))) return ordinalWords(Number(m[1]));
  const money = tok.startsWith("$"), pct = tok.endsWith("%");
  const core = tok.replace(/^\$/, "").replace(/%$/, "");
  if (!/^\d+(,\d{3})*(\.\d+)?$/.test(core)) return null;
  const [intPart, dec] = core.replace(/,/g, "").split(".");
  const n = Number(intPart);
  let words;
  if (!money && !pct && !dec && !/,/.test(core) && intPart.length === 4 && ((n >= 1100 && n <= 1999) || (n >= 2010 && n <= 2099))) words = yearWords(n);
  else words = numberWords(n);
  if (!words) return null;
  if (dec) words = words.concat(["point"], dec.split("").map(d => DIGIT[Number(d)]));
  if (money) words = words.concat([n === 1 && !dec ? "dollar" : "dollars"]);
  if (pct) words = words.concat(["percent"]);
  return words;
}
// written forms that are not read letter by letter
const SPECIAL = [
  [/\bC\+\+/g, "C plus plus"], [/\bC#/g, "C sharp"], [/(^|\s)\.NET\b/gi, "$1dot net"], [/\bNode\.js\b/gi, "Node J S"],
  [/\bvs\.?(?=\s|$)/gi, "versus"], [/\be\.g\./gi, "for example"], [/\bi\.e\./gi, "that is"], [/\betc\./gi, "et cetera"],
  [/\bDr\.(?=\s+[A-Z])/g, "Doctor"], [/\bMr\.(?=\s)/g, "Mister"], [/\bMrs\.(?=\s)/g, "Missus"], [/\bMs\.(?=\s)/g, "Miz"]
];
function tokenize(text) {
  let t = String(text == null ? "" : text);
  for (const [re, rep] of SPECIAL) t = t.replace(re, rep);
  const out = [];
  const re = /\d+(?:st|nd|rd|th)\b|\$?\d+(?:,\d{3})*(?:\.\d+)?%?|'?[A-Za-z0-9][A-Za-z0-9'’\-]*|-{2,}|…|[.,!?;:—–()"]/g;
  let m;
  while ((m = re.exec(t))) {
    const tok = m[0].replace(/’/g, "'");
    if (/^(-{2,}|…|[.,!?;:—–()"])$/.test(tok)) { if (out.length) out[out.length - 1].pause = true; continue; }
    // "5.4%" keeps its dot; a sentence-final "3." does not reach here as part of the number
    out.push({ text: /s'$/i.test(tok) ? tok : tok.replace(/'+$/, ""), pause: false });
  }
  return out;
}

// ---------- 2. dictionary lookup ----------
function addSuffix(ph, suf) {
  const last = ph[ph.length - 1].p;
  if (suf === "S") {
    if (["S", "Z", "SH", "ZH", "CH", "JH"].includes(last)) return ph.concat(parse("IH0 Z"));
    if (["P", "T", "K", "F", "TH"].includes(last)) return ph.concat(parse("S"));
    return ph.concat(parse("Z"));
  }
  if (suf === "ED") {
    if (["T", "D"].includes(last)) return ph.concat(parse("IH0 D"));
    if (["P", "K", "F", "TH", "S", "SH", "CH"].includes(last)) return ph.concat(parse("T"));
    return ph.concat(parse("D"));
  }
  if (suf === "ING") return ph.concat(parse("IH0 NG"));
  return ph;
}
function rawLookup(w) { return (own(OVERRIDES, w) && OVERRIDES[w]) || dict().get(w) || null; }
function lookupWord(word) {
  let w = word.toLowerCase();
  let direct = rawLookup(w);
  if (!direct && w.startsWith("'")) { w = w.slice(1); direct = rawLookup(w); } // quoted word, not 'em / 'cause
  if (direct) return { ph: parse(direct), src: own(OVERRIDES, w) ? "curated" : "dict" };
  const tries = [];
  if (w.endsWith("'s")) tries.push([w.slice(0, -2), "S"]);
  if (w.endsWith("s'")) tries.push([w.slice(0, -1), ""]);
  if (w.endsWith("ies")) tries.push([w.slice(0, -3) + "y", "S"]);
  if (w.endsWith("es")) tries.push([w.slice(0, -1), "S"], [w.slice(0, -2), "S"]); // "parses" -> parse, "boxes" -> box
  else if (w.endsWith("s")) tries.push([w.slice(0, -1), "S"]);
  if (w.endsWith("ied")) tries.push([w.slice(0, -3) + "y", "ED"]);
  if (w.endsWith("ed")) { tries.push([w.slice(0, -1), "ED"], [w.slice(0, -2), "ED"]); if (/([bdgklmnprt])\1ed$/.test(w)) tries.push([w.slice(0, -3), "ED"]); }
  if (w.endsWith("ing")) { tries.push([w.slice(0, -3) + "e", "ING"], [w.slice(0, -3), "ING"]); if (/([bdgklmnprt])\1ing$/.test(w)) tries.push([w.slice(0, -4), "ING"]); }
  for (const [base, suf] of tries) {
    const b = base && rawLookup(base);
    if (b) return { ph: addSuffix(parse(b), suf), src: "derived" };
  }
  return null;
}

// Words spelled the same but said differently depending on use (verb vs noun/adjective, present vs past).
const HET = {
  live: { verb: "L IH1 V", noun: "L AY1 V", def: "verb" },
  lives: { verb: "L IH1 V Z", noun: "L AY1 V Z", def: "verb" },
  use: { verb: "Y UW1 Z", noun: "Y UW1 S", def: "verb" },
  uses: { verb: "Y UW1 Z IH0 Z", noun: "Y UW1 S IH0 Z", def: "verb" },
  close: { verb: "K L OW1 Z", noun: "K L OW1 S", def: "verb" },
  record: { verb: "R IH0 K AO1 R D", noun: "R EH1 K ER0 D", def: "noun" },
  records: { verb: "R IH0 K AO1 R D Z", noun: "R EH1 K ER0 D Z", def: "noun" },
  present: { verb: "P R IY0 Z EH1 N T", noun: "P R EH1 Z AH0 N T", def: "noun" },
  project: { verb: "P R AH0 JH EH1 K T", noun: "P R AA1 JH EH0 K T", def: "noun" },
  projects: { verb: "P R AH0 JH EH1 K T S", noun: "P R AA1 JH EH0 K T S", def: "noun" },
  address: { verb: "AH0 D R EH1 S", noun: "AE1 D R EH2 S", def: "noun" },
  update: { verb: "AH0 P D EY1 T", noun: "AH1 P D EY2 T", def: "noun" },
  updates: { verb: "AH0 P D EY1 T S", noun: "AH1 P D EY2 T S", def: "noun" },
  object: { verb: "AH0 B JH EH1 K T", noun: "AA1 B JH EH0 K T", def: "noun" },
  permit: { verb: "P ER0 M IH1 T", noun: "P ER1 M IH2 T", def: "noun" },
  increase: { verb: "IH0 N K R IY1 S", noun: "IH1 N K R IY2 S", def: "noun" },
  progress: { verb: "P R AH0 G R EH1 S", noun: "P R AA1 G R EH2 S", def: "noun" },
  contract: { verb: "K AH0 N T R AE1 K T", noun: "K AA1 N T R AE2 K T", def: "noun" },
  export: { verb: "IH0 K S P AO1 R T", noun: "EH1 K S P AO2 R T", def: "noun" },
  import: { verb: "IH0 M P AO1 R T", noun: "IH1 M P AO2 R T", def: "noun" },
  content: { verb: "K AH0 N T EH1 N T", noun: "K AA1 N T EH2 N T", def: "noun" }
};
const VERB_CUE = new Set(["i", "you", "we", "they", "he", "she", "it", "to", "me", "us", "will", "can", "could", "would", "should", "must", "might", "may", "don't", "doesn't", "didn't", "won't", "can't", "please", "let's", "not", "never", "always", "also", "just", "usually", "often", "i'll", "we'll", "you'll", "they'll"]);
const NOUN_CUE = new Set(["a", "an", "the", "my", "your", "our", "this", "that", "his", "her", "its", "their", "these", "those", "some", "any", "no", "every", "each", "new", "old", "big", "small", "first", "last", "next"]);
function heteronym(word, prev, next, sentence) {
  const k = word.toLowerCase(); if (!own(HET, k)) return null;
  const p = (prev || "").toLowerCase(), n = (next || "").toLowerCase();
  if (k === "used" && n === "to") return parse("Y UW1 S T");
  const h = HET[k];
  let form = h.def;
  if (NOUN_CUE.has(p)) form = "noun"; else if (VERB_CUE.has(p)) form = "verb";
  if (/^(uses|lives|records|projects|updates)$/.test(k) && NOUN_CUE.has(p)) form = "noun";
  if (k === "live" && /^(demo|show|music|stream|event|session|version|site|data|coding|call)$/.test(n)) form = "noun"; // a live demo
  return parse(h[form]);
}
function readTense(prev, sentence) { // "read": present /rid/ by default, past /rɛd/ after have/has/had or with past-time words
  const p = (prev || "").toLowerCase();
  if (/^(have|has|had|i've|we've|you've|they've)$/.test(p) || /\b(yesterday|ago|last|already)\b/i.test(sentence)) return parse("R EH1 D");
  return parse("R IY1 D");
}

// Acronyms read letter by letter: every letter keeps its vowel, the last one carries the main stress.
const LETTERS = { a: "EY1", b: "B IY1", c: "S IY1", d: "D IY1", e: "IY1", f: "EH1 F", g: "JH IY1", h: "EY1 CH", i: "AY1", j: "JH EY1", k: "K EY1", l: "EH1 L", m: "EH1 M", n: "EH1 N", o: "OW1", p: "P IY1", q: "K Y UW1", r: "AA1 R", s: "EH1 S", t: "T IY1", u: "Y UW1", v: "V IY1", w: "D AH1 B AH0 L Y UW0", x: "EH1 K S", y: "W AY1", z: "Z IY1" };
function acronymPhones(word) {
  const parts = word.toLowerCase().split("").filter(c => own(LETTERS, c)).map(c => parse(LETTERS[c]));
  parts.forEach((ph, i) => { ph.forEach(x => { if (x.v && x.s === 1) x.s = i === parts.length - 1 ? 1 : 2; }); if (i > 0) ph[0].lb = true; });
  return parts.flat();
}
const KNOWN_ACRONYMS = new Set(["api", "apis", "sql", "erp", "crm", "aws", "gcp", "cpu", "gpu", "ui", "ux", "pdf", "url", "http", "https", "html", "css", "it", "ai", "qa", "hr", "ceo", "cto", "cfo", "kpi", "sla", "ssd", "vpn", "dns", "ip", "id", "usb", "faq", "pr", "sap", "tv", "us", "usa", "uk", "eu", "llm", "ibm", "hp", "pc", "sdk", "ide", "cli", "ssh", "tcp", "udp", "ftp", "xml", "csv", "bi", "ml"]);

// ---------- 3. connected speech ----------
// Standard weak forms (Cambridge / Longman, American): used when the word is unstressed inside the phrase.
const WEAK = {
  a: { c: "AH0", v: "AH0" }, an: { c: "AH0 N", v: "AH0 N" },
  the: { c: "DH AH0", v: "DH IY0" }, to: { c: "T AH0", v: "T UW0" },
  for: { c: "F ER0", v: "F ER0" }, of: { c: "AH0 V", v: "AH0 V" },
  and: { c: "AH0 N", v: "AH0 N D" }, can: { c: "K AH0 N", v: "K AH0 N" },
  at: { c: "AH0 T", v: "AH0 T" }, from: { c: "F R AH0 M", v: "F R AH0 M" },
  was: { c: "W AH0 Z", v: "W AH0 Z" }, were: { c: "W ER0", v: "W ER0" },
  are: { c: "ER0", v: "ER0" }, as: { c: "AH0 Z", v: "AH0 Z" },
  than: { c: "DH AH0 N", v: "DH AH0 N" }, them: { c: "DH AH0 M", v: "DH AH0 M" },
  but: { c: "B AH0 T", v: "B AH0 T" }, or: { c: "ER0", v: "ER0" }, your: { c: "Y ER0", v: "Y ER0" }
};
const AUX_WEAK = new Set(["can", "was", "were", "are", "as"]);
// words that do not take sentence stress (shown in lowercase); everything else of one syllable is a content word
const FUNCTION_WORDS = new Set(["a", "an", "the", "to", "for", "of", "and", "or", "but", "at", "from", "in", "on", "by", "with", "as", "than", "that", "this", "these", "those", "is", "am", "are", "was", "were", "be", "been", "being", "do", "does", "did", "have", "has", "had", "can", "could", "will", "would", "shall", "should", "may", "might", "must", "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them", "my", "your", "his", "its", "our", "their", "i'm", "you're", "he's", "she's", "it's", "we're", "they're", "i've", "we've", "you've", "they've", "i'll", "you'll", "we'll", "they'll", "i'd", "you'd", "there", "if", "so", "up", "out", "some", "any", "just", "then", "when", "which", "who"]);
const startsWithVowel = (w) => (w.ph ? w.ph.length && w.ph[0].v : /^[aeiou]/i.test(w.spoken || w.text || ""));
const endsWithCons = (ph) => ph && ph.length && !ph[ph.length - 1].v;

function connectedSpeech(words) {
  for (let i = 0; i < words.length; i++) {
    const w = words[i], next = words[i + 1];
    if (!w.ph) continue;
    const key = (w.spoken || w.text).toLowerCase();
    if (!own(WEAK, key) || w.src === "acronym") continue;
    // strong at the end of a phrase ("What are you looking for?"), except object pronouns ("Tell them.")
    let strong = (!next || w.pause) && key !== "them";
    if (key === "can" && next && /^(not)$/i.test(next.text)) strong = true;
    if (AUX_WEAK.has(key) && next && /^(and|or|but)$/i.test(next.text)) strong = true; // "we can and we will"
    if (strong) continue;
    w.ph = parse(next && startsWithVowel(next) ? WEAK[key].v : WEAK[key].c); w.weak = true;
  }
  for (let i = 0; i < words.length; i++) {
    const w = words[i], next = words[i + 1];
    if (!w.ph) continue;
    const ph = w.ph;
    // flap inside the word: T/D after a vowel, before an unstressed vowel (water, city, better, data, body),
    // but not after an R-colored vowel ("far-ra" would be read with a strong Brazilian rr)
    // and not before a syllabic n (button, student, didn't: American English uses [t]/a glottal stop there, never a flap)
    for (let k = 1; k < ph.length - 1; k++) {
      const syllabicN = ph[k + 1].p === "AH" && ph[k + 1].s === 0 && ph[k + 2] && ph[k + 2].p === "N" && !(ph[k + 3] && ph[k + 3].v);
      if ((ph[k].p === "T" || ph[k].p === "D") && !ph[k].mb && !ph[k].lb && ph[k - 1].v && ph[k - 1].p !== "ER" && ph[k + 1].v && ph[k + 1].s === 0 && !syllabicN) ph[k] = { p: "DX", v: false, flap: ph[k].p };
    }
    // across words, inside the same breath group
    if (next && next.ph && !w.pause) {
      const last = ph[ph.length - 1], prev = ph[ph.length - 2];
      if (startsWithVowel(next) && endsWithCons(ph)) {
        w.link = true; // consonant + vowel: said together ("check it out")
        if (last.p === "T" && prev && prev.v && prev.p !== "ER") ph[ph.length - 1] = { p: "DX", v: false, flap: "T" }; // "get it", "what about"
      }
    }
  }
}

// ---------- 4. syllables ----------
const ONSETS = new Set([
  ...[...CONS].filter(c => c !== "NG"), "DX",
  "P L", "P R", "B L", "B R", "T R", "D R", "K L", "K R", "G L", "G R", "F L", "F R", "TH R", "SH R",
  "S P", "S T", "S K", "S M", "S N", "S L", "S W", "S F", "S P L", "S P R", "S T R", "S K R", "S K W",
  "T W", "D W", "K W", "G W", "TH W", "P Y", "B Y", "K Y", "G Y", "M Y", "F Y", "V Y", "HH Y", "S K Y", "S P Y"
]);
function syllabify(ph, forReading) {
  const vIdx = ph.map((x, i) => (x.v ? i : -1)).filter(i => i >= 0);
  if (!vIdx.length) return [{ ph, s: 0 }];
  const sylls = [];
  let start = 0;
  for (let n = 0; n < vIdx.length; n++) {
    const v = vIdx[n], nextV = vIdx[n + 1];
    let end;
    if (nextV === undefined) end = ph.length;
    else {
      const cluster = ph.slice(v + 1, nextV).map(x => x.p);
      let onsetLen = 0;
      for (let k = cluster.length; k >= 0; k--) { const tail = cluster.slice(cluster.length - k).join(" "); if (k === 0 || ONSETS.has(tail)) { onsetLen = k; break; } }
      // a hard boundary (next letter of an acronym, prefix + base) fixes where the syllable starts
      const between = ph.slice(v + 1, nextV); const hb = between.map(x => !!(x.lb || x.mb)).lastIndexOf(true);
      if (hb >= 0) onsetLen = between.length - hb;
      // for reading: "s" + consonant in the middle of a word closes the previous syllable (IÉS-tar-dêi, ris-TÁRT),
      // because a Brazilian reading "IÉ-star" tends to insert an extra "i" before the s. The IPA keeps English syllables.
      if (forReading && onsetLen >= 2 && cluster[cluster.length - onsetLen] === "S") onsetLen -= 1;
      end = nextV - onsetLen;
    }
    sylls.push({ ph: ph.slice(start, end), s: ph[v].s });
    start = end;
  }
  return sylls;
}

// ---------- 5a. IPA ----------
const IPA = { AA: "ɑ", AE: "æ", AO: "ɔ", AW: "aʊ", AY: "aɪ", EH: "ɛ", EY: "eɪ", IH: "ɪ", IY: "i", OW: "oʊ", OY: "ɔɪ", UH: "ʊ", UW: "u",
  B: "b", CH: "tʃ", D: "d", DH: "ð", F: "f", G: "ɡ", HH: "h", JH: "dʒ", K: "k", L: "l", M: "m", N: "n", NG: "ŋ", P: "p", R: "ɹ", S: "s", SH: "ʃ", T: "t", TH: "θ", V: "v", W: "w", Y: "j", Z: "z", ZH: "ʒ", DX: "ɾ" };
function phoneIPA(x) {
  if (x.p === "AH") return x.s === 0 ? "ə" : "ʌ";
  if (x.p === "ER") return x.s === 0 ? "ɚ" : "ɝ";
  return IPA[x.p];
}
function wordIPA(sylls, sentenceStress) {
  const multi = sylls.length > 1;
  return (sentenceStress && !multi ? "ˈ" : "") + sylls.map(sy => (multi && sy.s === 1 ? "ˈ" : multi && sy.s === 2 ? "ˌ" : "") + sy.ph.map(phoneIPA).join("")).join("");
}

// ---------- 5b. respelling for Brazilians ----------
// Each phoneme maps to Portuguese spelling read the Brazilian way; sounds Portuguese lacks keep a tag (sp)
// so the page can mark them and explain them instead of silently replacing them.
function vowelSeg(x) {
  const st = x.s > 0;
  switch (x.p) {
    case "AA": return { t: st ? "á" : "a" };
    case "AE": return { t: "é", sp: "æ" };
    case "AH": return st ? { t: "â", sp: "ʌ" } : { t: "a" };
    case "AO": return { t: "ó" };
    case "AW": return { t: "áu" };
    case "AY": return { t: "ái" };
    case "OY": return { t: "ói" };
    case "EH": return { t: "é" };
    case "ER": return st ? { t: "âr", sp: "ɝ" } : { t: "ar", sp: "ɚ" };
    case "EY": return { t: "êi" };
    case "IH": return st ? { t: "i", sp: "ɪ" } : { t: "i" };
    case "IY": return { t: st ? "í" : "i" };
    case "OW": return { t: "ôu" };
    case "UH": return { t: "u", sp: "ʊ" };
    case "UW": return { t: st ? "ú" : "u" };
  }
  return { t: "?" };
}
const FRONT_START = /^[eéêiíEÉÊIÍ]/;
function respellWord(sylls, upperMono, noStress) {
  const mono = sylls.length === 1;
  const all = sylls.flatMap(sy => sy.ph);
  const out = [];
  let gi = 0;
  sylls.forEach((sy) => {
    const segs = [];
    sy.ph.forEach((x) => {
      const i = gi++, prev = all[i - 1], next = all[i + 1];
      if (x.v) { const vs = vowelSeg(x); if (mono && x.p === "AH" && x.s === 0) vs.t = "â"; segs.push(vs); return; }
      const nextVowelText = next && next.v ? vowelSeg(next).t : "";
      let seg;
      switch (x.p) {
        case "TH": seg = { t: "th", sp: "θ" }; break;
        case "DH": seg = { t: "dh", sp: "ð" }; break;
        case "R": seg = { t: "r", sp: "ɹ" }; break;
        case "DX": seg = { t: "r", sp: "ɾ" }; break;
        case "HH": seg = { t: "rr", sp: "h" }; break;
        case "NG": seg = next && (next.p === "K" || next.p === "G") ? { t: "n" } : { t: "ng", sp: "ŋ" }; break;
        case "SH": seg = { t: "ch" }; break;
        case "ZH": seg = { t: "j" }; break;
        case "CH": seg = { t: "tch" }; break;
        case "JH": seg = { t: "dj" }; break;
        // w before i/u sounds, or after g: Portuguese "ui"/"uu"/"gui" would be read without the w (muito, gui)
        case "W": seg = { t: (next && ["IH", "IY", "UH", "UW"].includes(next.p)) || (prev && prev.p === "G") ? "w" : "u" }; break;
        case "Y": seg = { t: "i" }; break;
        case "K": seg = { t: "k" }; break;
        case "G": seg = { t: FRONT_START.test(nextVowelText) || (next && next.p === "Y") ? "gu" : "g" }; break; // "gi" would be read "ji"
        case "S": seg = { t: prev && prev.v && prev.p !== "ER" && next && next.v ? "ss" : "s" }; break;
        case "L": seg = next && next.v ? { t: "l" } : { t: "l", sp: "ɫ" }; break; // dark L: never "u"
        default: seg = { t: x.p.toLowerCase() };
      }
      // m/n closing a syllable: Brazilians turn the vowel nasal and drop the consonant ("tem" -> tẽi)
      if ((x.p === "M" || x.p === "N") && !(next && next.v)) seg.sp = seg.sp || "nas";
      // T/D before an "i" sound: Brazilians would say "tchi/dji"
      if ((x.p === "T" || x.p === "D") && next && (next.p === "IH" || next.p === "IY")) seg.sp = seg.sp || "td";
      // initial S + consonant: Brazilians add an "i" before it ("iscul")
      if (x.p === "S" && i === 0 && next && !next.v) seg.sp = seg.sp || "sC";
      // word-final consonant: no extra "i" after it
      if (i === all.length - 1 && !["R", "L", "DX", "M", "N"].includes(x.p)) seg.fin = true;
      segs.push(seg);
    });
    const stressed = !noStress && ((sylls.length > 1 && sy.s === 1) || (mono && upperMono));
    out.push({ s: sy.s, stressed, segs: stressed ? segs.map(g => Object.assign({}, g, { t: g.t.toUpperCase() })) : segs });
  });
  return out;
}

// ---------- tips (fixed text, written for Brazilian learners) ----------
const TIPS = {
  "θ": "TH sem voz: ponta da língua entre os dentes, soltando o ar. Não troque por t, f ou s.",
  "ð": "TH com voz: língua entre os dentes, vibrando. Não troque por d nem por z.",
  "ɹ": "R americano: dobre a ponta da língua para trás, sem encostar no céu da boca. Nunca como o rr de \"rato\", nem como o r de \"caro\".",
  "ɾ": "Este T/D vira um toque rápido da língua, igual ao r de \"caro\". É assim no inglês americano (water, better, get it).",
  "æ": "Vogal entre é e á: abra bem a boca. É o que diferencia bad de bed.",
  "ʌ": "â curto e relaxado, como o último a de \"casa\".",
  "ɝ": "Vogal com R americano: a língua já fica na posição do R durante a vogal inteira; não diga a + r separados.",
  "ɚ": "Final com R americano, fraco: a língua já vai para a posição do R; não diga \"ar\" com a aberto.",
  "ɪ": "i curto e relaxado, entre i e ê. É o que diferencia ship de sheep.",
  "ʊ": "u curto e relaxado, com os lábios menos arredondados (good, book).",
  "h": "H inglês: só um sopro de ar, bem leve, como um rr de \"rato\" muito suave.",
  "ŋ": "NG: som nasal no fundo da boca; não pronuncie um g no final.",
  "ɫ": "L no fim da sílaba: mantenha a ponta da língua encostada atrás dos dentes de cima. Não transforme em u.",
  "nas": "M/N no fim da sílaba: feche os lábios no m, encoste a língua atrás dos dentes no n. Não deixe só a vogal nasal (them não é \"dhẽi\").",
  "td": "T/D antes de i: som puro de t/d, sem virar \"tchi\" ou \"dji\".",
  "sC": "Comece direto no s, sem colocar i antes (school, não \"iscul\").",
  "fin": "Termine na consoante: sem acrescentar i no final (bug, não \"bâgui\").",
  "weak": "Forma fraca: dentro da frase esta palavra é dita rápida, sem força.",
  "link": "Ligação: a consoante final se junta à vogal da palavra seguinte, sem pausa."
};
// How hard each feature is for a Brazilian beginner (used only to pick the 1-3 words to highlight).
// Small, very common details count little so they do not flood the highlight.
const WEIGHT = { "θ": 3, "ð": 3, "ɹ": 2, "æ": 2, "ɝ": 2, "sC": 2, "ʊ": 1.5, "ɚ": 1, "ɪ": 0.5, "ʌ": 1, "h": 1, "ŋ": 1, "ɫ": 1, "nas": 0.5, "td": 0.5, "ɾ": 0.5, "fin": 0 };

// ---------- assemble ----------
function buildWords(text) {
  const toks = tokenize(text);
  const words = [];
  const pushNumber = (raw, spoken, pause) => {
    if (!spoken) { words.push({ text: raw, pause, src: "missing", numberFail: true }); return; }
    spoken.forEach((nw, k) => words.push({ text: k === 0 ? raw : "", spoken: nw, pause: k === spoken.length - 1 ? pause : false, part: k > 0 }));
  };
  for (const tok of toks) {
    const raw = tok.text;
    if (/^\$?\d/.test(raw) && /^\$?\d+(,\d{3})*(\.\d+)?%?$|^\d+(st|nd|rd|th)$/i.test(raw)) { pushNumber(raw, spokenNumber(raw), tok.pause); continue; }
    // letters and digits glued together: 5G, MP3, 6pm
    const mixed = raw.match(/^(\d+)([A-Za-z]{1,3})$|^([A-Za-z]{1,3})(\d+)$/);
    if (mixed) {
      const [num, let_] = mixed[1] ? [mixed[1], mixed[2]] : [mixed[4], mixed[3]];
      const numW = numberWords(Number(num)) || [];
      const parts = mixed[1] ? [...numW.map(n => ({ spoken: n })), { letters: let_ }] : [{ letters: let_ }, ...numW.map(n => ({ spoken: n }))];
      parts.forEach((p, k) => words.push({ text: k === 0 ? raw : "", spoken: p.spoken, letters: p.letters, pause: k === parts.length - 1 ? tok.pause : false, part: k > 0 }));
      continue;
    }
    if (raw.includes("-") && !lookupWord(raw)) {
      // a written prefix keeps its boundary (re-deploy: no flap between re- and deploy)
      const pm = raw.match(/^(re|pre|co|de|non|un|multi)-(.+)$/i);
      const PREFIX = { re: "R IY2", pre: "P R IY2", co: "K OW2", de: "D IY2", non: "N AA2 N", un: "AH2 N", multi: "M AH2 L T IY0" };
      if (pm && lookupWord(pm[2])) { words.push({ text: raw, prefix: PREFIX[pm[1].toLowerCase()], spoken: pm[2], pause: tok.pause }); continue; }
      const joined = raw.replace(/-/g, "");
      if (lookupWord(joined)) { words.push({ text: raw, spoken: joined, pause: tok.pause }); continue; } // front-end -> frontend
      const parts = raw.split("-").filter(Boolean);
      parts.forEach((p, k) => {
        if (/^\d+$/.test(p)) pushNumber(k === 0 ? p : "", spokenNumber(p), k === parts.length - 1 ? tok.pause : false);
        else words.push({ text: p, pause: k === parts.length - 1 ? tok.pause : false });
      });
      continue;
    }
    words.push({ text: raw, pause: tok.pause });
  }
  // ALL-CAPS text ("THE SERVER IS DOWN") is shouting, not a row of acronyms
  const lettered = words.filter(w => /[A-Za-z]{2,}/.test(w.text || ""));
  const shouting = lettered.length >= 2 && lettered.filter(w => /^[A-Z][A-Z'\-]+$/.test(w.text)).length / lettered.length >= 0.5;
  const sentence = String(text || "");
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.src === "missing") continue;
    if (w.letters) { w.ph = acronymPhones(w.letters); w.src = "acronym"; continue; }
    const t = w.spoken || w.text;
    const low = t.toLowerCase(), base = low.replace(/s$/, "");
    const prevW = words[i - 1], nextW = words[i + 1];
    // single capital letter used as a letter: "Plan A", "option B" (not the pronoun I, not the article starting a sentence)
    if (/^[B-HJ-Z]$/.test(w.text) || (w.text === "A" && !shouting && prevW && !prevW.pause && /[a-z]/.test(prevW.text || ""))) { w.ph = acronymPhones(w.text); w.src = "acronym"; continue; }
    const allCaps = !w.spoken && /^[A-Z]{2,6}s?$/.test(w.text);
    const acronym = allCaps && !own(OVERRIDES, low) && (
      shouting ? ((KNOWN_ACRONYMS.has(low) && !/^(it|us|id)$/.test(low)) || !lookupWord(low))
               : (KNOWN_ACRONYMS.has(low) || KNOWN_ACRONYMS.has(base) || !lookupWord(low)));
    if (acronym) {
      const b = KNOWN_ACRONYMS.has(base) && !KNOWN_ACRONYMS.has(low) ? base : low;
      w.ph = acronymPhones(b); if (b !== low) w.ph = addSuffix(w.ph, "S"); w.src = "acronym"; continue;
    }
    if (low === "read") { w.ph = readTense(prevW && (prevW.spoken || prevW.text), sentence); w.src = "dict"; continue; }
    const het = heteronym(t, prevW && (prevW.spoken || prevW.text), nextW && (nextW.spoken || nextW.text), sentence);
    if (het) { w.ph = het; w.src = "dict"; continue; }
    const r = lookupWord(t);
    if (r) { if (w.prefix) { r.ph[0].mb = true; w.ph = parse(w.prefix).concat(r.ph); } else w.ph = r.ph; w.src = r.src; } else { w.ph = null; w.src = "missing"; }
  }
  return words;
}

function analyze(text, extra) {
  const empty = { dialect: "en-US", text: String(text == null ? "" : text), words: [], missing: [], ipa: "", say: "", tips: {} };
  if (text == null || !String(text).trim()) return empty;
  const words = buildWords(text);
  // extra: { word(lowercase): "ARPABET" } supplied for missing words (estimated, e.g. by an AI with validation)
  if (extra) for (const w of words) if (!w.ph && !w.numberFail) { const k = (w.spoken || w.text || "").toLowerCase(); const a = own(extra, k) && extra[k]; if (a && validArpabet(a)) { w.ph = parse(a); w.src = "estimated"; } }
  connectedSpeech(words);
  const result = { dialect: "en-US", text: String(text), words: [], missing: [] };
  const multiWord = words.length > 1;
  words.forEach((w) => {
    const display = w.text || "";
    if (!w.ph) { result.missing.push(w.spoken || w.text); result.words.push({ w: display, src: "missing", pause: !!w.pause }); return; }
    const key = (w.spoken || w.text || "").toLowerCase();
    const englishSylls = syllabify(w.ph, false);      // English syllables: used for IPA and stress marks
    const readingSylls = syllabify(w.ph, true);       // syllables a Brazilian reads naturally: used for the respelling
    const contentMono = multiWord && englishSylls.length === 1 && !w.weak && !FUNCTION_WORDS.has(key) && w.src !== "acronym" && englishSylls[0].s > 0;
    const syl = respellWord(readingSylls, contentMono, multiWord && FUNCTION_WORDS.has(key));
    const tags = new Set();
    syl.forEach(sy => sy.segs.forEach(g => { if (g.sp) tags.add(g.sp); if (g.fin) tags.add("fin"); }));
    if (w.weak) tags.add("weak");
    if (w.link) tags.add("link");
    let weight = 0; tags.forEach(t => { weight += WEIGHT[t] || 0; });
    if (w.weak) weight = Math.min(weight, 1);
    result.words.push({
      w: display, part: !!w.part, src: w.src, weak: !!w.weak, link: !!w.link, pause: !!w.pause,
      ipa: wordIPA(englishSylls, contentMono), say: syl.map(sy => sy.segs.map(g => g.t).join("")).join("-"),
      syl: syl.map(sy => ({ stressed: sy.stressed, segs: sy.segs })),
      tags: [...tags], weight
    });
  });
  // the hardest words of the phrase (at most 3, only clearly difficult ones)
  result.words.map((w, i) => ({ i, wt: w.weight || 0 })).filter(x => x.wt >= 3).sort((a, b) => b.wt - a.wt).slice(0, 3).forEach(x => { result.words[x.i].hard = true; });
  const joinWith = (key) => {
    const ws = result.words.filter(w => w[key]);
    return ws.map((w, i) => w[key] + (i === ws.length - 1 ? "" : w.link ? "‿" : w.pause ? " | " : " ")).join("");
  };
  result.ipa = result.words.some(w => w.ipa) ? "/" + joinWith("ipa") + "/" : "";
  result.say = joinWith("say");
  const used = new Set(); result.words.forEach(w => (w.tags || []).forEach(t => used.add(t)));
  result.tips = {}; used.forEach(t => { if (TIPS[t]) result.tips[t] = TIPS[t]; });
  return result;
}

// spoken form of a text for comparing with a transcript (contractions, numbers, hyphens, spelling variants)
function spokenWords(text) {
  return buildWords(String(text || "")).map(w => (w.spoken || w.text || "")).filter(Boolean).flatMap(t => {
    const x = t.toLowerCase().replace(/'/g, "'");
    const C = { "i'm": "i am", "it's": "it is", "that's": "that is", "what's": "what is", "let's": "let us", "don't": "do not", "doesn't": "does not", "didn't": "did not", "can't": "can not", "cannot": "can not", "won't": "will not", "isn't": "is not", "aren't": "are not", "wasn't": "was not", "i've": "i have", "we've": "we have", "you're": "you are", "we're": "we are", "they're": "they are", "i'll": "i will", "we'll": "we will", "you'll": "you will", "i'd": "i would", "okay": "ok", "email": "email", "e-mail": "email" };
    return (C[x] || x.replace(/-/g, "")).split(" ");
  });
}

module.exports = { analyze, spokenWords, validArpabet, ARPABET_SYMBOLS, TIPS, _internal: { lookupWord, syllabify, tokenize, parse, spokenNumber } };
