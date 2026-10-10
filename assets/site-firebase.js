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
  ui.body().replaceChildren(
    el("div", { class: "opinion-row opinion-start" },
      btn,
      el("a", { class: "opinion-hint", href: "./privacy.html", text: "プライバシーポリシー" }),
    ),
    status,
  );
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
        text: "すべて読んでいますが、個別の返信はお約束できません。返信はこのページに表示されます（メールでのお知らせはありません）。",
      }),
    ),
    list,
  );
  await loadMine(user, list);
}

async function loadMine(user, list) {
  try {
    const snap = await getDocs(query(collection(db, "opinions"), where("uid", "==", user.uid)));
    const items = snap.docs.map((d) => d.data())
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
    if (items.length === 0) { list.replaceChildren(); return; }
    list.replaceChildren(
      el("h3", { text: "あなたが送ったもの" }),
      ...items.map((m) => el("div", { class: "opinion-item" },
        el("div", { class: "opinion-meta", text: `${m.app} ・ ${formatDate(m.createdAt)}` }),
        el("p", { text: m.text }),
        replyNode(m.reply),
      )),
    );
  } catch (e) {
    console.warn(e);
    list.replaceChildren(el("p", { class: "opinion-status is-error", text: "送ったものを読み込めませんでした。" }));
  }
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
  const item = el("div", { class: "opinion-item" },
    el("div", { class: "opinion-meta", text: `${m.app} ・ ${formatDate(m.createdAt)} ・ ${m.email}` }),
    el("p", { text: m.text }),
  );
  if (m.reply) { item.append(replyNode(m.reply)); return item; }

  const slot = el("div");
  slot.append(el("button", {
    class: "btn small", type: "button", text: "返信を書く（任意）",
    onclick: () => {
      const ta = el("textarea", { maxlength: "4000", "aria-label": "返信" });
      const status = el("p", { class: "opinion-status", text: "送った人にだけ見えます" });
      const send = el("button", {
        class: "btn primary small", type: "button", text: "返信する",
        onclick: async () => {
          const text = ta.value.trim();
          if (!text) return;
          send.disabled = true;
          try {
            await updateDoc(doc(db, "opinions", id), { reply: { text, at: serverTimestamp() } });
            const fresh = await getDoc(doc(db, "opinions", id));
            slot.replaceWith(replyNode(fresh.data().reply));
          } catch (e) {
            console.warn(e);
            setStatus(status, "返信を保存できませんでした。", true);
            send.disabled = false;
          }
        },
      });
      slot.replaceChildren(el("div", { class: "opinion-form" }, ta, el("div", { class: "opinion-row" }, status, send)));
      ta.focus();
    },
  }));
  item.append(slot);
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
  onAuthStateChanged(auth, async (user) => {
    if (!user) { renderGuest(); return; }
    if (await isAdmin(user)) await renderAdmin(user);
    else await renderUser(user);
  });
}

runOpinionBox();
