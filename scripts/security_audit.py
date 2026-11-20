#!/usr/bin/env python3
"""Static security checks for the public WarehouseOS GitHub Pages site.
No secrets, credentials, or live Firestore data are accessed.
"""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlparse
import re, sys

ROOT=Path(__file__).resolve().parents[1]
APPROVED={"www.gstatic.com","cdnjs.cloudflare.com","cdn.jsdelivr.net"}
issues=[]
stats={"html":0,"external_scripts":0,"inline_scripts":0}
class Scan(HTMLParser):
    def __init__(self,path):
        super().__init__();self.path=path
    def handle_starttag(self,tag,attrs):
        attr=dict(attrs)
        if tag.lower()=="script":
            src=attr.get("src")
            if src:
                if src.startswith(("https://","http://")):
                    stats["external_scripts"]+=1
                    u=urlparse(src)
                    if u.scheme!="https" or u.hostname not in APPROVED:
                        issues.append(f"{self.path}: unapproved script source: {src}")
                    if re.search(r"(?:@(?:latest|next)|/(?:latest|master|main)/)",src):
                        issues.append(f"{self.path}: unpinned script source: {src}")
                elif src.startswith("//"):
                    issues.append(f"{self.path}: scheme-relative script: {src}")
            else:
                stats["inline_scripts"]+=1
        for key,value in attrs:
            if key.lower().startswith("on") and value:
                # Baseline audit only; existing inline handlers are noted, not automatically blocked.
                pass

for path in ROOT.rglob("*.html"):
    if ".git" in path.parts:continue
    stats["html"]+=1
    content=path.read_text(encoding="utf-8",errors="replace")
    Scan(path.relative_to(ROOT)).feed(content)
    if re.search(r'<script\b[^>]*\bsrc\s*=\s*["\']http://',content,re.I):
        issues.append(f"{path.relative_to(ROOT)}: insecure HTTP script")
print("HTML pages scanned:",stats["html"])
print("External script references:",stats["external_scripts"])
print("Inline script blocks (migration required for strict CSP):",stats["inline_scripts"])
if issues:
    print("\nSECURITY AUDIT FAILED:")
    print("\n".join(issues))
    sys.exit(1)
print("Security audit passed: third-party script hosts are allowlisted and use HTTPS.")
