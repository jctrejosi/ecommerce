import re, sys, urllib.request, html

def get(url, depth=0):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36", "Accept-Language": "en-US,en;q=0.9"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.read(1_200_000).decode("utf-8", "ignore"), r.geturl()
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303, 307, 308) and depth < 4 and e.headers.get("Location"):
            loc = e.headers["Location"]
            if loc.startswith("/"):
                from urllib.parse import urljoin
                loc = urljoin(url, loc)
            return get(loc, depth + 1)
        raise

for url in sys.argv[1:]:
    print("\n### " + url)
    try:
        data, final = get(url)
        print("(final: %s)" % final)
        data = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", data)
        text = html.unescape(re.sub(r"(?s)<[^>]+>", " ", data))
        text = re.sub(r"[ \t\r\f\v]+", " ", text)
        lines = [l.strip() for l in text.split("\n") if l.strip()]
        hits = []
        for line in lines:
            low = line.lower()
            if ("$" in line or "usd" in low) and re.search(r"cost|price|rate|budget|develop|build|app|website|ecommerce|hour", low):
                if 30 < len(line) < 400:
                    hits.append(line)
        seen = set()
        out = []
        for h in hits:
            k = h[:80]
            if k in seen:
                continue
            seen.add(k)
            out.append(h)
            if len(out) >= 18:
                break
        print("\n".join(out) if out else "(sin coincidencias de precio)")
    except Exception as e:
        print("ERROR", e)
