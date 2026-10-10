// アクセスカウンタ。サイトのどのページに置いても、同じブラウザからは1日1回だけ数える。
// 表示は id="visit-counter" があるページ（TOP のフッター）だけ。
import { db, todayInt } from "./firebase-app.js";
import { doc, getDoc, setDoc, increment } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// カウンタを置く前の訪問数。Google 検索からのクリック数（Search Console、2026年4月30日〜、サイト全体）。
const VISITS_BEFORE_COUNTER = 295;

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 保存できなくても数えるだけ */ }
}

async function run() {
  const day = todayInt();
  const totalRef = doc(db, "stats", "visits");
  const dailyRef = doc(db, "daily", String(day));

  if (storageGet("rl-visit-day") !== String(day)) {
    try {
      await Promise.all([
        setDoc(totalRef, { total: increment(1) }, { merge: true }),
        setDoc(dailyRef, { count: increment(1) }, { merge: true }),
      ]);
      storageSet("rl-visit-day", String(day));
    } catch (e) {
      console.warn("訪問数を数えられませんでした", e);
    }
  }

  const box = document.getElementById("visit-counter");
  if (!box) return;
  try {
    const [totalSnap, dailySnap] = await Promise.all([getDoc(totalRef), getDoc(dailyRef)]);
    const total = VISITS_BEFORE_COUNTER + (totalSnap.exists() ? totalSnap.data().total : 0);
    const today = dailySnap.exists() ? dailySnap.data().count : 0;
    document.getElementById("visit-total").textContent = total.toLocaleString("ja-JP");
    document.getElementById("visit-today").textContent = today.toLocaleString("ja-JP");
    box.hidden = false;
  } catch (e) {
    // 無料枠の上限などで読めないときはカウンタごと出さない
    console.warn("訪問数を読めませんでした", e);
  }
}

run();
