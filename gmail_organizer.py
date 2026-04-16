#!/usr/bin/env python3
"""
Gmail Inbox Organizer
Gmail APIを使ってInboxを自動整理するツール

使い方:
    python gmail_organizer.py --help
    python gmail_organizer.py summary          # Inbox の概要を表示
    python gmail_organizer.py organize         # ルールに従って自動整理
    python gmail_organizer.py archive          # 古いメールをアーカイブ
    python gmail_organizer.py list-labels      # ラベル一覧を表示
"""

import argparse
import base64
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml
from colorama import Fore, Style, init
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

init(autoreset=True)  # colorama

SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]
TOKEN_FILE = "token.json"
CREDENTIALS_FILE = "credentials.json"
CONFIG_FILE = "config.yaml"


def load_config() -> dict:
    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def authenticate() -> Credentials:
    """OAuth 2.0 認証を行い、Credentialsを返す。"""
    creds = None

    if Path(TOKEN_FILE).exists():
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            print(f"{Fore.YELLOW}トークンを更新しています...")
            creds.refresh(Request())
        else:
            if not Path(CREDENTIALS_FILE).exists():
                print(f"{Fore.RED}エラー: {CREDENTIALS_FILE} が見つかりません。")
                print(
                    "Google Cloud Console からOAuth 2.0クライアントIDをダウンロードして、"
                    f"{CREDENTIALS_FILE} として保存してください。"
                )
                print("詳細: https://developers.google.com/gmail/api/quickstart/python")
                sys.exit(1)
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)

        with open(TOKEN_FILE, "w") as token:
            token.write(creds.to_json())
        print(f"{Fore.GREEN}認証成功。トークンを保存しました。")

    return creds


def get_service():
    creds = authenticate()
    return build("gmail", "v1", credentials=creds)


def get_or_create_label(service, name: str) -> str:
    """ラベルが存在すればそのIDを、なければ作成してIDを返す。"""
    result = service.users().labels().list(userId="me").execute()
    labels = result.get("labels", [])
    for label in labels:
        if label["name"].lower() == name.lower():
            return label["id"]

    new_label = (
        service.users()
        .labels()
        .create(
            userId="me",
            body={
                "name": name,
                "labelListVisibility": "labelShow",
                "messageListVisibility": "show",
            },
        )
        .execute()
    )
    print(f"{Fore.CYAN}  ラベル作成: {name}")
    return new_label["id"]


def fetch_messages(service, query: str, max_results: int = 500) -> list:
    """クエリに一致するメッセージIDリストを取得する。"""
    messages = []
    page_token = None

    while True:
        kwargs = {"userId": "me", "q": query, "maxResults": min(max_results, 100)}
        if page_token:
            kwargs["pageToken"] = page_token

        response = service.users().messages().list(**kwargs).execute()
        batch = response.get("messages", [])
        messages.extend(batch)

        if len(messages) >= max_results:
            break

        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return messages[:max_results]


def get_message_detail(service, msg_id: str) -> dict:
    return (
        service.users()
        .messages()
        .get(userId="me", id=msg_id, format="metadata", metadataHeaders=["From", "Subject", "Date"])
        .execute()
    )


def extract_header(msg: dict, name: str) -> str:
    headers = msg.get("payload", {}).get("headers", [])
    for h in headers:
        if h["name"].lower() == name.lower():
            return h["value"]
    return ""


def apply_label(service, msg_id: str, label_id: str):
    service.users().messages().modify(
        userId="me", id=msg_id, body={"addLabelIds": [label_id]}
    ).execute()


def archive_message(service, msg_id: str):
    """メッセージをアーカイブ（INBOXラベルを外す）。"""
    service.users().messages().modify(
        userId="me", id=msg_id, body={"removeLabelIds": ["INBOX"]}
    ).execute()


def message_matches_rule(msg: dict, rule: dict) -> bool:
    subject = extract_header(msg, "Subject").lower()
    from_header = extract_header(msg, "From").lower()

    keywords = [k.lower() for k in rule["match"].get("subject_keywords", [])]
    domains = [d.lower() for d in rule["match"].get("from_domains", [])]

    keyword_match = any(kw in subject for kw in keywords) if keywords else False
    domain_match = any(d in from_header for d in domains) if domains else False

    return keyword_match or domain_match


# ---------- コマンド ----------

def cmd_summary(service):
    """Inbox の概要を表示する。"""
    print(f"\n{Fore.CYAN}{'='*50}")
    print(f"{Fore.CYAN} Gmail Inbox サマリー")
    print(f"{Fore.CYAN}{'='*50}\n")

    categories = {
        "未読": "in:inbox is:unread",
        "スター付き": "in:inbox is:starred",
        "プロモーション": "category:promotions",
        "ソーシャル": "category:social",
        "最新30日": "in:inbox newer_than:30d",
    }

    for label, query in categories.items():
        msgs = fetch_messages(service, query, max_results=500)
        count = len(msgs)
        color = Fore.RED if (label == "未読" and count > 50) else Fore.WHITE
        print(f"  {color}{label:<16}: {count:>5} 件")

    # 最近のメール5件を表示
    print(f"\n{Fore.YELLOW}--- 最近のメール (最大5件) ---")
    recent = fetch_messages(service, "in:inbox", max_results=5)
    for item in recent:
        msg = get_message_detail(service, item["id"])
        subject = extract_header(msg, "Subject") or "(件名なし)"
        from_ = extract_header(msg, "From")
        print(f"  {Fore.WHITE}{from_[:40]:<42} {subject[:50]}")

    print()


def cmd_list_labels(service):
    """ラベル一覧を表示する。"""
    result = service.users().labels().list(userId="me").execute()
    labels = sorted(result.get("labels", []), key=lambda l: l["name"])
    print(f"\n{Fore.CYAN}ラベル一覧 ({len(labels)} 件)\n")
    for label in labels:
        if label["type"] == "user":
            print(f"  {Fore.GREEN}[user]  {label['name']}")
        else:
            print(f"  {Fore.YELLOW}[system] {label['name']}")
    print()


def cmd_organize(service, config: dict, dry_run: bool = False):
    """config.yaml のルールに従ってメールを整理する。"""
    print(f"\n{Fore.CYAN}{'='*50}")
    print(f"{Fore.CYAN} Inbox 自動整理{' (ドライラン)' if dry_run else ''}")
    print(f"{Fore.CYAN}{'='*50}\n")

    # ラベルのIDをキャッシュ
    label_cache: dict[str, str] = {}

    def resolve_label(name: str) -> str:
        if name not in label_cache:
            if dry_run:
                label_cache[name] = f"<dry:{name}>"
            else:
                label_cache[name] = get_or_create_label(service, name)
        return label_cache[name]

    rules = config.get("rules", [])
    total_labeled = 0
    total_archived = 0

    for rule in rules:
        rule_name = rule["name"]
        label_name = rule["label"]
        do_archive = rule.get("archive", False)

        msgs = fetch_messages(service, "in:inbox", max_results=200)
        matched = []

        for item in msgs:
            msg = get_message_detail(service, item["id"])
            if message_matches_rule(msg, rule):
                matched.append((item["id"], msg))

        if not matched:
            print(f"  {Fore.WHITE}{rule_name}: マッチなし")
            continue

        print(f"  {Fore.GREEN}{rule_name}: {len(matched)} 件 → ラベル [{label_name}]{' + アーカイブ' if do_archive else ''}")

        if not dry_run:
            label_id = resolve_label(label_name)
            for msg_id, msg in matched:
                apply_label(service, msg_id, label_id)
                total_labeled += 1
                if do_archive:
                    archive_message(service, msg_id)
                    total_archived += 1
                subject = extract_header(msg, "Subject") or "(件名なし)"
                print(f"    {Fore.WHITE}→ {subject[:60]}")
        else:
            total_labeled += len(matched)
            if do_archive:
                total_archived += len(matched)

    print(f"\n  {Fore.CYAN}完了: {total_labeled} 件にラベル付与, {total_archived} 件をアーカイブ\n")


def cmd_archive(service, config: dict, dry_run: bool = False):
    """指定日数より古い既読メールをアーカイブする。"""
    days = config.get("archive_older_than_days", 30)
    if days <= 0:
        print(f"{Fore.YELLOW}archive_older_than_days が 0 のためスキップします。")
        return

    print(f"\n{Fore.CYAN}{'='*50}")
    print(f"{Fore.CYAN} 古いメールをアーカイブ ({days} 日以上前, 既読){' (ドライラン)' if dry_run else ''}")
    print(f"{Fore.CYAN}{'='*50}\n")

    query = f"in:inbox is:read older_than:{days}d"
    msgs = fetch_messages(service, query, max_results=500)

    print(f"  対象: {len(msgs)} 件")

    if not dry_run:
        for i, item in enumerate(msgs, 1):
            archive_message(service, item["id"])
            if i % 50 == 0:
                print(f"  {Fore.WHITE}{i}/{len(msgs)} 件処理済み...")
        print(f"  {Fore.GREEN}{len(msgs)} 件をアーカイブしました。\n")
    else:
        print(f"  {Fore.YELLOW}(ドライラン: 実際にはアーカイブしません)\n")


def main():
    parser = argparse.ArgumentParser(
        description="Gmail Inbox Organizer - Inboxを自動整理するツール",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
コマンド例:
  python gmail_organizer.py summary              Inboxの概要を表示
  python gmail_organizer.py list-labels          ラベル一覧を表示
  python gmail_organizer.py organize             ルールに従ってラベル付け・整理
  python gmail_organizer.py organize --dry-run   変更せずに結果だけ確認
  python gmail_organizer.py archive              古い既読メールをアーカイブ
  python gmail_organizer.py archive --dry-run    変更せずに件数だけ確認
        """,
    )
    parser.add_argument(
        "command",
        choices=["summary", "list-labels", "organize", "archive"],
        help="実行するコマンド",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="実際には変更せず、対象メールの件数だけ表示する",
    )
    parser.add_argument(
        "--config",
        default=CONFIG_FILE,
        help=f"設定ファイルのパス (デフォルト: {CONFIG_FILE})",
    )

    args = parser.parse_args()

    # 設定読み込み
    config_path = Path(args.config)
    if not config_path.exists():
        print(f"{Fore.RED}設定ファイルが見つかりません: {args.config}")
        sys.exit(1)
    config = load_config()

    try:
        service = get_service()
    except Exception as e:
        print(f"{Fore.RED}認証エラー: {e}")
        sys.exit(1)

    try:
        if args.command == "summary":
            cmd_summary(service)
        elif args.command == "list-labels":
            cmd_list_labels(service)
        elif args.command == "organize":
            cmd_organize(service, config, dry_run=args.dry_run)
        elif args.command == "archive":
            cmd_archive(service, config, dry_run=args.dry_run)
    except HttpError as e:
        print(f"{Fore.RED}Gmail APIエラー: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
