from __future__ import annotations

import argparse
import json
import sys

from services.agent_search_service import web_search_payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Search the web from the Miki backend search service."
    )
    parser.add_argument("query", nargs="?", help="Search query.")
    parser.add_argument("-q", "--query", dest="query_flag", help="Search query.")
    parser.add_argument(
        "-n",
        "--limit",
        type=int,
        default=6,
        help="Maximum number of search results, capped by the service.",
    )
    parser.add_argument(
        "--provider",
        choices=["auto", "brave", "duckduckgo"],
        default="auto",
        help="Search provider. auto uses Brave when BRAVE_SEARCH_API_KEY is set, otherwise DuckDuckGo.",
    )
    parser.add_argument(
        "--summarize",
        action="store_true",
        help="Ask the configured LLM to summarize the search results.",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON output.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    query = (args.query_flag or args.query or "").strip()

    if not query:
        print("error: query is required", file=sys.stderr)
        return 2

    try:
        payload = web_search_payload(
            {
                "query": query,
                "limit": args.limit,
                "provider": args.provider,
                "summarize": args.summarize,
            }
        )
    except Exception as exc:
        print(f"web search failed: {exc}", file=sys.stderr)
        return 1

    print(
        json.dumps(
            payload,
            ensure_ascii=False,
            indent=2 if args.pretty else None,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
