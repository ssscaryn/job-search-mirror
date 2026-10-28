/* ==========================================================================
   Mini app layer: storage, the AI bridge, backup, and the interview loop.
   Everything stays in this browser. Nothing here talks to a server.
   ========================================================================== */

/* ---------- storage: IndexedDB, falling back to memory ---------- */
// One object store of key -> value. Keys: tracker, interviews, stories,
// questionsOfMe, questionsByMe, standards, prepCards, offers.
const Store = (() => {
  let dbp = null, memory = {};
  function open(){
    if(dbp) return dbp;
    dbp = new Promise(resolve=>{
      try{
        const req = indexedDB.open("job-search-mirror", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("kv");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      }catch{ resolve(null); }
    });
    return dbp;
  }
  async function get(key, fallback){
    const db = await open();
    if(!db) return key in memory ? memory[key] : fallback;
    return new Promise(resolve=>{
      try{
        const r = db.transaction("kv").objectStore("kv").get(key);
        r.onsuccess = () => resolve(r.result === undefined ? fallback : r.result);
        r.onerror = () => resolve(fallback);
      }catch{ resolve(fallback); }
    });
  }
  async function set(key, value){
    memory[key] = value;
    const db = await open();
    if(!db) return false;
    return new Promise(resolve=>{
      try{
        const tx = db.transaction("kv","readwrite"); tx.objectStore("kv").put(value, key);
        tx.oncomplete = () => resolve(true); tx.onerror = () => resolve(false);
      }catch{ resolve(false); }
    });
  }
  async function all(){
    const keys = ["tracker","interviews","stories","questionsOfMe","questionsByMe","standards","prepCards","offers"];
    const out = {}; for(const k of keys) out[k] = await get(k, null); return out;
  }
  return {get, set, all, persistent: async () => !!(await open())};
})();

const uid = () => Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4);
// The viewer's local date, not UTC: in the evening UTC is already tomorrow.
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };

/* ---------- AI bridge ---------- */
// Inside claude.ai the page asks Claude directly on the viewer's own account.
// Everywhere else it hands the viewer a prompt to paste into any chatbot, then
// files the answer they paste back. Same prompt, same parser, either way.
const AI = (() => {
  let samplePromise = null;
  function claudeSample(){
    if(!samplePromise){
      samplePromise = (typeof window.claude === "object" && window.claude && typeof window.claude.use === "function")
        ? window.claude.use("sample").catch(()=>null) : Promise.resolve(null);
    }
    return samplePromise;
  }
  function parseJSON(text){
    const t = String(text||"").trim();
    try { return JSON.parse(t); } catch {}
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if(fence){ try { return JSON.parse(fence[1]); } catch {} }
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if(a >= 0 && b > a){ try { return JSON.parse(t.slice(a, b+1)); } catch {} }
    return null;
  }
  // Ask for JSON. `title` names the task in the paste dialog.
  async function json(prompt, {title, onStatus, forcePaste, note} = {}){
    if(forcePaste) return pasteDialog(prompt, title, note);
    const sample = await claudeSample();
    if(sample){
      try {
        onStatus && onStatus("Asking Claude on your account. The first time, Claude asks you to allow it.");
        return await sample.json(prompt);
      } catch(e) {
        const code = e && e.code;
        if(code === "cancelled") throw {code};
        if(!["not_granted","sampling_disabled","not_declared","capability_disabled","capability_removed"].includes(code)){
          const msg = code === "rate_limited" ? "Claude is busy or you've hit a usage limit. Try again in a bit, or use copy and paste."
            : code === "prompt_too_large" ? "That transcript is too long to send in one go. Trim it, or use copy and paste."
            : code === "invalid_json" ? "Claude's answer couldn't be read. You can paste it below and fix it, or try again."
            : "Claude didn't finish. You can try again, or use copy and paste below.";
          return pasteDialog(prompt, title, msg, e && e.text);
        }
        // Not allowed in this view: fall through to copy and paste.
      }
    }
    return pasteDialog(prompt, title);
  }
  function pasteDialog(prompt, title, note, prefill){
    return new Promise((resolve, reject)=>{
      const d = $("#aidialog");
      $("#aititle").textContent = title || "Ask your AI";
      $("#ainote").textContent = note || "";
      $("#ainote").hidden = !note;
      $("#aiprompt").value = prompt;
      $("#aianswer").value = prefill || "";
      $("#aierr").textContent = "";
      d.hidden = false; document.body.style.overflow = "hidden";
      const close = () => { d.hidden = true; document.body.style.overflow = ""; cleanup(); };
      const onCopy = async () => {
        try { await navigator.clipboard.writeText(prompt); $("#aicopy").textContent = "Copied"; }
        catch { $("#aiprompt").select(); $("#aicopy").textContent = "Selected: press Copy"; }
        setTimeout(()=>$("#aicopy").textContent = "Copy prompt", 1800);
      };
      const onUse = () => {
        const parsed = parseJSON($("#aianswer").value);
        if(!parsed){ $("#aierr").textContent = "That doesn't look like the JSON the prompt asked for. Paste the whole answer, including the { and } at the start and end."; return; }
        close(); resolve(parsed);
      };
      const onCancel = () => { close(); reject({code:"cancelled"}); };
      const cleanup = () => { $("#aicopy").removeEventListener("click", onCopy); $("#aiuse").removeEventListener("click", onUse); $("#aicancel").removeEventListener("click", onCancel); };
      $("#aicopy").addEventListener("click", onCopy);
      $("#aiuse").addEventListener("click", onUse);
      $("#aicancel").addEventListener("click", onCancel);
    });
  }
  return {json, parseJSON, inClaude: async () => !!(await claudeSample())};
})();

/* ---------- backup: export and import ---------- */
async function exportBackup(){
  const data = {app:"job-search-mirror", version:1, exportedAt:new Date().toISOString(), ...(await Store.all())};
  const text = JSON.stringify(data, null, 1), filename = `job-search-mirror-backup-${today()}.json`;
  const downloads = (typeof window.claude === "object" && window.claude) ? await window.claude.use("downloads").catch(()=>null) : null;
  if(downloads){
    try { await downloads.save({filename, data:text}); flash("Backup saved."); }
    catch(e){ if(e && e.code !== "declined") flash("This view can't save files. Open the page on the web to export."); }
    return;
  }
  const url = URL.createObjectURL(new Blob([text], {type:"application/json"}));
  const a = Object.assign(document.createElement("a"), {href:url, download:filename});
  document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url), 2000);
  flash("Backup downloaded. Keep it somewhere private: it holds your interview notes.");
}
async function importBackup(file){
  try{
    const data = JSON.parse(await file.text());
    if(data.app !== "job-search-mirror") throw new Error("not a backup");
    for(const k of ["tracker","interviews","stories","questionsOfMe","questionsByMe","standards","prepCards","offers"]){
      if(data[k] != null) await Store.set(k, data[k]);
    }
    await App.reload(); flash("Backup restored.");
  }catch{ flash("That file isn't a Job Search Mirror backup."); }
}
function flash(msg){
  const el = $("#flash"); el.textContent = msg; el.hidden = false;
  clearTimeout(flash.t); flash.t = setTimeout(()=>el.hidden = true, 4200);
}

/* ---------- prompts ---------- */
const DEBRIEF_SHAPE = `{
  "company": "string", "role": "string", "round": "Screener | Hiring manager | Panel | Other",
  "attribution_checks": [{"quote": "only the spoken words, copied exactly from the transcript; never rephrased as a question", "guess": "me | interviewer"}],
  "questions_asked_of_me": [{"question": "verbatim", "my_answer": "one or two sentences", "landed": "yes | partly | no", "evidence": "what the interviewer did next", "stronger_answer": "in my voice, under 90 seconds spoken", "story": "title of the story it should use, or empty"}],
  "fell_flat": ["specific moments; never empty"],
  "leaned_in": ["specific moments"],
  "follow_ups": ["proof points to mention in a thank-you note"],
  "voice": "which voice I used (specialist, adjacent field, business, recruiter friendly) and whether it fit",
  "questions_i_asked": [{"question": "verbatim", "their_answer": "short", "what_it_reveals": "about how they work"}],
  "operating_manual": {"priorities": ["..."], "vocabulary": ["their exact words"], "how_they_weigh_risk": "string", "what_failure_looks_like": "string", "first_year_needs": "string"},
  "red_flags": {"interviewers": 0, "possibly_unlawful_questions": ["quoted"], "resume_misstated": ["what they said vs what the resume says"], "scope_changes": ["..."], "other": ["..."]},
  "new_stories": [{"title": "string", "proves": "string", "situation": "string", "action": "string", "result": "string", "sixty_second": "string"}]
}`;

function debriefPrompt({transcript, company, role, round, standards, storyTitles, audioName, corrections}){
  return `You are my interview coach doing a debrief from a transcript. Be my critic before my fan: list what fell flat before anything that went well, and argue the interviewer's side.

Rules:
- Go question by question through every question I was asked.
- AI note takers often credit a line to the wrong speaker. Where you are not sure who said something, add it to attribution_checks with your best guess, and carry on using that guess. Only include lines where the speaker changes the analysis.
- Never infer anyone's gender, race, or age from names or voices.
- "Possibly unlawful" covers questions about age, children or family plans, marital status, religion, national origin, disability or health, pregnancy, or salary history. Quote them. This is a flag, not a legal finding.
- Stronger answers must stay true to my claims below. Do not invent experience, tools, numbers, or titles.
- Write in plain language. No lists of three for rhythm, no "not X but Y" constructions.

Lines labelled "Me" are mine; lines labelled "Interviewer" are theirs. Trust those labels.

What I told you about this interview: company ${company || "(read it from the transcript)"}, role ${role || "(read it from the transcript)"}, round ${round || "(read it from the transcript)"}.

My standards and claims I can defend:
${standards ? standards.slice(0, 6000) : "(none recorded yet)"}

Stories already in my story bank (link answers to these by title where they fit; only add new_stories for genuinely new material):
${storyTitles.length ? storyTitles.map(t=>"- "+t).join("\n") : "(none yet)"}

${corrections && corrections.length ? `I have already confirmed who said these lines. Treat them as fact, and leave attribution_checks empty for them:
${corrections.map(c=> c.mode === "question" ? `- You asked: ${c.quote} My answer: ${c.who}.` : `- "${c.quote}" was said by ${c.who === "me" ? "me" : "the interviewer"}`).join("\n")}

` : ""}Reply with only one JSON object in exactly this shape, no other text:
${DEBRIEF_SHAPE}

${audioName ? `The interview is in the audio file I've attached (${audioName}). Transcribe it yourself first, then do the debrief from your transcript. Audio has no speaker names, so use attribution_checks wherever you are unsure who is speaking.` : `Transcript:
"""
${transcript}
"""`}`;
}

/* ---------- app state + rendering ---------- */
const App = {
  interviews: [], stories: [], questionsOfMe: [], questionsByMe: [], standards: "",
  async reload(){
    this.interviews = await Store.get("interviews", []);
    this.stories = await Store.get("stories", []);
    this.questionsOfMe = await Store.get("questionsOfMe", []);
    this.questionsByMe = await Store.get("questionsByMe", []);
    this.standards = await Store.get("standards", "");
    const tracker = await Store.get("tracker", null);
    if(tracker && Array.isArray(tracker.raw)){ load(tracker.raw, tracker.label, tracker.extras || [], {persist:false, allowEmpty:true}); }
    else if(currentRows.length){ renderWatch(currentRows); }
    renderInterviews(); renderBanks();
    $("#standards").value = this.standards;
  }
};

// Red flags from debriefs, keyed by normalised company, merged into posting watch.
function interviewFlags(){
  const out = {};
  App.interviews.forEach(iv=>{
    const d = iv.debrief || {}, rf = d.red_flags || {}, k = normCo(iv.company || d.company || "");
    if(!k) return;
    const f = out[k] ||= {name: iv.company || d.company, unlawful:[], misstated:[], panel:[], scope:[]};
    (rf.possibly_unlawful_questions||[]).forEach(q=>f.unlawful.push(String(q)));
    (rf.resume_misstated||[]).forEach(q=>f.misstated.push(String(q)));
    (rf.scope_changes||[]).forEach(q=>f.scope.push(String(q)));
    if(iv.panel) f.panel.push(iv.panel + (rf.interviewers ? ` (${rf.interviewers} interviewers)` : ""));
  });
  return out;
}

function renderInterviews(){
  const list = $("#ivlist");
  if(!App.interviews.length){ list.innerHTML = `<p class="muted small">No debriefs yet. Your first one starts the question bank and story bank.</p>`; return; }
  list.innerHTML = App.interviews.slice().sort((a,b)=>(b.date||"").localeCompare(a.date||"")).map(iv=>{
    const d = iv.debrief || {}, q = d.questions_asked_of_me || [];
    const landed = q.filter(x=>x.landed==="yes").length;
    return `<details class="card iv" data-id="${iv.id}">
      <summary><div class="row" style="justify-content:space-between;width:100%"><div><b>${esc(iv.company||d.company||"Interview")}</b> <span class="muted small">${esc(iv.round||d.round||"")} · ${esc(iv.date||"")}</span></div>
      <span class="small muted">${q.length} question${q.length===1?"":"s"} · ${landed} landed</span></div></summary>
      ${debriefHTML(iv)}
      <div class="row" style="margin-top:12px"><button class="btn" data-act="prep" data-id="${iv.id}">Prep card for the next round</button><button class="btn" data-act="del" data-id="${iv.id}">Delete</button></div>
    </details>`;
  }).join("");
}
const li = arr => (arr||[]).filter(Boolean).map(x=>`<li>${esc(x)}</li>`).join("");
// Lines where the note taker may have mixed up speakers. Three shapes, and the
// buttons always answer the question as it is asked:
//   quote + guess  -> "We think X said: ..."   That's right / It was <other> / Not sure
//   quote only     -> "Who said this? ..."     Me / Interviewer / Not sure
//   a question     -> the question as written  Yes / No / Not sure
// Older debriefs stored plain strings, often phrased as questions.
const isQuestion = s => /\?\s*["”']?\s*$/.test(s) && /\b(was|is|were|did|do|does|are)\b.*\b(you|that|this|it)\b|\bright\b|\bcorrect\b/i.test(s);
const checksOf = d => (d.attribution_checks || d.attribution_questions || []).map(c => {
  const quote = String(typeof c === "string" ? c : c.quote || "").trim();
  const guess = typeof c === "string" ? "" : (/^me$/i.test(c.guess) ? "me" : /^interviewer$/i.test(c.guess) ? "interviewer" : "");
  return {quote, guess, mode: isQuestion(quote) ? "question" : guess ? "confirm" : "who"};
}).filter(c => c.quote);
const other = who => who === "me" ? "interviewer" : "me";
const whoLabel = who => who === "me" ? "you" : "the interviewer";
// A saved answer is always "me" | "interviewer" | "unsure" for quotes, "yes" | "no" | "unsure" for questions.
function attributionHTML(iv){
  const checks = checksOf(iv.debrief || {}); if(!checks.length) return "";
  const answers = iv.speakers || {};
  const opt = (i, val, label) => `<label class="seg"><input type="radio" name="spk-${iv.id}-${i}" value="${val}" data-spk="${iv.id}" data-i="${i}" ${answers[i]===val?"checked":""}><span>${label}</span></label>`;
  const row = (c, i) => {
    if(c.mode === "question") return `<div class="spk"><div>${esc(c.quote)}</div><div class="segs">${opt(i,"yes","Yes")}${opt(i,"no","No")}${opt(i,"unsure","Not sure")}</div></div>`;
    if(c.mode === "confirm") return `<div class="spk"><div><span class="muted">We think ${whoLabel(c.guess)} said:</span> “${esc(c.quote)}”</div><div class="segs">${opt(i,c.guess,"That's right")}${opt(i,other(c.guess), c.guess === "me" ? "It was them" : "It was me")}${opt(i,"unsure","Not sure")}</div></div>`;
    return `<div class="spk"><div><span class="muted">Who said this?</span> “${esc(c.quote)}”</div><div class="segs">${opt(i,"me","Me")}${opt(i,"interviewer","Interviewer")}${opt(i,"unsure","Not sure")}</div></div>`;
  };
  // Re-running only helps when an answer tells the AI something it didn't already assume.
  const changes = checks.some((c,i)=> c.mode === "confirm" ? (answers[i] && answers[i] !== "unsure" && answers[i] !== c.guess)
    : answers[i] && answers[i] !== "unsure");
  return `<div class="note small" style="margin-top:10px"><b>Check who said what.</b> The note taker may have mixed up speakers. Answer what you remember; your answers are saved.
    <div style="margin-top:8px">${checks.map(row).join("")}</div>
    ${changes ? `<div class="row" style="margin-top:8px"><button class="btn" data-act="reattr" data-id="${iv.id}">Update the debrief with my answers</button><span class="muted">Your answers change what the debrief assumed, so the analysis may change.</span></div>` : ""}
  </div>`;
}
function debriefHTML(iv){
  const d = iv.debrief || {}, om = d.operating_manual || {}, rf = d.red_flags || {};
  const flags = [...(rf.possibly_unlawful_questions||[]).map(x=>["bad","Possibly unlawful question",x]),
    ...(rf.resume_misstated||[]).map(x=>["bad","Resume misstated",x]), ...(rf.scope_changes||[]).map(x=>["warn","Scope changed",x]),
    ...(iv.panel?[["warn","Panel observation",iv.panel]]:[])];
  return `
    ${attributionHTML(iv)}
    <div class="grid two" style="margin-top:12px">
      <div><h3>What fell flat</h3><ul class="small">${li(d.fell_flat)}</ul></div>
      <div><h3>What made them lean in</h3><ul class="small">${li(d.leaned_in)}</ul></div>
    </div>
    <h3 style="margin-top:14px">Question by question</h3>
    <div class="scroll"><table class="small"><tr><th>Question</th><th>Landed?</th><th>Stronger answer</th></tr>
      ${(d.questions_asked_of_me||[]).map(x=>`<tr><td><b>${esc(x.question)}</b><div class="muted">${esc(x.my_answer)}</div></td><td><span class="flag ${x.landed==="yes"?"ok":x.landed==="no"?"bad":"warn"}">${esc(x.landed||"?")}</span><div class="muted">${esc(x.evidence)}</div></td><td>${esc(x.stronger_answer)}${x.story?`<div class="muted">Story: ${esc(x.story)}</div>`:""}</td></tr>`).join("")}
    </table></div>
    <div class="grid two" style="margin-top:12px">
      <div><h3>Their operating manual</h3><ul class="small">
        ${(om.priorities||[]).length?`<li><b>Priorities:</b> ${esc(om.priorities.join("; "))}</li>`:""}
        ${(om.vocabulary||[]).length?`<li><b>Their words:</b> ${esc(om.vocabulary.join(", "))}</li>`:""}
        ${om.how_they_weigh_risk?`<li><b>Risk:</b> ${esc(om.how_they_weigh_risk)}</li>`:""}
        ${om.what_failure_looks_like?`<li><b>Failure looks like:</b> ${esc(om.what_failure_looks_like)}</li>`:""}
        ${om.first_year_needs?`<li><b>First year:</b> ${esc(om.first_year_needs)}</li>`:""}
      </ul></div>
      <div><h3>Thank-you note proof points</h3><ul class="small">${li(d.follow_ups)}</ul>${d.voice?`<p class="small muted"><b>Voice:</b> ${esc(d.voice)}</p>`:""}</div>
    </div>
    ${flags.length?`<h3 style="margin-top:12px">Red flags logged to posting watch</h3><div class="small">${flags.map(([c,t,e])=>`<div><span class="flag ${c}">${t}</span> ${esc(e)}</div>`).join("")}</div>`:""}`;
}

/* ---------- who is "me" in a labelled transcript ---------- */
// Note takers label speakers ("Speaker 1:", "Dana Lee:", "[00:01:02] Sam:"). Asking once
// which label is the job seeker, before the AI sees anything, prevents most mix-ups.
const LABEL_RE = /^\s*(?:\[?\(?\d{1,2}:\d{2}(?::\d{2})?\)?\]?\s*)?([A-Z][A-Za-z.'’-]*(?: [A-Z][A-Za-z.'’-]*){0,3}|Speaker \d+|SPEAKER_\d+)\s*:/;
function speakerLabels(transcript){
  const counts = {};
  transcript.split("\n").forEach(l => { const m = l.match(LABEL_RE); if(m && !/^(Note|Notes|Date|Time|Re|Subject)$/i.test(m[1])) counts[m[1]] = (counts[m[1]]||0) + 1; });
  return Object.entries(counts).filter(([,n]) => n >= 2).sort((a,b)=>b[1]-a[1]).map(([k])=>k).slice(0,8);
}
function markMe(transcript, me){
  if(!me) return transcript;
  return transcript.split("\n").map(l => { const m = l.match(LABEL_RE);
    if(!m) return l;
    const tag = m[1] === me ? `Me (${me})` : /^me$/i.test(m[1]) ? m[1] : `Interviewer (${m[1]})`;
    return l.replace(m[1], tag); }).join("\n");
}
let pickedMe = null;   // null = not asked yet, "" = none of these

async function runDebrief(){
  const transcript = $("#ivtranscript").value.trim();
  const err = $("#iverr"); err.textContent = "";
  if(!$("#ivconsent").checked){ err.textContent = "Confirm the interviewers knew the conversation was recorded or transcribed. Without consent, paste your own notes instead."; return; }
  const audioName = !transcript && Transcribe.chatbotFile ? Transcribe.chatbotFile : "";
  if(!audioName && transcript.length < 200){ err.textContent = "Paste the transcript or your notes first (at least a few paragraphs), or upload a file."; return; }
  // Ask which speaker is "me" once per transcript, when the transcript has labels.
  if(transcript && pickedMe === null){
    const labels = speakerLabels(transcript).filter(l => !/^me$/i.test(l));
    if(labels.length >= 2){
      $("#ivwhoopts").innerHTML = labels.map(l=>`<button class="btn" data-me="${esc(l)}">${esc(l)}</button>`).join("") + `<button class="btn" data-me="">None of these</button>`;
      $("#ivwho").hidden = false; $("#ivwho").scrollIntoView({block:"nearest"}); return;
    }
    pickedMe = "";
  }
  const sent = markMe(transcript, pickedMe);
  const meta = {company: $("#ivcompany").value.trim(), role: $("#ivrole").value.trim(), round: $("#ivround").value, date: $("#ivdate").value || today(), panel: $("#ivpanel").value.trim()};
  const btn = $("#ivrun"); btn.disabled = true; const status = $("#ivstatus");
  status.textContent = "Working on it. This can take a minute for a long interview.";
  try{
    const debrief = await AI.json(debriefPrompt({transcript: sent, ...meta, audioName, standards: App.standards, storyTitles: App.stories.map(s=>s.title)}),
      {title:"Interview debrief", onStatus: s=>status.textContent = s, forcePaste: !!audioName,
       note: audioName ? `Attach your audio file (${audioName}) in ChatGPT or Gemini along with this prompt. Not every plan accepts audio; if yours doesn't, transcribe it here instead.` : ""});
    if(!debrief || !Array.isArray(debrief.questions_asked_of_me)) throw {code:"shape"};
    const iv = {id:uid(), ...meta, company: meta.company || debrief.company || "", role: meta.role || debrief.role || "", round: meta.round || debrief.round || "", transcript: sent, debrief, createdAt: Date.now()};
    App.interviews.push(iv); await Store.set("interviews", App.interviews);
    fileIntoBanks(iv); await Store.set("questionsOfMe", App.questionsOfMe); await Store.set("questionsByMe", App.questionsByMe); await Store.set("stories", App.stories);
    $("#ivtranscript").value = ""; status.textContent = ""; Transcribe.reset(); pickedMe = null; $("#ivwho").hidden = true;
    renderInterviews(); renderBanks(); renderWatch(currentRows); renderChecklist();
    const first = $(`#ivlist details[data-id="${iv.id}"]`); if(first) first.open = true;
    flash("Debrief saved. Questions and stories were added to your banks.");
  }catch(e){
    status.textContent = e && e.code === "cancelled" ? "" : e && e.code === "shape" ? "The answer didn't include the question-by-question breakdown. Try again." : "Something went wrong. Try again.";
  }finally{ btn.disabled = false; }
}

// File a debrief's questions and new stories into the banks.
function fileIntoBanks(iv){
  const d = iv.debrief, src = `${iv.company} · ${iv.round || "interview"} · ${iv.date}`;
  const key = s => String(s||"").toLowerCase().replace(/[^a-z0-9 ]+/g,"").replace(/\s+/g," ").trim();
  (d.questions_asked_of_me||[]).forEach(x=>{
    const k = key(x.question); if(!k) return;
    const hit = App.questionsOfMe.find(q=>key(q.question)===k);
    if(hit){ hit.count++; hit.seen.push(src); hit.best = x.stronger_answer || hit.best; }
    else App.questionsOfMe.push({id:uid(), question:x.question, count:1, seen:[src], best:x.stronger_answer||"", landed:x.landed||""});
  });
  (d.questions_i_asked||[]).forEach(x=>{
    const k = key(x.question); if(!k) return;
    const hit = App.questionsByMe.find(q=>key(q.question)===k);
    if(hit){ hit.count++; hit.notes.push(`${src}: ${x.what_it_reveals||x.their_answer||""}`); }
    else App.questionsByMe.push({id:uid(), question:x.question, count:1, rating:"", notes:[`${src}: ${x.what_it_reveals||x.their_answer||""}`]});
  });
  (d.new_stories||[]).forEach(s=>{
    if(!s.title || App.stories.some(t=>key(t.title)===key(s.title))) return;
    App.stories.push({id:uid(), title:s.title, proves:s.proves||"", situation:s.situation||"", action:s.action||"", result:s.result||"", sixty:s.sixty_second||"", source:src});
  });
}

/* ---------- banks (read view; editing comes next) ---------- */
function renderBanks(){
  const qo = App.questionsOfMe.slice().sort((a,b)=>b.count-a.count);
  $("#qofme").innerHTML = qo.length ? qo.map(q=>`<li><b>${esc(q.question)}</b> <span class="muted small">asked ${q.count}×</span>${q.best?`<div class="small muted">Stronger answer: ${esc(q.best)}</div>`:""}</li>`).join("") : `<li class="muted small">Questions you're asked appear here after your first debrief.</li>`;
  $("#qbyme").innerHTML = App.questionsByMe.length ? App.questionsByMe.map(q=>`<li><b>${esc(q.question)}</b>${q.notes.length?`<div class="small muted">${esc(q.notes[q.notes.length-1])}</div>`:""}</li>`).join("") : `<li class="muted small">Questions you ask interviewers appear here.</li>`;
  $("#stories").innerHTML = App.stories.length ? App.stories.map(s=>`<details class="story"><summary><b>${esc(s.title)}</b> <span class="muted small">${esc(s.proves)}</span></summary><p class="small">${esc(s.sixty||[s.situation,s.action,s.result].filter(Boolean).join(" "))}</p><p class="small muted">From ${esc(s.source||"you")}</p></details>`).join("") : `<p class="muted small">Stories from your debriefs collect here.</p>`;
}

/* ---------- transcript files and audio ---------- */
// Caption files (.vtt, .srt): drop cue numbers and timestamps, keep "Speaker: text".
function captionsToText(raw){
  return raw.replace(/\r/g,"").split("\n")
    .filter(l => !/^WEBVTT/.test(l) && !/^\d+$/.test(l.trim()) && !/-->/.test(l) && !/^(NOTE|STYLE|REGION)\b/.test(l))
    .map(l => l.replace(/<v\s+([^>]+)>/g, "$1: ").replace(/<\/?[^>]+>/g, "").trim())
    .filter(Boolean)
    // Merge consecutive lines from the same speaker.
    .reduce((out, l) => { const m = l.match(/^([^:]{1,40}):\s*(.*)$/), last = out[out.length-1];
      if(m && last && last.who === m[1]) last.text += " " + m[2];
      else out.push(m ? {who:m[1], text:m[2]} : {who:"", text:l});
      return out; }, [])
    .map(x => x.who ? `${x.who}: ${x.text}` : x.text).join("\n");
}
const Transcribe = {
  file: null, chatbotFile: "", busy: false,
  reset(){ this.file = null; this.chatbotFile = ""; $("#ivaudio").hidden = true; $("#ivaudiostatus").textContent = ""; $("#ivfile").value = ""; },
  async pick(file){
    const name = file.name.toLowerCase();
    if(/\.(txt|md|vtt|srt)$/.test(name) || file.type.startsWith("text/")){
      const raw = await file.text();
      $("#ivtranscript").value = /\.(vtt|srt)$/.test(name) ? captionsToText(raw) : raw; pickedMe = null; $("#ivwho").hidden = true;
      this.reset(); flash(`Loaded ${file.name}.`); return;
    }
    if(/\.(m4a|mp3|wav|webm|ogg|aac|mp4)$/.test(name) || file.type.startsWith("audio/")){
      this.file = file; this.chatbotFile = "";
      $("#ivaudioname").textContent = file.name;
      $("#ivaudiostatus").textContent = "";
      $("#ivaudio").hidden = false;
      // Inside claude.ai the page can't download a speech model, so only the chatbot route works there.
      const framed = await AI.inClaude();
      $("#ivlocal").hidden = framed;
      $("#ivlocalnote").textContent = framed ? "Private transcription works on the website version of this page. Here, send the audio to your chatbot, or open the website to transcribe it on your computer." : $("#ivlocalnote").textContent;
      return;
    }
    flash("That file type isn't supported. Use text, captions (.vtt, .srt), or audio.");
  },
  chatbot(){
    if(!this.file) return;
    this.chatbotFile = this.file.name;
    $("#ivaudiostatus").textContent = `When you press "Debrief it", the prompt will ask your chatbot to transcribe ${this.file.name}. You'll attach the file there.`;
  },
  // Decode to 16 kHz mono, which is what Whisper expects.
  async decode(file){
    const buf = await file.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    let audio;
    try { audio = await ctx.decodeAudioData(buf); } finally { ctx.close && ctx.close(); }
    const frames = Math.ceil(audio.duration * 16000);
    const off = new OfflineAudioContext(1, frames, 16000);
    const src = off.createBufferSource(); src.buffer = audio; src.connect(off.destination); src.start();
    const rendered = await off.startRendering();
    return {samples: rendered.getChannelData(0), seconds: audio.duration};
  },
  async local(){
    if(!this.file || this.busy) return;
    this.busy = true; const status = $("#ivaudiostatus"), btn = $("#ivlocal"); btn.disabled = true;
    const started = Date.now(); let timer = null;
    try{
      status.textContent = "Reading the audio…";
      const {samples, seconds} = await this.decode(this.file);
      status.textContent = "Loading the speech model (about 80 MB the first time)…";
      const tf = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1/dist/transformers.min.js");
      let lastPct = -1;
      const progress = p => { if(p.status === "progress" && p.total){ const pct = Math.round(100*p.loaded/p.total); if(pct !== lastPct){ lastPct = pct; status.textContent = `Downloading the speech model: ${pct}%`; } } };
      let asr;
      try { asr = await tf.pipeline("automatic-speech-recognition", "Xenova/whisper-base.en", {device: navigator.gpu ? "webgpu" : "wasm", progress_callback: progress}); }
      catch { asr = await tf.pipeline("automatic-speech-recognition", "Xenova/whisper-base.en", {device: "wasm", progress_callback: progress}); }
      const mins = Math.max(1, Math.round(seconds/60));
      timer = setInterval(()=>{ const s = Math.round((Date.now()-started)/1000); status.textContent = `Transcribing ${mins} minute${mins>1?"s":""} of audio on your computer… ${Math.floor(s/60)}:${String(s%60).padStart(2,"0")} elapsed. Keep this tab open.`; }, 1000);
      const out = await asr(samples, {chunk_length_s: 30, stride_length_s: 5});
      clearInterval(timer);
      const text = String(out && out.text || "").trim();
      if(!text) throw new Error("empty");
      $("#ivtranscript").value = text; pickedMe = null;
      this.file = null; $("#ivaudio").hidden = true;
      flash("Transcribed on your computer. Audio has no speaker names, so the debrief will ask who said what.");
    }catch(e){
      clearInterval(timer);
      status.textContent = "Couldn't transcribe this file here. Try the chatbot route, or convert it to .mp3 or .wav and try again.";
    }finally{ this.busy = false; btn.disabled = false; }
  }
};

/* ---------- welcome + next steps ---------- */
// First visit: pick a path. After that, a short checklist until the basics are done.
async function renderWelcome(){
  const welcomed = await Store.get("welcomed", "");
  const tracker = await Store.get("tracker", null);
  $("#welcome").hidden = !!(welcomed || (tracker && tracker.raw));
}
function renderChecklist(){
  if(typeof isSample !== "function") return;
  const items = [
    {done: !isSample() && currentRows.length > 0, label: "Add or upload your applications", tab: "load"},
    {done: (App.standards || "").trim().length > 20, label: "Write down the claims you can defend", tab: "banks"},
    {done: App.interviews.length > 0, label: "Debrief an interview", tab: "interviews"}
  ];
  const box = $("#checklist");
  box.hidden = !$("#welcome").hidden || isSample() || items.every(i=>i.done);
  $("#checkitems").innerHTML = items.map(i=>`<span class="${i.done?"done":""}">${i.done ? esc(i.label) : `<a href="#" data-goto="${i.tab}">${esc(i.label)}</a>`}</span>`).join("");
}
async function startPath(path){
  await Store.set("welcomed", path);
  $("#welcome").hidden = true;
  if(path === "example"){ show("mirror"); flash("This is a fictional search. Load your own any time from Load tracker."); }
  if(path === "bring"){ show("load"); $("#file").focus(); }
  if(path === "fresh"){
    if(isSample()) load([], "your tracker", [], {allowEmpty:true});
    show("load"); $("#qacompany").focus();
  }
  renderChecklist();
}

/* ---------- wiring ---------- */
document.addEventListener("click", async e=>{
  const t = e.target;
  if(t.id === "ivrun") runDebrief();
  const start = t.closest && t.closest("[data-start]"); if(start) startPath(start.dataset.start);
  if(t.dataset && t.dataset.goto){ e.preventDefault(); show(t.dataset.goto); }
  if(t.dataset && "me" in t.dataset && t.closest("#ivwho")){ pickedMe = t.dataset.me; $("#ivwho").hidden = true; runDebrief(); }
  if(t.id === "ivlocal") Transcribe.local();
  if(t.id === "ivchatbot") Transcribe.chatbot();
  if(t.id === "exportbtn") exportBackup();
  if(t.id === "importbtn") $("#importfile").click();
  if(t.dataset && t.dataset.act === "del"){
    if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Delete for good?"; return; }
    App.interviews = App.interviews.filter(iv=>iv.id !== t.dataset.id); await Store.set("interviews", App.interviews);
    renderInterviews(); renderWatch(currentRows);
  }
  if(t.dataset && t.dataset.act === "reattr"){
    const iv = App.interviews.find(x=>x.id === t.dataset.id); if(!iv) return;
    const checks = checksOf(iv.debrief), answers = iv.speakers || {};
    const corrections = checks.map((c,i)=>({quote:c.quote, mode:c.mode, who:answers[i]}))
      .filter(c => c.mode === "question" ? (c.who === "yes" || c.who === "no") : (c.who === "me" || c.who === "interviewer"));
    if(!iv.transcript){ flash("This debrief came from audio sent to your chatbot, so there's no transcript saved here to re-run."); return; }
    t.disabled = true; t.textContent = "Updating…";
    try{
      const d = await AI.json(debriefPrompt({transcript: iv.transcript, company: iv.company, role: iv.role, round: iv.round, standards: App.standards, storyTitles: App.stories.map(s=>s.title), corrections}),
        {title:"Update the debrief"});
      if(!d || !Array.isArray(d.questions_asked_of_me)) throw {code:"shape"};
      iv.debrief = d; iv.speakers = {};
      // Only new stories are filed again; the question bank already counted this interview.
      fileIntoBanks({...iv, debrief:{new_stories: d.new_stories || []}});
      await Store.set("interviews", App.interviews); await Store.set("stories", App.stories);
      renderInterviews(); renderBanks(); renderWatch(currentRows);
      const again = $(`#ivlist details[data-id="${iv.id}"]`); if(again) again.open = true;
      flash("Debrief updated with your answers.");
    }catch(e){ if(!(e && e.code === "cancelled")) flash("Couldn't update the debrief. Your answers are still saved."); t.disabled = false; t.textContent = "Update the debrief with my answers"; }
    return;
  }
  if(t.dataset && t.dataset.act === "prep"){ show("prep"); flash("Prep cards arrive in the next build."); }
});
document.addEventListener("change", async e=>{
  if(e.target.dataset && e.target.dataset.spk){
    const iv = App.interviews.find(x=>x.id === e.target.dataset.spk); if(!iv) return;
    iv.speakers = {...(iv.speakers||{}), [e.target.dataset.i]: e.target.value};
    await Store.set("interviews", App.interviews);
    const box = e.target.closest(".note"); const open = e.target.closest("details");
    renderInterviews(); const again = $(`#ivlist details[data-id="${iv.id}"]`); if(again && open) again.open = true;
    return;
  }
  if(e.target.id === "importfile" && e.target.files[0]) importBackup(e.target.files[0]);
  if(e.target.id === "ivfile" && e.target.files[0]) Transcribe.pick(e.target.files[0]);
});
document.addEventListener("input", e=>{
  if(e.target.id === "ivtranscript"){ pickedMe = null; $("#ivwho").hidden = true; }
  if(e.target.id === "standards"){ clearTimeout(App.st); App.st = setTimeout(()=>{ App.standards = e.target.value; Store.set("standards", App.standards); renderChecklist(); }, 500); }
});
(async () => {
  $("#ivdate").value = today();
  AI.inClaude().then(yes=>{ $("#aimode").textContent = yes ? "Runs on your own Claude account, right here." : "Works with any AI: the app gives you a prompt to paste into ChatGPT, Gemini, or Claude, then files the answer you paste back."; });
  if(!(await Store.persistent())) flash("This browser won't keep your data between visits. Use Export to save a backup.");
  await App.reload();
  await renderWelcome(); renderChecklist();
  $("#qadate").value = today();
})();
