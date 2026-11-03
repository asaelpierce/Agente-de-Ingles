// Regression tests for the pronunciation engine. Run: node tests/pron.test.js
const assert = require("assert");
const { analyze, _internal } = require("../lib/pron/engine");

// 1) phrases with reference General American IPA (dictionary forms + standard connected speech)
const GOLD = [
  ["I fixed the bug yesterday.", "/aɪ ˈfɪkst ðə ˈbʌɡ ˈjɛstɚˌdeɪ/"],
  ["We need to restart the server tonight.", "/wi ˈnid tə ɹiˈstɑɹt ðə ˈsɝvɚ təˈnaɪt/"],
  ["Check it out.", "/ˈtʃɛk‿ɪɾ‿aʊt/"],
  ["The water is better than the coffee.", "/ðə ˈwɔɾɚ ɪz ˈbɛɾɚ ðən ðə ˈkɑfi/"],
  ["Thank you very much!", "/ˈθæŋk ju ˈvɛɹi ˈmʌtʃ/"],
  ["Where are you from?", "/ˈwɛɹ‿ɚ ju fɹʌm/"],
  ["This is the third time this Thursday.", "/ðɪs‿ɪz ðə ˈθɝd ˈtaɪm ðɪs ˈθɝzˌdeɪ/"],
  ["Ship or sheep? Bad or bed?", "/ˈʃɪp‿ɚ ˈʃip | ˈbæd‿ɚ ˈbɛd/"],
  ["Hello, how are you?", "/həˈloʊ | ˈhaʊ ɚ ju/"],
  ["Put the data in the cache and the queue.", "/ˈpʊt ðə ˈdeɪɾə ɪn ðə ˈkæʃ‿ən ðə ˈkju/"],
  ["That's a mistake.", "/ˈðæts‿ə mɪˈsteɪk/"],
  ["Brazil has good people.", "/bɹəˈzɪl hæz ˈɡʊd ˈpipəl/"],
  ["Send me an email.", "/ˈsɛnd mi ən‿ˈiˌmeɪl/"],
  ["The router is in the IT room.", "/ðə ˈɹaʊɾɚ ɪz‿ɪn ði ˌaɪˈti ˈɹum/"],
  ["I'm working on the backend.", "/aɪm ˈwɝkɪŋ‿ɑn ðə ˈbæˌkɛnd/"],
  // context-dependent pronunciations
  ["I live in Brazil.", "/aɪ ˈlɪv‿ɪn bɹəˈzɪl/"],
  ["We have a live demo today.", "/wi hæv‿ə ˈlaɪv ˈdɛmoʊ təˈdeɪ/"],
  ["Can I use your laptop?", "/kən‿aɪ ˈjuz jɚ ˈlæpˌtɑp/"],
  ["Close the door.", "/ˈkloʊz ðə ˈdɔɹ/"],
  ["This is a record.", "/ðɪs‿ɪz‿ə ˈɹɛkɚd/"],
  ["Let me present my project.", "/ˈlɛt mi pɹiˈzɛnt maɪ ˈpɹɑdʒɛkt/"],
  ["I read a book every day.", "/aɪ ˈɹid‿ə ˈbʊk‿ˈɛvɚi ˈdeɪ/"],
  ["I read it yesterday.", "/aɪ ˈɹɛd‿ɪt ˈjɛstɚˌdeɪ/"],
  // no flap before syllabic n; object pronoun stays weak at the end
  ["I didn't see the button.", "/aɪ ˈdɪdənt ˈsi ðə ˈbʌtən/"],
  ["Tell them.", "/ˈtɛl ðəm/"],
  ["It's regular.", "/ɪts ˈɹɛɡjəlɚ/"],
  // caps, acronyms, numbers, prefixes
  ["THE SERVER IS DOWN.", "/ðə ˈsɝvɚ ɪz ˈdaʊn/"],
  ["We use SQL.", "/wi ˈjuz‿ˌɛsˌkjuˈɛl/"],
  ["It costs $1,500.", "/ɪt ˈkɑsts ˈwʌn ˈθaʊzənd ˈfaɪv ˈhʌndɹəd ˈdɑlɚz/"],
  ["About 3.5% more.", "/əˈbaʊt ˈθɹi ˈpɔɪnt ˈfaɪv pɚˈsɛnt ˈmɔɹ/"],
  ["In 2026.", "/ɪn ˈtwɛnti ˈtwɛnti ˈsɪks/"],
  ["The 21st floor.", "/ðə ˈtwɛnti ˈfɝst ˈflɔɹ/"],
  ["Plan A or plan B?", "/ˈplæn‿eɪ ɚ ˈplæn bi/"],
  ["We need to re-deploy it.", "/wi ˈnid tə ˌɹidɪˈplɔɪ ɪt/"],
  ["We can and we will.", "/wi kæn‿ən wi wɪl/"],
  ["Thirty days.", "/ˈθɝti ˈdeɪz/"],
];
let fail = 0;
for (const [text, ipa] of GOLD) {
  const r = analyze(text);
  try { assert.strictEqual(r.ipa, ipa); } catch (e) { fail++; console.log("IPA  ✗", text, "\n     got     ", r.ipa, "\n     expected", ipa); }
}

// 2) respelling rules that must hold
const say = (t) => analyze(t).say;
const checks = [
  ["the before consonant keeps TH (never 'dâ')", () => assert.strictEqual(say("the bug").split(" ")[0], "dhâ")],
  ["the before vowel", () => assert.strictEqual(say("the API").split(" ")[0], "dhi")],
  ["final L is not turned into u", () => assert.ok(!/pou$|PÍ-pou/.test(say("people")) && /l$/.test(say("people")))],
  ["TH voiceless kept", () => assert.ok(/^thénk/.test(say("thank")))],
  ["American R flagged, not rr", () => { const w = analyze("run").words[0]; assert.ok(w.syl[0].segs[0].sp === "ɹ"); }],
  ["H is rr (breath) and flagged", () => assert.strictEqual(analyze("help").words[0].syl[0].segs[0].sp, "h")],
  ["/æ/ flagged so bad ≠ bed", () => { assert.ok(analyze("bad").words[0].tags.includes("æ")); assert.ok(!analyze("bed").words[0].tags.includes("æ")); }],
  ["/ɪ/ vs /i/: ship vs sheep differ", () => assert.notStrictEqual(say("ship"), say("sheep"))],
  ["flap in water/city", () => { assert.strictEqual(say("water"), "UÓ-rar"); assert.strictEqual(say("city"), "SI-ri"); }],
  ["no flap after r-colored vowel", () => assert.ok(/far-ta/.test(say("comfortable")))],
  ["weak form stranded at the end is strong", () => assert.ok(/frâm$/.test(say("Where are you from?"))) ],
  ["can not reduced before not", () => assert.ok(!analyze("I can not go").words[1].weak)],
  ["-ed allomorphs", () => { assert.ok(/fikst$/.test(say("fixed"))); assert.ok(/PLÓID$/.test(say("deployed"))); assert.ok(/tid$/.test(say("started"))); }],
  ["acronyms as letters", () => assert.strictEqual(say("SQL"), "és-kiú-ÉL")],
  ["numbers spelled out", () => assert.ok(/thrí/.test(say("3")))],
  ["unknown words are reported, never invented", () => { const r = analyze("zxqvtrw"); assert.deepStrictEqual(r.missing, ["zxqvtrw"]); assert.ok(!r.words[0].say); }],
  ["s+consonant start flagged", () => assert.ok(analyze("school").words[0].tags.includes("sC"))],
  // found in the phonetic review
  ["never crashes on object-property words", () => { for (const t of ["constructor", "toString", "hasOwnProperty", "__proto__", "gdp", "hiv"]) analyze(t); }],
  ["empty and null input", () => { assert.strictEqual(analyze("").ipa, ""); assert.strictEqual(analyze(null).words.length, 0); }],
  ["final m/n flagged (no nasal vowel)", () => { assert.ok(analyze("them").words[0].tags.includes("nas")); assert.ok(analyze("ten").words[0].tags.includes("nas")); }],
  ["w before i/u written w (with, will, would)", () => { assert.strictEqual(say("with"), "widh"); assert.strictEqual(say("would"), "wud"); }],
  ["g before y written gu (regular)", () => assert.ok(/RÉ-guia/.test(say("regular")))],
  ["no ss after r-colored vowel", () => assert.ok(!/rss|RSS/.test(say("percent versus"))) ],
  ["numbers: nothing dropped silently", () => { const r = analyze("1000000 users"); assert.ok(/mɪljən/.test(r.ipa)); assert.ok(analyze("1000000000000").missing.length === 1); }],
  ["pauses shown", () => assert.ok(/\|/.test(analyze("Hello, how are you?").say))],
];
for (const [name, fn] of checks) { try { fn(); } catch (e) { fail++; console.log("RULE ✗", name, "→", e.message); } }

// 3) every difficult sound in 5000 dictionary words comes out tagged (never silently replaced)
const fs = require("fs"), zlib = require("zlib"), path = require("path");
const lines = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, "../lib/pron/cmudict.txt.gz"))).toString().split("\n").filter(Boolean);
let checked = 0, untagged = [];
for (let i = 0; i < lines.length && checked < 5000; i += 25) {
  const [word, arpa] = lines[i].split("\t"); if (!/^[a-z]+$/.test(word)) continue;
  const r = analyze(word); const w = r.words[0]; if (!w || !w.syl) continue; checked++;
  const segs = w.syl.flatMap(s => s.segs);
  const need = { TH: "θ", DH: "ð", R: "ɹ", AE: "æ", HH: "h" };
  for (const [ph, sp] of Object.entries(need)) if (new RegExp("\\b" + ph + "\\d?\\b").test(arpa) && !segs.some(g => g.sp === sp || (sp === "ɹ" && g.sp === "ɾ"))) untagged.push(word + " (" + ph + ")");
  if (segs.some(g => /pou$/.test(g.t))) untagged.push(word + " (L→u)");
}
if (untagged.length) { fail++; console.log("TAG  ✗", untagged.length, "palavras com som difícil sem marcação, ex.:", untagged.slice(0, 8).join(", ")); }
console.log(`\n${GOLD.length} frases IPA + ${checks.length} regras + ${checked} palavras do dicionário verificadas — ${fail ? fail + " falha(s)" : "tudo certo"}`);
process.exit(fail ? 1 : 0);
