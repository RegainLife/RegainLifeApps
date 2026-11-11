// TOP ページの意見・要望の受け付け（アクセスカウンタは visit-counter.js）。
// 保存先は Firebase（Firestore）。読み書きできる範囲は firebase/firestore.rules で決めている。
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc, getDoc, updateDoc, collection, query, where, orderBy, limit,
  startAfter, getDocs, writeBatch, serverTimestamp,
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

function setStatus(node, text, isError = false) {
  node.textContent = text;
  node.classList.toggle("is-error", isError);
}

function renderGuest() {
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
    uid: user.uid, email: user.email, app: appName, text, createdAt: serverTimestamp(),
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
        text: "すべて読んでいますが、個別の返信はお約束できません。返信はこのページに表示されます（メールでのお知らせはありません）。送ったものは、あとから「修正する」で直せます。",
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
    if (items.length === 0) { list.replaceChildren(); return; }
    list.replaceChildren(
      el("h3", { text: "あなたが送ったもの" }),
      ...items.map((m) => mineItem(m, () => loadMine(user, list))),
    );
  } catch (e) {
    console.warn(e);
    list.replaceChildren(el("p", { class: "opinion-status is-error", text: "送ったものを読み込めませんでした。" }));
  }
}

function mineItem(m, reload) {
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
  return el("div", { class: "opinion-item" },
    el("div", { class: "opinion-meta", text: `${m.app} ・ ${formatDate(m.createdAt)}${editedLabel(m.editedAt)}` }),
    body,
    replyNode(m.reply),
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
  await loadPage();
}

function adminItem(id, m) {
  const slot = el("div");
  const ref = doc(db, "opinions", id);

  const saveReply = async (text) => {
    await updateDoc(ref, { reply: { text, at: serverTimestamp() } });
    m.reply = (await getDoc(ref)).data().reply;
  };

  function showReply() {
    if (!m.reply) {
      slot.replaceChildren(el("button", {
        class: "btn small", type: "button", text: "返信を書く（任意）",
        onclick: () => showForm("", "返信する"),
      }));
      return;
    }
    slot.replaceChildren(
      replyNode(m.reply),
      el("button", {
        class: "btn small", type: "button", text: "返信を修正する",
        onclick: () => showForm(m.reply.text, "修正を保存"),
      }),
    );
  }

  function showForm(initial, saveText) {
    slot.replaceChildren(
      editForm({
        initial, maxlength: 4000, label: "返信", saveText,
        save: saveReply, onDone: showReply, onCancel: showReply,
      }),
      el("p", { class: "opinion-hint", text: "送った人にだけ見えます" }),
    );
  }

  showReply();
  return el("div", { class: "opinion-item" },
    el("div", { class: "opinion-meta", text: `${m.app} ・ ${formatDate(m.createdAt)}${editedLabel(m.editedAt)} ・ ${m.email}` }),
    el("p", { text: m.text }),
    slot,
  );
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
  onAuthStateChanged(auth, async (user) => {
    if (!user) { renderGuest(); return; }
    if (await isAdmin(user)) await renderAdmin(user);
    else await renderUser(user);
  });
}

runOpinionBox();
