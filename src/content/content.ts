// ─── Types ────────────────────────────────────────────────────────────────────

type StyleId = 'bait' | 'gentle' | 'neutral' | 'thanks' | 'random' | 'custom';
type LangId  = 'auto' | 'uk' | 'ru' | 'en' | 'es' | 'pt' | 'de' | 'it' | 'fr';

// ─── Settings ─────────────────────────────────────────────────────────────────

let GROQ_KEYS: string[] = [];
let groqKeyIdx = 0;
const keyLimitedUntil = new Map<number, number>();

let SEL_STYLE: StyleId = 'neutral';
let CUSTOM_PROMPT = '';
let FILTER_OFFTOPIC = true;
let REPLY_LANG: LangId = 'auto';
let MAX_TOKENS = 150;

let refreshKeysUI: (() => void) | null = null;
let updateCommentCount: (() => void) | null = null;

function loadSettings() {
  chrome.storage.local.get(['groqKeys','selectedStyle','customPrompt','filterOffTopic','replyLang','maxTokens'], r => {
    GROQ_KEYS       = Array.isArray(r.groqKeys) ? r.groqKeys : [];
    SEL_STYLE       = r.selectedStyle  || 'neutral';
    CUSTOM_PROMPT   = r.customPrompt   || '';
    FILTER_OFFTOPIC = r.filterOffTopic !== false;
    REPLY_LANG      = r.replyLang      || 'auto';
    MAX_TOKENS      = r.maxTokens      || 150;
    refreshKeysUI?.();
  });
}
loadSettings();

chrome.storage.onChanged.addListener(ch => {
  if (ch.groqKeys)       { GROQ_KEYS = ch.groqKeys.newValue || []; refreshKeysUI?.(); }
  if (ch.selectedStyle)  SEL_STYLE       = ch.selectedStyle.newValue  || 'neutral';
  if (ch.customPrompt)   CUSTOM_PROMPT   = ch.customPrompt.newValue   || '';
  if (ch.filterOffTopic) FILTER_OFFTOPIC = ch.filterOffTopic.newValue !== false;
  if (ch.replyLang)      REPLY_LANG      = ch.replyLang.newValue      || 'auto';
  if (ch.maxTokens)     MAX_TOKENS      = ch.maxTokens.newValue     || 150;
});

function saveSettings(partial: Partial<{groqKeys:string[];selectedStyle:StyleId;customPrompt:string;filterOffTopic:boolean;replyLang:LangId;maxTokens:number}>) {
  chrome.storage.local.set(partial);
}

// ─── Utils ────────────────────────────────────────────────────────────────────

const sleep  = (ms: number) => new Promise(r => setTimeout(r, ms));
const jitter = (b: number, v: number) => b + (Math.random()*v*2 - v);

function toast(msg: string) {
  const d = document.createElement("div");
  d.style.cssText = `position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
    background:#1f2937;color:#f9fafb;padding:8px 16px;border-radius:8px;font-size:12px;
    z-index:999999;box-shadow:0 4px 16px rgba(0,0,0,.5);pointer-events:none;
    font-family:'YouTube Sans',Roboto,sans-serif;`;
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 3500);
}

function waitFor(sel: string, root: Document | Element = document, ms = 4000): Promise<HTMLElement | null> {
  return new Promise(res => {
    const el = root.querySelector<HTMLElement>(sel);
    if (el) { res(el); return; }
    const ob = new MutationObserver(() => {
      const found = root.querySelector<HTMLElement>(sel);
      if (found) { ob.disconnect(); res(found); }
    });
    ob.observe(root === document ? document.body : root as Element, { childList:true, subtree:true });
    setTimeout(() => { ob.disconnect(); res(null); }, ms);
  });
}

const _logs: string[] = [];
let _panelLog: ((m: string) => void) | null = null;
function dbg(msg: string) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  _logs.push(line);
  if (_logs.length > 300) _logs.shift();
  console.log("[AI Reply]", msg);
  _panelLog?.(msg);
}

// ─── Groq Key Rotation ────────────────────────────────────────────────────────

function getNextKey(): string | null {
  if (!GROQ_KEYS.length) return null;
  const now = Date.now();
  for (let i = 0; i < GROQ_KEYS.length; i++) {
    const idx = (groqKeyIdx + i) % GROQ_KEYS.length;
    if ((keyLimitedUntil.get(idx) || 0) < now) {
      groqKeyIdx = (idx + 1) % GROQ_KEYS.length;
      return GROQ_KEYS[idx];
    }
  }
  // All limited — use soonest-expiring
  let best = 0, bestExp = Infinity;
  keyLimitedUntil.forEach((exp, idx) => { if (exp < bestExp) { bestExp = exp; best = idx; } });
  groqKeyIdx = (best + 1) % GROQ_KEYS.length;
  return GROQ_KEYS[best];
}

function markKeyLimited(key: string) {
  const idx = GROQ_KEYS.indexOf(key);
  if (idx === -1) return;
  keyLimitedUntil.set(idx, Date.now() + 65_000);
  dbg(`🔑 Ключ #${idx+1} вичерпано, перемикаю...`);
  refreshKeysUI?.();
}

// ─── Groq key modal (first-time) ─────────────────────────────────────────────

function askGroqKey(): Promise<string | null> {
  return new Promise(res => {
    const wrap = document.createElement("div");
    wrap.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.65);
      z-index:999999;display:flex;align-items:center;justify-content:center;`;
    wrap.innerHTML = `
      <div style="background:#1f2937;border:1px solid #4b5563;border-radius:14px;
        padding:22px;width:320px;color:#f9fafb;font-family:'YouTube Sans',Roboto,sans-serif;">
        <p style="margin:0 0 4px;font-size:15px;font-weight:700;">✦ Groq API Key</p>
        <p style="margin:0 0 14px;font-size:11px;color:#9ca3af;">Безкоштовно на <b>console.groq.com</b><br>Або додай в панелі → вкладка 🔑 Ключі</p>
        <input id="_k" type="password" placeholder="gsk_..."
          style="width:100%;background:#111827;border:1px solid #374151;border-radius:8px;
          padding:9px 11px;color:#f9fafb;font-size:13px;margin-bottom:12px;box-sizing:border-box;outline:none;"/>
        <div style="display:flex;gap:8px;">
          <button id="_s" disabled style="flex:1;padding:9px;border-radius:8px;border:none;
            background:#ea580c;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">Зберегти</button>
          <button id="_c" style="flex:1;padding:9px;border-radius:8px;border:none;
            background:#374151;color:#d1d5db;font-size:13px;font-weight:600;cursor:pointer;">Скасувати</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const inp = wrap.querySelector<HTMLInputElement>("#_k")!;
    const btn = wrap.querySelector<HTMLButtonElement>("#_s")!;
    inp.addEventListener("input", () => { btn.disabled = !inp.value.trim(); });
    btn.addEventListener("click", () => {
      const k = inp.value.trim(); if (!k) return;
      if (GROQ_KEYS.includes(k)) { toast("Цей ключ вже є"); return; }
      GROQ_KEYS = [...GROQ_KEYS, k];
      saveSettings({ groqKeys: GROQ_KEYS });
      refreshKeysUI?.();
      wrap.remove(); res(k);
    });
    wrap.querySelector("#_c")!.addEventListener("click", () => { wrap.remove(); res(null); });
    inp.focus();
  });
}

// ─── Reply Styles ─────────────────────────────────────────────────────────────

const STYLE_PROMPTS_I18N: Record<string, Record<Exclude<StyleId,'random'|'custom'>, string>> = {
  uk: {
    bait:    "Злегка не погоджуйся з автором або уточнюй що він мав на увазі. Завжди закінчуй відповідь запитанням. Будь щирим, природним, не агресивним. 1-2 речення.",
    gentle:  "Відповідай тепло, особисто та з підтримкою. Дай людині відчути, що її почули. 1-2 речення.",
    neutral: "Відповідай коротко і по суті, нейтральний дружній тон. 1 речення.",
    thanks:  "Подякуй автору за коментар щиро і по-різному, не шаблонно. 1 речення.",
  },
  en: {
    bait:    "Slightly disagree with the author or ask them to clarify what they meant. Always end your reply with a question. Be genuine, natural, not aggressive. 1-2 sentences.",
    gentle:  "Reply warmly, personally and supportively. Make the person feel heard. 1-2 sentences.",
    neutral: "Reply briefly and on topic, neutral friendly tone. 1 sentence.",
    thanks:  "Thank the author for their comment sincerely and in varied ways, not generic. 1 sentence.",
  },
  ru: {
    bait:    "Слегка не соглашайся с автором или уточняй что он имел в виду. Всегда заканчивай ответ вопросом. Будь искренним, естественным, не агрессивным. 1-2 предложения.",
    gentle:  "Отвечай тепло, лично и с поддержкой. Дай человеку почувствовать, что его услышали. 1-2 предложения.",
    neutral: "Отвечай коротко и по сути, нейтральный дружелюбный тон. 1 предложение.",
    thanks:  "Поблагодари автора за комментарий искренне и по-разному, не шаблонно. 1 предложение.",
  },
  es: {
    bait:    "Discrepa ligeramente con el autor o pídele que aclare lo que quiso decir. Siempre termina tu respuesta con una pregunta. Sé genuino, natural, no agresivo. 1-2 oraciones.",
    gentle:  "Responde con calidez, de forma personal y con apoyo. Haz que la persona se sienta escuchada. 1-2 oraciones.",
    neutral: "Responde brevemente y al punto, tono neutral y amigable. 1 oración.",
    thanks:  "Agradece al autor por su comentario de forma sincera y variada, no genérica. 1 oración.",
  },
  pt: {
    bait:    "Discorde levemente do autor ou peça que esclareça o que quis dizer. Sempre termine sua resposta com uma pergunta. Seja genuíno, natural, não agressivo. 1-2 frases.",
    gentle:  "Responda com calor, pessoalmente e com apoio. Faça a pessoa se sentir ouvida. 1-2 frases.",
    neutral: "Responda brevemente e direto ao ponto, tom neutro e amigável. 1 frase.",
    thanks:  "Agradeça ao autor pelo comentário de forma sincera e variada, não genérica. 1 frase.",
  },
  de: {
    bait:    "Widersprich dem Autor leicht oder frage nach, was er gemeint hat. Beende deine Antwort immer mit einer Frage. Sei aufrichtig, natürlich, nicht aggressiv. 1-2 Sätze.",
    gentle:  "Antworte warmherzig, persönlich und unterstützend. Gib der Person das Gefühl, gehört zu werden. 1-2 Sätze.",
    neutral: "Antworte kurz und sachlich, neutraler freundlicher Ton. 1 Satz.",
    thanks:  "Bedanke dich beim Autor für den Kommentar aufrichtig und abwechslungsreich, nicht generisch. 1 Satz.",
  },
  it: {
    bait:    "Dissenti leggermente dall'autore o chiedigli di chiarire cosa intendeva. Termina sempre la risposta con una domanda. Sii genuino, naturale, non aggressivo. 1-2 frasi.",
    gentle:  "Rispondi con calore, in modo personale e con supporto. Fai sentire la persona ascoltata. 1-2 frasi.",
    neutral: "Rispondi brevemente e al punto, tono neutro e amichevole. 1 frase.",
    thanks:  "Ringrazia l'autore per il commento in modo sincero e vario, non generico. 1 frase.",
  },
  fr: {
    bait:    "Sois légèrement en désaccord avec l'auteur ou demande-lui de préciser ce qu'il voulait dire. Termine toujours ta réponse par une question. Sois sincère, naturel, pas agressif. 1-2 phrases.",
    gentle:  "Réponds chaleureusement, personnellement et avec soutien. Fais sentir à la personne qu'elle est entendue. 1-2 phrases.",
    neutral: "Réponds brièvement et au sujet, ton neutre et amical. 1 phrase.",
    thanks:  "Remercie l'auteur pour son commentaire sincèrement et de manière variée, pas générique. 1 phrase.",
  },
};

function pickStylePrompt(lang: string): string {
  const prompts = STYLE_PROMPTS_I18N[lang] || STYLE_PROMPTS_I18N.uk;
  if (SEL_STYLE === 'custom') return CUSTOM_PROMPT || prompts.neutral;
  if (SEL_STYLE === 'random') {
    const opts = Object.keys(prompts) as Array<keyof typeof prompts>;
    return prompts[opts[Math.floor(Math.random() * opts.length)]];
  }
  return prompts[SEL_STYLE as keyof typeof prompts] || prompts.neutral;
}

// ─── Groq Generate ────────────────────────────────────────────────────────────

function detectLang(t: string): "en"|"uk"|"ru" {
  const l = t.replace(/[^a-zA-Zа-яёіїєА-ЯЁІЇЄ]/g,"");
  if (!l) return "uk";
  if ((l.match(/[a-zA-Z]/g)||[]).length > (l.match(/[а-яёіїєА-ЯЁІЇЄ]/g)||[]).length) return "en";
  return (l.match(/[іїєІЇЄ]/g)||[]).length > 0 ? "uk" : "ru";
}

function getChannelName() {
  return document.querySelector<HTMLElement>("#entity-name")?.innerText?.trim()
    || document.querySelector<HTMLElement>("ytd-video-owner-renderer #channel-name a")?.innerText?.trim()
    || "Канал";
}
function getVideoTitle() {
  return document.querySelector<HTMLElement>("ytd-watch-metadata h1 yt-formatted-string")?.innerText?.trim()
    || document.title.replace(/ - YouTube.*/, "").trim() || "";
}

async function groqGenerate(commentText: string, attempt = 0): Promise<string | null> {
  if (!GROQ_KEYS.length) {
    const k = await askGroqKey();
    if (!k) return null;
    return groqGenerate(commentText, 0);
  }
  const key = getNextKey()!;
  const isAuto = REPLY_LANG === 'auto';
  const lang = isAuto ? detectLang(commentText) : REPLY_LANG;
  const vt   = getVideoTitle();
  const ch   = getChannelName();
  const fl = FILTER_OFFTOPIC
    ? "\n- If the comment is completely off-topic for the video or channel — reply ONLY with the word SKIP."
    : "";
  const langInstruction = isAuto
    ? "IMPORTANT: Reply in the SAME language as the comment. Detect the comment language and match it exactly."
    : ({
        uk: "Reply ONLY in Ukrainian.", en: "Reply ONLY in English.", ru: "Reply ONLY in Russian.",
        es: "Reply ONLY in Spanish.", pt: "Reply ONLY in Portuguese.", de: "Reply ONLY in German.",
        it: "Reply ONLY in Italian.", fr: "Reply ONLY in French.",
      } as Record<string,string>)[lang] || `Reply ONLY in ${lang}.`;
  const sys = `You are a YouTube channel assistant for "${ch}".${vt ? `\nVideo: "${vt}"` : ""}\n${pickStylePrompt(lang)}${fl}\n${langInstruction}`;

  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role:"system", content: sys },
        { role:"user",   content: `Reply to this comment:\n"${commentText}"` },
      ],
      temperature: 0.75, max_tokens: MAX_TOKENS,
    }),
  });

  if (r.status === 429) {
    markKeyLimited(key);
    if (attempt < GROQ_KEYS.length) { await sleep(600); return groqGenerate(commentText, attempt+1); }
    throw new Error("Всі Groq ключі вичерпали ліміт");
  }
  if (!r.ok) {
    const err = await r.json().catch(() => ({})) as {error?:{message?:string}};
    throw new Error(err?.error?.message || `Groq ${r.status}`);
  }
  const data = await r.json();
  const out  = data.choices?.[0]?.message?.content?.trim() || "";
  if (FILTER_OFFTOPIC && out.toUpperCase() === "SKIP") return null;
  return out || null;
}

// ─── Human-like typing ────────────────────────────────────────────────────────

async function humanType(el: HTMLElement, text: string) {
  el.click(); el.focus();
  await sleep(jitter(120, 50));
  if (el.tagName === "TEXTAREA") {
    (el as HTMLTextAreaElement).value = "";
    el.dispatchEvent(new Event("input", { bubbles:true }));
  } else {
    el.textContent = "";
    document.execCommand("selectAll", false);
  }
  await sleep(jitter(90, 40));
  let i = 0;
  while (i < text.length) {
    const chunk = text.slice(i, i + Math.ceil(Math.random()*3));
    if (el.tagName === "TEXTAREA") {
      (el as HTMLTextAreaElement).value += chunk;
      el.dispatchEvent(new Event("input", { bubbles:true }));
    } else {
      document.execCommand("insertText", false, chunk);
    }
    i += chunk.length;
    await sleep(jitter(48,28) * (i/text.length < 0.1 || i/text.length > 0.9 ? 1.5 : 1));
    if (Math.random() < 0.06) await sleep(jitter(280,120));
  }
}

// ─── Site Detection ───────────────────────────────────────────────────────────

const IS_STUDIO = location.hostname === "studio.youtube.com";

// ─── DOM Reply Helpers ────────────────────────────────────────────────────────

const EDITABLE_SEL = [
  '#contenteditable-root[contenteditable="true"]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  'textarea',
].join(", ");

async function findInput(container: Element | Document, ms = 5000): Promise<HTMLElement | null> {
  const immediate = container.querySelector<HTMLElement>(EDITABLE_SEL);
  if (immediate) return immediate;
  return waitFor(EDITABLE_SEL, container, ms);
}

async function dismissOpenInput() {
  const containers = [
    "#reply-dialog-container",
    "ytd-comment-thread-renderer #reply-simple-box",
    "ytd-comment-thread-renderer ytd-comment-simplebox-renderer",
  ];
  let open: HTMLElement | null = null;
  for (const sel of containers) {
    const c = document.querySelector(sel);
    if (c) { open = c.querySelector<HTMLElement>(EDITABLE_SEL); if (open) break; }
  }
  if (!open) return;
  dbg("Закриваю відкрите reply поле...");
  const cancel = document.querySelector<HTMLElement>(
    "#cancel-button button, button[aria-label*='Cancel'], button[aria-label*='Скасувати']"
  );
  if (cancel) cancel.click();
  else open.dispatchEvent(new KeyboardEvent("keydown",{ key:"Escape",bubbles:true,cancelable:true }));
  await sleep(600);
}

async function doReply(commentEl: Element, replyText: string): Promise<boolean> {
  if (IS_STUDIO) return doReplyStudio(commentEl, replyText);

  dbg("doReply: закриваю попереднє поле");
  await dismissOpenInput();

  const thread = commentEl.closest("ytd-comment-thread-renderer") || commentEl.parentElement!;
  const replyBtn = commentEl.querySelector<HTMLElement>("#reply-button button, #reply-button-end button")
    || thread.querySelector<HTMLElement>("#reply-button-end button, #reply-button button")
    || commentEl.querySelector<HTMLElement>('button[aria-label="Reply"], button[aria-label="Ответить"], button[aria-label="Відповісти"]');
  dbg(`doReply: reply button = ${replyBtn ? "знайдено" : "НЕ ЗНАЙДЕНО"}`);
  if (!replyBtn) { toast("⚠ Кнопка Reply не знайдена"); return false; }

  replyBtn.click();
  await sleep(jitter(900, 200));

  let input = await findInput(thread, 3000);
  if (!input) { dbg("doReply: шукаю в документі..."); input = await findInput(document, 2000); }
  dbg(`doReply: input = ${input ? input.tagName+" "+input.id : "НЕ ЗНАЙДЕНО"}`);
  if (!input) { toast("⚠ Поле вводу не з'явилось"); return false; }

  dbg(`doReply: друкую (${replyText.length} символів)`);
  await humanType(input, replyText);
  await sleep(jitter(400, 120));

  const submitBtn = thread.querySelector<HTMLElement>("#submit-button button")
    || document.querySelector<HTMLElement>("#submit-button button");
  dbg(`doReply: submit = ${submitBtn ? "знайдено" : "Ctrl+Enter"}`);
  if (submitBtn) submitBtn.click();
  else input.dispatchEvent(new KeyboardEvent("keydown",{ key:"Enter",ctrlKey:true,bubbles:true }));

  await sleep(500);
  dbg(`doReply: поле = ${thread.querySelector(EDITABLE_SEL) ? "ще відкрите" : "закрилось ✓"}`);
  return true;
}

async function doReplyStudio(commentEl: Element, replyText: string): Promise<boolean> {
  const thread = commentEl.closest("ytcp-comment-thread") || commentEl;

  dbg("doReplyStudio: закриваю попереднє поле");
  await dismissOpenInput();

  const actionBtns = thread.querySelector("ytcp-comment-action-buttons");
  const replyBtn = actionBtns?.querySelector<HTMLElement>("#reply-button, button")
    || thread.querySelector<HTMLElement>("#reply-button");
  dbg(`doReplyStudio: reply button = ${replyBtn ? "знайдено" : "НЕ ЗНАЙДЕНО"}`);
  if (!replyBtn) { toast("⚠ Кнопка Reply не знайдена (Studio)"); return false; }

  replyBtn.click();
  await sleep(jitter(900, 200));

  dbg("doReplyStudio: чекаю #reply-dialog-container...");
  const dialogRoot = await waitFor("#reply-dialog-container", document, 5000);
  dbg(`doReplyStudio: dialogRoot = ${dialogRoot ? "знайдено" : "НЕ ЗНАЙДЕНО"}`);

  const searchRoot: Element | Document = dialogRoot
    || thread.querySelector<HTMLElement>("#reply-dialog-container")
    || thread;

  dbg("doReplyStudio: шукаю поле вводу...");
  const input = await findInput(searchRoot, 4000) || document.querySelector<HTMLElement>(EDITABLE_SEL);
  dbg(`doReplyStudio: input = ${input ? input.tagName+"#"+input.id : "НЕ ЗНАЙДЕНО"}`);
  if (!input) { toast("⚠ Поле вводу не з'явилось (Studio)"); return false; }

  dbg(`doReplyStudio: друкую (${replyText.length} символів)`);
  await humanType(input, replyText);
  await sleep(jitter(400, 120));

  const submitSel = "ytcp-comment-button#submit-button button, #submit-button button, button[type='submit'], ytcp-comment-button#submit-button, #submit-button";
  const submitRoot = searchRoot instanceof Document ? document : searchRoot as Element;
  const submitBtn  = submitRoot.querySelector<HTMLElement>(submitSel) || document.querySelector<HTMLElement>(submitSel);
  dbg(`doReplyStudio: submit = ${submitBtn ? submitBtn.tagName+"#"+submitBtn.id : "Ctrl+Enter"}`);
  if (submitBtn) { submitBtn.click(); await sleep(150); }
  input.dispatchEvent(new KeyboardEvent("keydown",{ key:"Enter",ctrlKey:true,bubbles:true }));

  await sleep(800);
  dbg(`doReplyStudio: діалог = ${document.querySelector("#reply-dialog-container "+EDITABLE_SEL) ? "ще відкритий ⚠" : "закрився ✓"}`);
  return true;
}

// ─── Comment Text Extraction ──────────────────────────────────────────────────

function getCommentText(el: Element): string {
  const direct = el.querySelector<HTMLElement>("#content-text, .comment-text, [id*='content-text']");
  if (direct?.innerText?.trim()) return direct.innerText.trim();
  let best = "";
  el.querySelectorAll<HTMLElement>("span, p, div").forEach(n => {
    const t = (n.childNodes.length === 1 && n.childNodes[0].nodeType === 3) ? n.textContent?.trim()||"" : "";
    if (t.length > best.length) best = t;
  });
  return best;
}

// ─── Unanswered Comments ─────────────────────────────────────────────────────

function getUnansweredComments(): Element[] {
  if (IS_STUDIO) {
    return Array.from(document.querySelectorAll("ytcp-comment-thread"))
      .filter(t => t.querySelectorAll("ytcp-comment").length <= 1);
  }
  return Array.from(document.querySelectorAll("ytd-comment-thread-renderer")).filter(t => {
    const repliesEl = t.querySelector("ytd-comment-replies-renderer");
    if (!repliesEl) return true;
    return !repliesEl.querySelector("#more-replies, #more-replies-sub-thread, ytd-comment-renderer");
  });
}

// ─── Auto Reply ───────────────────────────────────────────────────────────────

let autoRunning = false;
let autoStopped = false;

async function runAuto(
  maxReplies: number,
  log: (m: string) => void,
  stats: (done: number, total: number) => void,
  onDone: () => void,
) {
  autoRunning = true;
  autoStopped = false;

  if (!GROQ_KEYS.length) {
    const k = await askGroqKey();
    if (!k) { autoRunning = false; onDone(); return; }
  }

  const comments = getUnansweredComments();
  for (let i = comments.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [comments[i],comments[j]] = [comments[j],comments[i]];
  }
  const targets = comments.slice(0, maxReplies);
  log(`Знайдено ${comments.length} без відповіді → ${targets.length}`);
  stats(0, targets.length);
  await sleep(jitter(2000, 600));

  let done = 0;
  for (let i = 0; i < targets.length; i++) {
    if (autoStopped) break;
    const thread  = targets[i];
    const comment = IS_STUDIO
      ? thread.querySelector("ytcp-comment") || thread
      : thread.querySelector("ytd-comment-renderer") || thread.querySelector("ytd-comment-view-model") || thread;
    if (!comment) { dbg(`⚠ Елемент коментаря не знайдено #${i+1}`); continue; }

    const text = getCommentText(comment);
    if (!text) { log(`⚠ Текст не знайдено #${i+1}`); continue; }
    const author = comment.querySelector<HTMLElement>("#author-text, #author-name")?.innerText?.trim() || `#${i+1}`;

    thread.scrollIntoView({ behavior:"smooth", block:"center" });
    await sleep(jitter(1400, 500));
    if (autoStopped) break;

    log(`✦ Генерую @${author}...`);
    let reply: string | null = null;
    try { reply = await groqGenerate(text); }
    catch(e) { log(`✗ ${(e as Error).message}`); await sleep(jitter(4000,1500)); continue; }

    if (!reply) { log(`⏭ Офтопік, пропуск`); continue; }
    if (autoStopped) break;

    log(`⌨ Пишу...`);
    const ok = await doReply(comment, reply);
    if (ok) { done++; stats(done, targets.length); log(`✓ @${author} (${done}/${targets.length})`); }

    if (done > 0 && done % 5 === 0) {
      const p = jitter(26000, 6000);
      log(`☕ Пауза ${Math.round(p/1000)}с...`);
      await sleep(p);
    } else {
      await sleep(jitter(8500, 3500));
    }
  }
  autoRunning = false;
  log(autoStopped ? "⏹ Зупинено" : `✅ Готово! Надіслано: ${done}`);
  onDone();
}

// ─── AI Reply Button ──────────────────────────────────────────────────────────

const BTN  = "ai-reply-btn";
const DONE = "data-ai";

async function onAiBtnClick(btn: HTMLButtonElement, commentEl: Element) {
  if (!GROQ_KEYS.length) { const k = await askGroqKey(); if (!k) return; }
  const text = getCommentText(commentEl);
  if (!text) { toast("Текст коментаря не знайдено"); return; }
  btn.textContent = "⏳...";
  btn.classList.add("ai-loading");
  try {
    const reply = await groqGenerate(text);
    if (!reply) { toast("Пропущено (офтопік)"); return; }
    await doReply(commentEl, reply);
  } catch(e) {
    toast(`Помилка: ${(e as Error).message}`);
  } finally {
    btn.textContent = "✦ AI Reply";
    btn.classList.remove("ai-loading");
  }
}

function injectBtn(threadEl: Element) {
  if (threadEl.hasAttribute(DONE)) return;
  threadEl.setAttribute(DONE, "1");
  let commentEl: Element | null, actionBtns: Element | null;
  if (IS_STUDIO) {
    commentEl  = threadEl.querySelector("ytcp-comment") || threadEl;
    actionBtns = threadEl.querySelector("ytcp-comment-action-buttons");
  } else {
    commentEl  = threadEl.querySelector("ytd-comment-renderer") || threadEl.querySelector("ytd-comment-view-model") || threadEl;
    actionBtns = commentEl.querySelector("ytd-comment-action-buttons-renderer") || commentEl.querySelector("#action-buttons") || threadEl.querySelector("#action-buttons");
  }
  if (!actionBtns || !commentEl) return;
  const btn = document.createElement("button");
  btn.className = BTN; btn.textContent = "✦ AI Reply";
  btn.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); onAiBtnClick(btn, commentEl!); });
  actionBtns.appendChild(btn);
}

function scanAndInject() {
  const sel = IS_STUDIO ? `ytcp-comment-thread:not([${DONE}])` : `ytd-comment-thread-renderer:not([${DONE}])`;
  document.querySelectorAll<HTMLElement>(sel).forEach(injectBtn);
  updateCommentCount?.();
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function injectStyles() {
  if (document.getElementById("ai-styles")) return;
  const s = document.createElement("style");
  s.id = "ai-styles";
  s.textContent = `
    .${BTN} {
      display:inline-flex;align-items:center;padding:4px 10px;border-radius:12px;
      border:none;background:linear-gradient(135deg,#ea580c,#c2410c);
      color:#fff;font-size:11px;font-weight:600;cursor:pointer;
      opacity:0;transition:opacity .15s,transform .1s;transform:scale(.95);
      white-space:nowrap;vertical-align:middle;line-height:1;
      font-family:'YouTube Sans',Roboto,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.25);
    }
    .${BTN}:hover { background:linear-gradient(135deg,#c2410c,#9a3412); }
    .${BTN}.ai-loading { opacity:1!important;cursor:default;background:linear-gradient(135deg,#4b5563,#374151); }
    ytd-comment-action-buttons-renderer:hover .${BTN},
    ytd-comment-action-buttons-renderer:focus-within .${BTN},
    ytcp-comment-action-buttons:hover .${BTN},
    ytcp-comment-action-buttons:focus-within .${BTN} { opacity:1;transform:scale(1); }
    #ai-panel * { box-sizing:border-box; }
    .ai-tab-btn {
      flex:1;padding:7px 4px;border:none;background:none;color:#6b7280;
      font-size:11px;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;
      font-family:'YouTube Sans',Roboto,sans-serif;transition:color .15s;
    }
    .ai-tab-btn.active { color:#fb923c;border-bottom-color:#ea580c; }
    .ai-tab-btn:hover:not(.active) { color:#d1d5db; }
    .ai-radio-label {
      display:flex;align-items:center;gap:7px;padding:5px 0;
      color:#d1d5db;font-size:11px;cursor:pointer;
    }
    .ai-radio-label input { accent-color:#ea580c;cursor:pointer; }
    .ai-key-item {
      display:flex;align-items:center;justify-content:space-between;
      background:#1f2937;border-radius:6px;padding:5px 8px;margin-bottom:4px;
    }
  `;
  document.head.appendChild(s);
}

// ─── Panel ────────────────────────────────────────────────────────────────────

function createPanel() {
  if (document.getElementById("ai-panel")) return;
  const p = document.createElement("div");
  p.id = "ai-panel";
  p.style.cssText = `position:fixed;bottom:80px;right:20px;width:280px;
    background:#111827;border:1px solid #374151;border-radius:12px;
    z-index:99998;box-shadow:0 8px 32px rgba(0,0,0,.5);
    font-family:'YouTube Sans',Roboto,sans-serif;color:#f9fafb;font-size:12px;`;

  const styleRadios: Array<{id:StyleId;label:string}> = [
    { id:'bait',    label:'🎣 Байт (залучення)' },
    { id:'gentle',  label:'💬 Лагідний' },
    { id:'neutral', label:'📋 Нейтральний' },
    { id:'thanks',  label:'🙏 Подяка' },
    { id:'random',  label:'🎲 Рандом' },
    { id:'custom',  label:'✏️ Свій промпт' },
  ];

  p.innerHTML = `
    <div id="ph" style="display:flex;align-items:center;justify-content:space-between;
      padding:9px 12px 8px;font-weight:700;font-size:13px;
      border-bottom:1px solid #1f2937;cursor:move;border-radius:12px 12px 0 0;user-select:none;">
      <span>✦ Лисий Bot</span>
      <button id="pm" style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:16px;line-height:1;">−</button>
    </div>
    <div id="pb">
      <div style="display:flex;border-bottom:1px solid #1f2937;padding:0 4px;">
        <button class="ai-tab-btn active" data-tab="auto">▶ Авто</button>
        <button class="ai-tab-btn" data-tab="style">🎨 Стиль</button>
        <button class="ai-tab-btn" data-tab="keys">🔑 Ключі</button>
      </div>

      <div id="tab-auto" style="padding:10px 12px 12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <label style="color:#9ca3af;font-size:11px;">Макс. відповідей</label>
          <input id="pn" type="number" min="1" max="200" value="15"
            style="width:55px;background:#1f2937;border:1px solid #374151;border-radius:6px;
            color:#f9fafb;padding:3px 6px;font-size:12px;text-align:center;outline:none;"/>
        </div>
        <div id="pcount" style="font-size:11px;color:#6b7280;text-align:center;margin-bottom:6px;">Рахую коментарі...</div>
        <div id="ps" style="font-size:11px;color:#6b7280;text-align:center;margin-bottom:8px;display:none;"></div>
        <div style="display:flex;gap:6px;margin-bottom:8px;">
          <button id="pgo" style="flex:1;padding:6px;border-radius:8px;border:none;
            background:linear-gradient(135deg,#ea580c,#c2410c);color:#fff;
            font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;">▶ Запустити</button>
          <button id="pst" disabled style="flex:1;padding:6px;border-radius:8px;border:none;
            background:#374151;color:#6b7280;font-size:11px;font-weight:600;cursor:default;font-family:inherit;">■ Стоп</button>
        </div>
        <div id="pl" style="max-height:130px;overflow-y:auto;font-size:10px;color:#9ca3af;line-height:1.6;"></div>
      </div>

      <div id="tab-style" style="display:none;padding:10px 12px 12px;">
        <p style="margin:0 0 6px;color:#9ca3af;font-size:10px;text-transform:uppercase;letter-spacing:.05em;">Стиль відповіді</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;">
          ${styleRadios.map(({id,label}) =>
            `<label class="ai-radio-label" style="padding:4px 0;font-size:10px;">
              <input type="radio" name="ai-style" value="${id}"${id==='neutral'?' checked':''}>
              ${label}
            </label>`
          ).join('')}
        </div>
        <textarea id="custom-prompt-ta" placeholder="Введи системний промпт..." rows="3"
          style="display:none;width:100%;margin-top:8px;background:#1f2937;border:1px solid #374151;
          border-radius:8px;color:#f9fafb;padding:8px;font-size:11px;resize:vertical;outline:none;
          font-family:'YouTube Sans',Roboto,sans-serif;"></textarea>
        <div style="display:flex;gap:10px;margin-top:8px;border-top:1px solid #1f2937;padding-top:8px;">
          <label class="ai-radio-label" style="flex:1;">
            <input type="checkbox" id="filter-offtopic" checked>
            <span style="font-size:10px;">Ігнорувати офтопік</span>
          </label>
        </div>
        <div style="margin-top:8px;border-top:1px solid #1f2937;padding-top:8px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="color:#9ca3af;font-size:10px;white-space:nowrap;">Довжина</span>
            <input id="max-tokens" type="range" min="50" max="300" value="150" step="10"
              style="flex:1;accent-color:#ea580c;cursor:pointer;height:14px;">
            <span id="max-tokens-val" style="color:#f9fafb;font-size:11px;min-width:28px;text-align:right;">150</span>
          </div>
        </div>
        <div style="margin-top:8px;border-top:1px solid #1f2937;padding-top:8px;">
          <div id="lang-toggle" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;">
            <span style="color:#9ca3af;font-size:10px;text-transform:uppercase;letter-spacing:.05em;">Мова: <span id="lang-current" style="color:#fb923c;">Авто</span></span>
            <span id="lang-arrow" style="color:#6b7280;font-size:10px;transition:transform .15s;">▼</span>
          </div>
          <div id="lang-options" style="display:none;margin-top:6px;">
            <div style="display:flex;flex-wrap:wrap;gap:4px;">
              ${(['auto','uk','ru','en','es','pt','de','it','fr'] as LangId[]).map(id => {
                const labels: Record<LangId,string> = { auto:'Авто', uk:'UA', ru:'RU', en:'EN', es:'ES', pt:'PT', de:'DE', it:'IT', fr:'FR' };
                return `<label style="flex:0 0 auto;min-width:34px;display:flex;flex-direction:column;align-items:center;gap:2px;
                  background:#1f2937;border-radius:6px;padding:4px 3px;cursor:pointer;font-size:9px;color:#9ca3af;">
                  <input type="radio" name="ai-lang" value="${id}" style="accent-color:#ea580c;width:12px;height:12px;"${id==='auto'?' checked':''}>
                  ${labels[id]}
                </label>`;
              }).join('')}
            </div>
            <p style="margin:4px 0 0;color:#4b5563;font-size:9px;">Авто = мова коментаря</p>
          </div>
        </div>
      </div>

      <div id="tab-keys" style="display:none;padding:10px 12px 12px;">
        <div id="keys-list" style="margin-bottom:8px;max-height:150px;overflow-y:auto;"></div>
        <div style="display:flex;gap:6px;">
          <input id="key-input" type="password" placeholder="gsk_..."
            style="flex:1;background:#1f2937;border:1px solid #374151;border-radius:6px;
            color:#f9fafb;padding:5px 8px;font-size:11px;outline:none;min-width:0;"/>
          <button id="key-add" style="padding:5px 12px;border-radius:6px;border:none;
            background:#ea580c;color:#fff;font-size:15px;font-weight:700;cursor:pointer;">+</button>
        </div>
        <p style="margin:6px 0 0;color:#4b5563;font-size:10px;">Ключі чергуються автоматично. При ліміті — наступний.</p>
      </div>
      <div style="padding:6px 12px 10px;border-top:1px solid #1f2937;display:flex;gap:6px;">
        <a href="https://t.me/diamondehead" target="_blank" rel="noopener"
          style="flex:1;display:flex;align-items:center;justify-content:center;gap:4px;
          padding:5px;border-radius:6px;background:#1f2937;color:#9ca3af;font-size:10px;
          text-decoration:none;cursor:pointer;transition:background .15s,color .15s;"
          onmouseover="this.style.background='#374151';this.style.color='#f9fafb'"
          onmouseout="this.style.background='#1f2937';this.style.color='#9ca3af'">
          ✈ Telegram
        </a>
        <a href="https://www.youtube.com/@cryptonikaua?sub_confirmation=1" target="_blank" rel="noopener"
          style="flex:1;display:flex;align-items:center;justify-content:center;gap:4px;
          padding:5px;border-radius:6px;background:linear-gradient(135deg,#ea580c,#c2410c);
          color:#fff;font-size:10px;font-weight:600;text-decoration:none;cursor:pointer;
          transition:opacity .15s;"
          onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
          ▶ Підписатись
        </a>
      </div>
    </div>`;
  document.body.appendChild(p);

  // Minimize
  const body = p.querySelector<HTMLElement>("#pb")!;
  const minB = p.querySelector<HTMLElement>("#pm")!;
  let mini = false;
  minB.addEventListener("click", () => {
    mini = !mini;
    body.style.display = mini ? "none" : "";
    minB.textContent = mini ? "+" : "−";
  });

  // Drag
  let drag = false, ox = 0, oy = 0;
  p.querySelector<HTMLElement>("#ph")!.addEventListener("mousedown", e => {
    drag = true; ox = e.clientX - p.getBoundingClientRect().left; oy = e.clientY - p.getBoundingClientRect().top; e.preventDefault();
  });
  document.addEventListener("mousemove", e => {
    if (!drag) return;
    p.style.right = "auto"; p.style.bottom = "auto";
    p.style.left = `${e.clientX-ox}px`; p.style.top = `${e.clientY-oy}px`;
  });
  document.addEventListener("mouseup", () => { drag = false; });

  // Tabs
  const tabBtns = p.querySelectorAll<HTMLElement>(".ai-tab-btn");
  const tabContents: Record<string,HTMLElement> = {
    auto:  p.querySelector<HTMLElement>("#tab-auto")!,
    style: p.querySelector<HTMLElement>("#tab-style")!,
    keys:  p.querySelector<HTMLElement>("#tab-keys")!,
  };
  tabBtns.forEach(btn => btn.addEventListener("click", () => {
    tabBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    Object.values(tabContents).forEach(c => c.style.display = "none");
    tabContents[btn.dataset.tab!].style.display = "";
  }));

  // ── Auto tab ──
  const goBtn   = p.querySelector<HTMLButtonElement>("#pgo")!;
  const stBtn   = p.querySelector<HTMLButtonElement>("#pst")!;
  const statsEl = p.querySelector<HTMLElement>("#ps")!;
  const countEl = p.querySelector<HTMLElement>("#pcount")!;
  const logEl   = p.querySelector<HTMLElement>("#pl")!;
  const maxInp  = p.querySelector<HTMLInputElement>("#pn")!;

  const addLog = (m: string) => {
    const d = document.createElement("div");
    d.style.borderBottom = "1px solid #1f2937";
    d.textContent = m; logEl.prepend(d);
    while (logEl.children.length > 50) logEl.lastElementChild?.remove();
  };
  _panelLog = addLog;

  // Live comment count
  updateCommentCount = () => {
    const n = getUnansweredComments().length;
    const w = n === 1 ? 'коментар' : (n >= 2 && n <= 4) ? 'коментарі' : 'коментарів';
    countEl.textContent = n > 0
      ? `${n} ${w} без відповіді`
      : "Немає нових коментарів";
    countEl.style.color = n > 0 ? "#34d399" : "#6b7280";
  };
  updateCommentCount();

  goBtn.addEventListener("click", () => {
    if (autoRunning) return;
    const max = Math.min(Math.max(parseInt(maxInp.value)||15, 1), 200);
    goBtn.disabled = true;
    stBtn.disabled = false; stBtn.style.color = "#d1d5db"; stBtn.style.cursor = "pointer";
    logEl.innerHTML = "";
    countEl.style.display = "none";
    statsEl.style.display = ""; statsEl.textContent = "Запуск...";
    runAuto(max, addLog,
      (done,total) => { statsEl.textContent = `${done} / ${total}`; },
      () => {
        goBtn.disabled = false; stBtn.disabled = true; stBtn.style.color = "#6b7280";
        setTimeout(() => {
          statsEl.style.display = "none";
          countEl.style.display = "";
          updateCommentCount?.();
        }, 3000);
      }
    );
  });
  stBtn.addEventListener("click", () => { autoStopped = true; stBtn.disabled = true; });

  // ── Style tab ──
  const radios   = p.querySelectorAll<HTMLInputElement>('input[name="ai-style"]');
  const customTA = p.querySelector<HTMLTextAreaElement>("#custom-prompt-ta")!;
  const filterCb = p.querySelector<HTMLInputElement>("#filter-offtopic")!;

  chrome.storage.local.get(['selectedStyle','customPrompt','filterOffTopic'], r => {
    const saved = r.selectedStyle || 'neutral';
    radios.forEach(r2 => { if (r2.value === saved) r2.checked = true; });
    customTA.value = r.customPrompt || '';
    customTA.style.display = saved === 'custom' ? '' : 'none';
    filterCb.checked = r.filterOffTopic !== false;
  });

  radios.forEach(r2 => r2.addEventListener("change", () => {
    SEL_STYLE = r2.value as StyleId;
    customTA.style.display = r2.value === 'custom' ? '' : 'none';
    saveSettings({ selectedStyle: SEL_STYLE });
  }));
  customTA.addEventListener("input", () => { CUSTOM_PROMPT = customTA.value; saveSettings({ customPrompt: CUSTOM_PROMPT }); });
  filterCb.addEventListener("change", () => { FILTER_OFFTOPIC = filterCb.checked; saveSettings({ filterOffTopic: FILTER_OFFTOPIC }); });

  // Max tokens slider
  const tokensSlider = p.querySelector<HTMLInputElement>("#max-tokens")!;
  const tokensVal = p.querySelector<HTMLElement>("#max-tokens-val")!;
  chrome.storage.local.get('maxTokens', r => {
    const saved = r.maxTokens || 150;
    tokensSlider.value = String(saved);
    tokensVal.textContent = String(saved);
  });
  tokensSlider.addEventListener("input", () => {
    const v = parseInt(tokensSlider.value);
    tokensVal.textContent = String(v);
    MAX_TOKENS = v;
    saveSettings({ maxTokens: v });
  });

  // Language spoiler toggle
  const langToggle = p.querySelector<HTMLElement>("#lang-toggle")!;
  const langOptions = p.querySelector<HTMLElement>("#lang-options")!;
  const langArrow = p.querySelector<HTMLElement>("#lang-arrow")!;
  const langCurrent = p.querySelector<HTMLElement>("#lang-current")!;
  const langLabels: Record<string,string> = { auto:'Авто', uk:'UA', ru:'RU', en:'EN', es:'ES', pt:'PT', de:'DE', it:'IT', fr:'FR' };

  langToggle.addEventListener("click", () => {
    const open = langOptions.style.display === "none";
    langOptions.style.display = open ? "" : "none";
    langArrow.style.transform = open ? "rotate(180deg)" : "";
  });

  // Language radios
  const langRadios = p.querySelectorAll<HTMLInputElement>('input[name="ai-lang"]');
  chrome.storage.local.get('replyLang', r => {
    const saved = r.replyLang || 'auto';
    langRadios.forEach(r2 => { if (r2.value === saved) r2.checked = true; });
    langCurrent.textContent = langLabels[saved] || 'Авто';
  });
  langRadios.forEach(r2 => r2.addEventListener("change", () => {
    REPLY_LANG = r2.value as LangId;
    langCurrent.textContent = langLabels[r2.value] || r2.value;
    saveSettings({ replyLang: REPLY_LANG });
  }));

  // ── Keys tab ──
  const keysList  = p.querySelector<HTMLElement>("#keys-list")!;
  const keyInput  = p.querySelector<HTMLInputElement>("#key-input")!;
  const keyAddBtn = p.querySelector<HTMLButtonElement>("#key-add")!;

  refreshKeysUI = () => {
    keysList.innerHTML = "";
    if (!GROQ_KEYS.length) {
      keysList.innerHTML = `<p style="color:#4b5563;font-size:10px;margin:0 0 4px;">Ще немає ключів</p>`;
      return;
    }
    GROQ_KEYS.forEach((k, i) => {
      const limited = (keyLimitedUntil.get(i)||0) > Date.now();
      const active  = ((groqKeyIdx - 1 + GROQ_KEYS.length) % GROQ_KEYS.length) === i;
      const masked  = k.slice(0,6)+"..."+k.slice(-4);
      const item = document.createElement("div");
      item.className = "ai-key-item";
      item.innerHTML = `
        <span style="font-size:10px;color:${limited?'#ef4444':active?'#34d399':'#9ca3af'};">
          ${limited?'⚠':active?'●':'○'} ${masked}
        </span>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:9px;color:${limited?'#ef4444':'#4b5563'};">${limited?'ліміт':`#${i+1}`}</span>
          <button data-idx="${i}" style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:14px;line-height:1;">×</button>
        </div>`;
      item.querySelector("button")!.addEventListener("click", () => {
        GROQ_KEYS.splice(i,1);
        // Rebuild limitedUntil map with shifted indices
        const newMap = new Map<number, number>();
        keyLimitedUntil.forEach((exp, idx) => {
          if (idx < i) newMap.set(idx, exp);
          else if (idx > i) newMap.set(idx - 1, exp);
        });
        keyLimitedUntil.clear();
        newMap.forEach((exp, idx) => keyLimitedUntil.set(idx, exp));
        if (groqKeyIdx > i) groqKeyIdx = Math.max(0, groqKeyIdx - 1);
        else if (groqKeyIdx >= GROQ_KEYS.length && GROQ_KEYS.length) groqKeyIdx = 0;
        saveSettings({ groqKeys: GROQ_KEYS }); refreshKeysUI!();
      });
      keysList.appendChild(item);
    });
  };
  refreshKeysUI();

  keyAddBtn.addEventListener("click", () => {
    const k = keyInput.value.trim();
    if (!k || !k.startsWith("gsk_")) { toast("⚠ Ключ має починатись з gsk_"); return; }
    if (GROQ_KEYS.includes(k)) { toast("Цей ключ вже є"); return; }
    GROQ_KEYS.push(k); saveSettings({ groqKeys: GROQ_KEYS });
    keyInput.value = ""; refreshKeysUI!(); toast("✓ Ключ додано");
  });
  keyInput.addEventListener("keydown", e => { if (e.key==="Enter") keyAddBtn.click(); });
}

// ─── Toggle message ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const panel = document.getElementById("ai-panel");
  if (msg.type === "GET_PANEL_STATE") {
    sendResponse({ visible: panel ? panel.style.display !== "none" : false });
  }
  if (msg.type === "TOGGLE_PANEL" && panel) {
    const nowVisible = panel.style.display === "none";
    panel.style.display = nowVisible ? "" : "none";
    sendResponse({ visible: nowVisible });
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

let _t: ReturnType<typeof setTimeout> | null = null;
new MutationObserver(() => {
  if (_t) clearTimeout(_t);
  _t = setTimeout(scanAndInject, 500);
}).observe(document.body, { childList:true, subtree:true });

function init() {
  injectStyles();
  createPanel();
  scanAndInject();
  console.log("[AI Reply] ready");
}

window.addEventListener("yt-navigate-finish", () => setTimeout(scanAndInject, 1000));
const _ph = history.pushState.bind(history);
history.pushState = function(...a) { _ph(...a); setTimeout(scanAndInject, 1000); };
document.readyState === "loading"
  ? document.addEventListener("DOMContentLoaded", init)
  : init();
