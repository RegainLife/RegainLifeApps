// Firebase の初期化。アクセスカウンタと意見・要望の受け付けで共有する。
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyClHNM6NiSrKjbx9mN20TJAUU-_frs4kxA",
  authDomain: "regainlifeapps.firebaseapp.com",
  projectId: "regainlifeapps",
  storageBucket: "regainlifeapps.firebasestorage.app",
  messagingSenderId: "1039843521111",
  appId: "1:1039843521111:web:5b1634cd669ebb1e17a912",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// 日本時間の今日を 20261011 の形で返す（firestore.rules の todayInt() と同じ計算）
export function todayInt() {
  const t = new Date(Date.now() + 9 * 3600 * 1000);
  return t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate();
}
