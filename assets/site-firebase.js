// TOP ページの意見・要望の受け付け（アクセスカウンタは visit-counter.js）。
// 保存先は Firebase（Firestore）。読み書きできる範囲は firebase/firestore.rules で決めている。
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc, getDoc, updateDoc, collection, query, where, orderBy, limit,
  startAfter, getDocs, writeBatch, serverTimestamp, deleteField,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { app, db, todayInt } from "./firebase-app.js";

const APPS = ["SpiceClock", "CalendarJP", "Fast Mirror", "Quark Timer", "その他"];
const ADMIN_PAGE_SIZE = 20;

const auth = getAuth(app);

function formatDate(ts) {
  if (!ts || typeof ts.toDate !== "function") return "";
  const d = ts.toDate();
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c) node.append(c);
  return node;
}

// ---- 意見・要望 ----

const ui = {
  who: () => document.getElementById("opinion-who"),
  body: () => document.getElementById("opinion-body"),
};

// ---- 新着の数（閉じていてもタイトルの横に出す） ----
// 最後に意見板を開いて見た時刻をブラウザに覚えておき、それより新しいものを数える

const ADMIN_NEW_SCAN = 50;
let seenKey = null;

function panelOpen() {
  const panel = document.getElementById("opinion-panel");
  return !panel || !panel.hidden;
}

function seenAt(user) {
  try { return Number(localStorage.getItem(`opinion-seen-${user.uid}`)) || 0; } catch { return 0; }
}

function showBadge(count) {
  const badge = document.getElementById("opinion-badge");
  if (!badge) return;
  badge.hidden = count <= 0;
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.setAttribute("aria-label", `新着 ${count} 件`);
}

function markSeen() {
  if (!seenKey) return;
  try { localStorage.setItem(seenKey, String(Date.now())); } catch { /* 覚えられなくても動かす */ }
  showBadge(0);
}

// 開いていれば見たことにし、閉じていれば数を出す
function reportNew(user, count) {
  seenKey = `opinion-seen-${user.uid}`;
  if (panelOpen()) markSeen();
  else showBadge(count);
}

function clearNew() {
  seenKey = null;
  showBadge(0);
}

const millis = (ts) => ts?.toMillis?.() ?? 0;

// ---- スレッド（意見の下に続くやり取り） ----
// opinions/{id}.thread は { m0: { by, text, at }, m1: ... } の形。by は "user"（送った人）か "dev"（開発者）

const THREAD_MAX = 100;

function threadList(m) {
  const thread = m.thread || {};
  return Object.keys(thread)
    .filter((k) => /^m[0-9]+$/.test(k))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .map((k) => ({ key: k, ...thread[k] }));
}

// 開発者が書いた時刻と、送った人が書いた時刻
function devTimes(m) {
  return [millis(m.reply?.at), ...threadList(m).filter((t) => t.by === "dev").map((t) => millis(t.at))];
}
function userTimes(m) {
  return [millis(m.createdAt), millis(m.editedAt), ...threadList(m).filter((t) => t.by === "user").map((t) => millis(t.at))];
}
// 最後に書いたのが送った人（開発者の返事待ち）
function waitingForDev(m) {
  return Math.max(...userTimes(m)) > Math.max(...devTimes(m));
}

// いまの最後に 1 件足す。番号がずれないよう、足す直前に読み直す
async function appendThread(id, by, text) {
  const ref = doc(db, "opinions", id);
  const fresh = (await getDoc(ref)).data();
  const count = Object.keys(fresh.thread || {}).length;
  if (count >= THREAD_MAX) throw new Error("thread-full");
  await updateDoc(ref, { ["thread.m" + count]: { by, text, at: serverTimestamp() } });
}

// 自分が書いた 1 件を直す・消す。editKey でどれを変えるかをルールに伝える。
// 消しても番号は詰めず、「削除しました」の印だけ残す
function editThread(id, key, text) {
  return updateDoc(doc(db, "opinions", id), {
    editKey: key,
    ["thread." + key + ".text"]: text,
    ["thread." + key + ".editedAt"]: serverTimestamp(),
  });
}
function deleteThread(id, key) {
  return updateDoc(doc(db, "opinions", id), {
    editKey: key,
    ["thread." + key + ".text"]: "",
    ["thread." + key + ".deleted"]: true,
    ["thread." + key + ".editedAt"]: serverTimestamp(),
  });
}

// viewer は "user" か "dev"。自分が書いたものにだけ「修正」「削除」を出す
function threadNodes(m, viewer, id, reload) {
  return threadList(m).map((t) => {
    const who = t.by === "dev" ? "開発者より" : (viewer === "dev" ? "送った人より" : "あなた");
    const node = el("div", { class: t.by === "dev" ? "opinion-reply" : "opinion-reply opinion-reply-user" });
    if (t.deleted) {
      node.append(el("div", { class: "opinion-meta", text: who + " ・ " + formatDate(t.at) + " ・ 削除しました" }));
      return node;
    }
    const meta = el("div", { class: "opinion-meta", text: who + " ・ " + formatDate(t.at) + editedLabel(t.editedAt) });
    const show = () => {
      node.replaceChildren(meta, el("p", { text: t.text }));
      if (t.by !== viewer) return;
      const status = el("span", { class: "opinion-status" });
      const actions = el("div", { class: "opinion-row opinion-actions" });
      const normal = () => actions.replaceChildren(
        el("button", {
          class: "btn link", type: "button", text: "修正",
          onclick: () => node.replaceChildren(meta, editForm({
            initial: t.text, maxlength: viewer === "dev" ? 4000 : 2000, label: "返信の修正", saveText: "修正を保存",
            save: (text) => editThread(id, t.key, text),
            onDone: reload,
            onCancel: show,
          })),
        }),
        el("button", {
          class: "btn link", type: "button", text: "削除",
          onclick: () => actions.replaceChildren(
            el("span", { class: "opinion-status", text: "この返信を削除しますか？" }),
            el("button", {
              class: "btn link", type: "button", text: "削除する",
              onclick: async (event) => {
                event.target.disabled = true;
                try {
                  await deleteThread(id, t.key);
                  await reload();
                } catch (e) {
                  console.warn(e);
                  normal();
                  setStatus(status, "削除できませんでした。", true);
                  actions.append(status);
                }
              },
            }),
            el("button", { class: "btn link", type: "button", text: "やめる", onclick: normal }),
          ),
        }),
      );
      normal();
      node.append(actions);
    };
    show();
    return node;
  });
}

// ---- 意見 1 件ごとの開閉 ----
// 開いた意見は覚えておき、保存して描き直しても開いたままにする

const openIds = new Set();

function itemShell({ id, meta, preview, flag, open }, ...children) {
  const summary = el("summary", { class: "opinion-summary" },
    el("span", { text: meta }),
    flag ? el("span", { class: "opinion-flag", text: flag }) : null,
    el("span", { class: "opinion-preview", text: " ― " + preview.replace(/\s+/g, " ").slice(0, 80) }),
  );
  const body = el("div", { class: "opinion-item-body" }, ...children);
  const item = el("details", { class: "opinion-item" }, summary, body);
  if (open || openIds.has(id)) { item.open = true; openIds.add(id); }
  item.addEventListener("toggle", () => {
    if (item.open) openIds.add(id);
    else openIds.delete(id);
  });
  return item;
}

// 開発者: 送った人からの新しい書き込み（意見・修正・スレッドの返信）がある意見の数。
// 初めてのブラウザでは、返事待ちの意見を数える
async function countAdminNew(user) {
  try {
    const seen = seenAt(user);
    const snap = await getDocs(query(collection(db, "opinions"), orderBy("createdAt", "desc"), limit(ADMIN_NEW_SCAN)));
    const items = snap.docs.map((d) => d.data());
    const count = seen
      ? items.filter((m) => Math.max(...userTimes(m)) > seen).length
      : items.filter(waitingForDev).length;
    reportNew(user, count);
  } catch (e) {
    console.warn(e);
  }
}

function setStatus(node, text, isError = false) {
  node.textContent = text;
  node.classList.toggle("is-error", isError);
}

function renderGuest() {
  clearNew();
  ui.who().replaceChildren();
  const status = el("p", { class: "opinion-status" });
  const btn = el("button", {
    class: "btn primary", type: "button", id: "opinion-login", text: "Google でログインして書く",
    onclick: async () => {
      btn.disabled = true;
      try {
        await signInWithPopup(auth, new GoogleAuthProvider());
      } catch (e) {
        if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
          setStatus(status, "ログインできませんでした。ポップアップがブロックされていないか確認して、もう一度お試しください。", true);
        }
      } finally {
        btn.disabled = false;
      }
    },
  });
  ui.body().replaceChildren(el("div", {}, btn), status);
}

function renderWho(user, label) {
  ui.who().replaceChildren(
    el("span", { text: label ?? user.email ?? "" }),
    el("button", { class: "btn link", type: "button", text: "ログアウト", onclick: () => signOut(auth) }),
  );
}

function replyNode(reply) {
  if (!reply) return null;
  return el("div", { class: "opinion-reply" },
    el("div", { class: "opinion-meta", text: `開発者より ・ ${formatDate(reply.at)}` }),
    el("p", { text: reply.text }),
  );
}

function editedLabel(ts) {
  return ts ? ` ・ 修正 ${formatDate(ts)}` : "";
}

// 文章をその場で直すフォーム。save(text) が終わったら onDone を呼ぶ
function editForm({ initial, maxlength, label, saveText, save, onDone, onCancel }) {
  const ta = el("textarea", { maxlength: String(maxlength), "aria-label": label });
  ta.value = initial;
  const status = el("p", { class: "opinion-status" });
  const cancel = el("button", { class: "btn small", type: "button", text: "やめる", onclick: onCancel });
  const send = el("button", {
    class: "btn primary small", type: "button", text: saveText,
    onclick: async () => {
      const text = ta.value.trim();
      if (!text) { setStatus(status, "内容を書いてから保存してください。", true); return; }
      if (text === initial) { onCancel(); return; }
      send.disabled = true;
      cancel.disabled = true;
      try {
        await save(text);
        await onDone();
      } catch (e) {
        console.warn(e);
        setStatus(status, "保存できませんでした。時間をおいてから、もう一度お試しください。", true);
        send.disabled = false;
        cancel.disabled = false;
      }
    },
  });
  const form = el("div", { class: "opinion-form" }, ta, el("div", { class: "opinion-row" }, status, el("div", { class: "opinion-row" }, cancel, send)));
  queueMicrotask(() => ta.focus());
  return form;
}

async function sendOpinion(user, appName, text) {
  const limitRef = doc(db, "limits", user.uid);
  const snap = await getDoc(limitRef);
  const day = todayInt();
  const count = snap.exists() && snap.data().day === day ? snap.data().count + 1 : 1;
  const batch = writeBatch(db);
  batch.set(limitRef, { last: serverTimestamp(), day, count });
  batch.set(doc(collection(db, "opinions")), {
    uid: user.uid, app: appName, text, createdAt: serverTimestamp(),
  });
  await batch.commit();
}

async function renderUser(user) {
  renderWho(user);
  const select = el("select", { id: "opinion-app" }, ...APPS.map((a) => el("option", { text: a })));
  const textarea = el("textarea", {
    id: "opinion-text", maxlength: "2000", "aria-label": "意見の内容",
    placeholder: "起きたことや要望を書いてください。版（例: v0.6.3）があると助かります",
  });
  const status = el("p", { class: "opinion-status", text: "1分に1件まで ・ 1日10件まで ・ 2000文字まで" });
  const list = el("div", { class: "opinion-list" });
  const send = el("button", {
    class: "btn primary", type: "button", id: "opinion-send", text: "送る",
    onclick: async () => {
      const text = textarea.value.trim();
      if (!text) { setStatus(status, "内容を書いてから送ってください。", true); return; }
      send.disabled = true;
      try {
        await sendOpinion(user, select.value, text);
        textarea.value = "";
        setStatus(status, "送りました。ありがとうございます。");
        await loadMine(user, list);
      } catch (e) {
        console.warn(e);
        setStatus(status, e.code === "permission-denied"
          ? "送る間隔が短いか、今日の上限（10件）に達しています。時間をおいてから送ってください。"
          : "送れませんでした。時間をおいてから、もう一度お試しください。", true);
      } finally {
        send.disabled = false;
      }
    },
  });
  ui.body().replaceChildren(
    el("div", { class: "opinion-form" },
      el("div", { class: "opinion-row" },
        el("label", { class: "opinion-hint", for: "opinion-app", text: "どのアプリについて" }),
        select,
      ),
      textarea,
      el("div", { class: "opinion-row" }, status, send),
      el("p", {
        class: "opinion-hint",
        text: "すべて読んでいますが、個別の返信はお約束できません。返信はこのページに表示されます（メールでのお知らせはありません）。送ったものは、あとから「修正する」で直せます。返信が付いたら、その下に続けて書けます。",
      }),
    ),
    list,
  );
  await loadMine(user, list);
}

async function loadMine(user, list) {
  try {
    const snap = await getDocs(query(collection(db, "opinions"), where("uid", "==", user.uid)));
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
    // 本人: 前に見たあとに開発者が書いた（または直した）返信の数
    const seen = seenAt(user);
    reportNew(user, items.reduce((n, m) => n + devTimes(m).filter((t) => t > seen).length, 0));
    if (items.length === 0) { list.replaceChildren(); return; }
    list.replaceChildren(
      el("h3", { text: "あなたが送ったもの" }),
      ...items.map((m) => mineItem(m, seen, () => loadMine(user, list))),
    );
  } catch (e) {
    console.warn(e);
    list.replaceChildren(el("p", { class: "opinion-status is-error", text: "送ったものを読み込めませんでした。" }));
  }
}

function mineItem(m, seen, reload) {
  const body = el("div");
  const showText = () => body.replaceChildren(
    el("p", { text: m.text }),
    el("button", {
      class: "btn small", type: "button", text: "修正する",
      onclick: () => body.replaceChildren(editForm({
        initial: m.text, maxlength: 2000, label: "意見の内容の修正", saveText: "修正を保存",
        save: (text) => updateDoc(doc(db, "opinions", m.id), { text, editedAt: serverTimestamp() }),
        onDone: reload,
        onCancel: showText,
      })),
    }),
  );
  showText();

  // 開発者の返信があれば「返信を書く」、まだなければ「追記する」
  const answered = Boolean(m.reply) || threadList(m).some((t) => t.by === "dev");
  const slot = el("div");
  const showButton = () => slot.replaceChildren(el("button", {
    class: "btn small", type: "button", text: answered ? "返信を書く" : "追記する",
    onclick: () => slot.replaceChildren(editForm({
      initial: "", maxlength: 2000, label: answered ? "返信" : "追記", saveText: "送る",
      save: (text) => appendThread(m.id, "user", text),
      onDone: reload,
      onCancel: showButton,
    })),
  }));
  showButton();

  // 前に見たあとに開発者の返信が付いたものは、開いた状態で出す
  const hasNew = devTimes(m).some((t) => t > seen);
  return itemShell(
    {
      id: m.id,
      meta: m.app + " ・ " + formatDate(m.createdAt) + editedLabel(m.editedAt),
      preview: m.text,
      flag: hasNew ? "新しい返信" : (answered ? "返信あり" : ""),
      open: hasNew,
    },
    body,
    replyNode(m.reply),
    ...threadNodes(m, "user", m.id, reload),
    slot,
  );
}

async function renderAdmin(user) {
  renderWho(user, "開発者として表示中");
  const list = el("div", { class: "opinion-list" }, el("h3", { text: "届いた意見（新しい順）" }));
  const more = el("button", { class: "btn small", type: "button", text: "さらに読み込む" });
  ui.body().replaceChildren(list, more);
  let cursor = null;

  async function loadPage() {
    more.disabled = true;
    try {
      const q = cursor
        ? query(collection(db, "opinions"), orderBy("createdAt", "desc"), startAfter(cursor), limit(ADMIN_PAGE_SIZE))
        : query(collection(db, "opinions"), orderBy("createdAt", "desc"), limit(ADMIN_PAGE_SIZE));
      const snap = await getDocs(q);
      if (!cursor && snap.empty) list.append(el("p", { class: "opinion-status", text: "まだ届いていません。" }));
      snap.docs.forEach((d) => list.append(adminItem(d.id, d.data())));
      cursor = snap.docs[snap.docs.length - 1] ?? cursor;
      more.hidden = snap.docs.length < ADMIN_PAGE_SIZE;
    } catch (e) {
      console.warn(e);
      list.append(el("p", { class: "opinion-status is-error", text: "読み込めませんでした。" }));
    } finally {
      more.disabled = false;
    }
  }
  more.addEventListener("click", loadPage);
  await Promise.all([loadPage(), countAdminNew(user)]);
}

// メールアドレスの代わりに出す印。同じ人からの意見かどうかを見分けるためだけのもの
function userLabel(uid) {
  return "アプリユーザー：" + String(uid || "").slice(0, 4).toLowerCase();
}

function adminItem(id, m) {
  const ref = doc(db, "opinions", id);
  // 以前は意見と一緒にメールアドレスを保存していた。残っていたら消す
  if (m.email) updateDoc(ref, { email: deleteField() }).catch((e) => console.warn(e));
  let item = null;
  // 保存したら読み直して、この 1 件を描き直す
  const refresh = async () => item.replaceWith(adminItem(id, (await getDoc(ref)).data()));

  // 最初の返信（あとから修正できる）
  const first = el("div");
  const showFirst = () => first.replaceChildren(
    replyNode(m.reply),
    el("button", {
      class: "btn small", type: "button", text: "返信を修正する",
      onclick: () => first.replaceChildren(editForm({
        initial: m.reply.text, maxlength: 4000, label: "返信の修正", saveText: "修正を保存",
        save: (text) => updateDoc(ref, { reply: { text, at: serverTimestamp() } }),
        onDone: refresh,
        onCancel: showFirst,
      })),
    }),
  );
  if (m.reply) showFirst();

  // 返信欄。まだ何も続いていなければ最初の返信として、続いていればスレッドの最後に足す
  const started = Boolean(m.reply) || threadList(m).length > 0;
  const slot = el("div");
  const showButton = () => slot.replaceChildren(el("button", {
    class: "btn small", type: "button", text: started ? "返信を書く" : "返信を書く（任意）",
    onclick: () => slot.replaceChildren(
      editForm({
        initial: "", maxlength: 4000, label: "返信", saveText: "返信する",
        save: (text) => (started
          ? appendThread(id, "dev", text)
          : updateDoc(ref, { reply: { text, at: serverTimestamp() } })),
        onDone: refresh,
        onCancel: showButton,
      }),
      el("p", { class: "opinion-hint", text: "送った人にだけ見えます" }),
    ),
  }));
  showButton();

  // 返事待ちのものは、開いた状態で出す
  const waiting = waitingForDev(m);
  item = itemShell(
    {
      id,
      meta: m.app + " ・ " + formatDate(m.createdAt) + editedLabel(m.editedAt) + " ・ " + userLabel(m.uid),
      preview: m.text,
      flag: waiting ? "返事待ち" : "返信済み",
      open: waiting,
    },
    el("p", { text: m.text }),
    first,
    ...threadNodes(m, "dev", id, refresh),
    slot,
  );
  return item;
}

async function isAdmin(user) {
  try {
    return (await getDoc(doc(db, "admins", user.uid))).exists();
  } catch {
    return false;
  }
}

function runOpinionBox() {
  if (!document.getElementById("opinion-body")) return;
  // 開閉は index.html 側で先に処理される。開いたら見たことにする
  document.getElementById("opinion-toggle")?.addEventListener("click", () => {
    if (panelOpen()) markSeen();
  });
  onAuthStateChanged(auth, async (user) => {
    if (!user) { renderGuest(); return; }
    if (await isAdmin(user)) await renderAdmin(user);
    else await renderUser(user);
  });
}

runOpinionBox();
