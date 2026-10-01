#!/usr/bin/env python3
"""Muestra ~/.config/zed/settings.json con valores sensibles redactados."""
import json

PATH = "/home/jk/.config/zed/settings.json"
SECRET = ("key", "token", "secret", "password")


def redact(node, parent=""):
    if isinstance(node, dict):
        return {
            k: (
                "<redactado>"
                if isinstance(v, str) and any(s in k.lower() for s in SECRET)
                else redact(v, k)
            )
            for k, v in node.items()
        }
    if isinstance(node, list):
        return [redact(x, parent) for x in node]
    return node


with open(PATH) as f:
    data = json.load(f)

print(json.dumps(redact(data), indent=2, ensure_ascii=False)[:4000])
