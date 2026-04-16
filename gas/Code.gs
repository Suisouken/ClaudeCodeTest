/**
 * Gmail Inbox Organizer - Google Apps Script版
 *
 * セットアップ:
 *   1. https://script.google.com/ を開く
 *   2. 「新しいプロジェクト」を作成
 *   3. このファイルの内容を貼り付けて保存
 *   4. 関数「setup」を選んで実行 → 権限を許可
 *   5. 以降は自動で毎日実行される（またはメニューから手動実行）
 */

// ============================================================
// 設定
// ============================================================
const CONFIG = {
  // アーカイブ: 既読かつ何日以上前のメールを対象にするか（0 = 無効）
  archiveOlderThanDays: 30,

  // ラベル付けルール
  rules: [
    {
      name: "Newsletter",
      label: "Newsletter",
      subjectKeywords: ["unsubscribe", "newsletter", "週刊", "月刊", "メルマガ", "weekly digest"],
      fromDomains: [],
      archive: false,
    },
    {
      name: "Receipt",
      label: "Receipt",
      subjectKeywords: ["receipt", "領収書", "注文確認", "ご注文", "invoice", "お支払い", "payment confirmation", "order confirmation"],
      fromDomains: [],
      archive: false,
    },
    {
      name: "GitHub",
      label: "GitHub",
      subjectKeywords: [],
      fromDomains: ["github.com"],
      archive: false,
    },
    {
      name: "Social",
      label: "Social",
      subjectKeywords: [],
      fromDomains: ["twitter.com", "facebook.com", "linkedin.com", "instagram.com"],
      archive: true,
    },
    {
      name: "Shopping",
      label: "Shopping",
      subjectKeywords: ["% off", "sale", "セール", "限定", "特価", "クーポン", "割引", "special offer"],
      fromDomains: [],
      archive: false,
    },
  ],
};

// ============================================================
// メイン処理
// ============================================================

/**
 * 初回セットアップ: 毎日トリガーを登録する
 */
function setup() {
  // 既存トリガーを削除
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));

  // 毎朝8時に自動実行
  ScriptApp.newTrigger("organizeInbox")
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .create();

  Logger.log("セットアップ完了。毎朝8時に自動整理が実行されます。");
  organizeInbox(); // 初回はすぐ実行
}

/**
 * Inbox を整理する（ルールに従いラベル付け + アーカイブ）
 */
function organizeInbox() {
  const results = [];

  CONFIG.rules.forEach((rule) => {
    const label = getOrCreateLabel(rule.label);
    const threads = searchThreadsForRule(rule);

    if (threads.length === 0) return;

    threads.forEach((thread) => {
      thread.addLabel(label);
      if (rule.archive) {
        thread.moveToArchive();
      }
    });

    results.push(`[${rule.name}] ${threads.length}件 → ラベル:${rule.label}${rule.archive ? " + アーカイブ" : ""}`);
    Logger.log(`${rule.name}: ${threads.length}件処理`);
  });

  // 古いメールをアーカイブ
  if (CONFIG.archiveOlderThanDays > 0) {
    const archived = archiveOldMails();
    results.push(`[古いメール] ${archived}件アーカイブ`);
  }

  Logger.log("整理完了:\n" + results.join("\n"));
}

/**
 * Inbox の概要をログに出力する
 */
function showSummary() {
  const queries = {
    "未読": "in:inbox is:unread",
    "スター付き": "in:inbox is:starred",
    "プロモーション": "category:promotions in:inbox",
    "ソーシャル": "category:social in:inbox",
    "全メール (Inbox)": "in:inbox",
  };

  Logger.log("===== Inbox サマリー =====");
  Object.entries(queries).forEach(([label, query]) => {
    const threads = GmailApp.search(query, 0, 500);
    Logger.log(`${label}: ${threads.length}件${threads.length >= 500 ? " (500以上)" : ""}`);
  });

  // 最近5件のスレッド
  Logger.log("\n--- 最近のメール ---");
  GmailApp.search("in:inbox", 0, 5).forEach((thread) => {
    Logger.log(`${thread.getFirstMessageSubject()} / from: ${thread.getMessages()[0].getFrom()}`);
  });
}

/**
 * 古い既読メールをアーカイブする
 */
function archiveOldMails() {
  const days = CONFIG.archiveOlderThanDays;
  const query = `in:inbox is:read older_than:${days}d`;
  const threads = GmailApp.search(query, 0, 500);

  threads.forEach((thread) => thread.moveToArchive());
  Logger.log(`古いメール: ${threads.length}件をアーカイブ`);
  return threads.length;
}

// ============================================================
// ヘルパー
// ============================================================

/**
 * ラベルを取得または作成する
 */
function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/**
 * ルールにマッチする Inbox スレッドを検索する
 */
function searchThreadsForRule(rule) {
  const conditions = ["in:inbox"];

  // 件名キーワード（OR条件）
  if (rule.subjectKeywords.length > 0) {
    const subjectQuery = rule.subjectKeywords
      .map((kw) => `subject:"${kw}"`)
      .join(" OR ");
    conditions.push(`(${subjectQuery})`);
  }

  // 送信元ドメイン（OR条件）
  if (rule.fromDomains.length > 0) {
    const fromQuery = rule.fromDomains
      .map((d) => `from:${d}`)
      .join(" OR ");

    if (rule.subjectKeywords.length > 0) {
      // キーワード OR ドメインのどちらかでマッチ
      const subjectQuery = rule.subjectKeywords
        .map((kw) => `subject:"${kw}"`)
        .join(" OR ");
      return GmailApp.search(
        `in:inbox ((${subjectQuery}) OR (${fromQuery}))`,
        0,
        100
      );
    }
    conditions.push(`(${fromQuery})`);
  }

  if (conditions.length === 1) return []; // 条件なし = スキップ

  return GmailApp.search(conditions.join(" "), 0, 100);
}
