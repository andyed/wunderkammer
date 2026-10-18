"""Live USPTO marks for each name, whole string, by international class.

Query shape follows the earlier jury sittings: POST tmsearch, query_string over
wordmark and pseudo-text, no _source.includes (it empties every document).
A name with zero hits is reported with the total, so a dead source cannot pass
as a clean one. Usage: python3 uspto.py <name> [...]
"""
import json, sys, time, urllib.request

URL = "https://tmsearch.uspto.gov/prod-v1-0-0/tmsearch"
HDR = {"Content-Type": "application/json", "Accept": "application/json",
       "Origin": "https://tmsearch.uspto.gov", "Referer": "https://tmsearch.uspto.gov/search/search-results",
       "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36"}
SOFTWARE = {"IC 009", "IC 042"}

def search(term, size=200):
    body = {"query": {"bool": {"must": [{"query_string": {"query": term, "default_operator": "AND",
            "fields": ["wordmark", "wordmarkPseudoText"]}}]}}, "size": size, "from": 0}
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers=HDR, method="POST")
    d = json.load(urllib.request.urlopen(req, timeout=30))
    return d["hits"]["totalValue"], [h["source"] for h in d["hits"]["hits"]]

out = {}
for name in sys.argv[1:]:
    total, docs = search(name)
    exact = [s for s in docs if (s.get("wordmark") or "").strip().lower() == name.lower()]
    live = [s for s in docs if s.get("alive")]
    live_exact = [s for s in exact if s.get("alive")]
    live_software = [s for s in live if SOFTWARE & set(s.get("internationalClass") or [])]
    out[name] = {
        "total_hits": total, "returned": len(docs), "exact": len(exact), "live": len(live), "live_exact": len(live_exact),
        "live_exact_classes": sorted({c for s in live_exact for c in (s.get("internationalClass") or [])}),
        "live_software_marks": [f'{s.get("wordmark")} ({",".join(s.get("internationalClass") or [])}; {s.get("ownerName")})' for s in live_software][:8],
    }
    print(name, json.dumps(out[name]))
    time.sleep(1.5)
json.dump(out, open("uspto_results.json", "w"), indent=1)
