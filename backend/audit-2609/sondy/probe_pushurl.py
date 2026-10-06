#!/usr/bin/env python3
"""Sonda: remote 'origin' z url = repo PRYWATNE i pushurl = repo PUBLICZNE
(konfiguracja 'push do obu' / lustro). Git podaje hookowi nazwe 'origin' i URL
publiczny; bramka bierze refs/remotes/origin/* (stan PRYWATNY) za "juz publiczne".
Bez git push - stan origin ustawiony update-refem."""
import tempfile
import json, shutil, subprocess, sys
from pathlib import Path
import pathlib as _pl
_SCRIPTS = str(_pl.Path(__file__).resolve().parents[3] / "scripts")  # korzen repo/scripts
sys.path.insert(0, _SCRIPTS)
from pre_push_gate import sprawdz
from publication_gate import stem_hash

def nip():
    w = [6,5,7,2,3,4,5,6,7]
    for p in range(123456780, 123456999):
        d = [int(c) for c in str(p)]; k = sum(a*b for a,b in zip(w,d)) % 11
        if k != 10: return str(p)+str(k)
NIP = nip()
tmp = Path(tempfile.mkdtemp(prefix="sonda-pushurl-"))  # poza repo: plik z NIP-em nie trafia do drzewa
shutil.rmtree(tmp, ignore_errors=True); tmp.mkdir(parents=True)
pub, prv, root = tmp/"publiczne.git", tmp/"prywatne.git", tmp/"repo"
for b in (pub, prv): subprocess.run(["git","init","-q","--bare",str(b)], check=True)
root.mkdir()
def git(*a): return subprocess.run(["git","-C",str(root),"-c","user.name=t","-c","user.email=t@t",*a],check=True,capture_output=True,text=True).stdout.strip()
git("init","-q"); git("symbolic-ref","HEAD","refs/heads/main")
(root/".git/info/exclude").write_text(".publication-gate.json\n")
(root/".publication-gate.json").write_text(json.dumps({"deny_term_hashes":[stem_hash("kowalsk")]}))
def commit(rel, txt, msg):
    (root/rel).parent.mkdir(parents=True, exist_ok=True); (root/rel).write_text(txt)
    git("add","-A"); git("commit","-q","-m",msg); return git("rev-parse","HEAD")
c0 = commit("README.md","czysto\n","init")                      # publiczne
c1 = commit("notatki/klient.md", f"NIP klienta {NIP}\n", "notatka")  # TYLKO prywatne
c2 = commit("README.md","czysto 2\n","popraw readme")           # nowy
git("remote","add","origin",str(prv))
git("config","--add","remote.origin.pushurl",str(prv))
git("config","--add","remote.origin.pushurl",str(pub))
git("update-ref","refs/remotes/origin/main",c1)                 # stan po wczesniejszym fetch z prywatnego
# Kontrola: ten sam push przez remote z fetch-URL publicznym, ktory widzial tylko c0
git("remote","add","mat",str(pub)); git("update-ref","refs/remotes/mat/main",c0)
env = {"PATRON_PUBLIC_REPO": str(pub)}
rc_k, out_k = sprawdz(root,"mat",str(pub),f"refs/heads/main {c2} refs/heads/main {c0}\n",env)
print(f"KONTROLA (remote 'mat' = publiczny): rc={rc_k}  [{'ZATRZYMANE' if rc_k else 'PRZEPUSZCZONE'}]")
# Sonda: git wola hook z $1=origin, $2=<pushurl publiczny>
rc, out = sprawdz(root,"origin",str(pub),f"refs/heads/main {c2} refs/heads/main {c0}\n",env)
print(f"SONDA (remote 'origin', pushurl publiczny): rc={rc}  [{'ZATRZYMANE' if rc else 'PRZEPUSZCZONE'}]")
print("   " + out.replace("\n","\n   "))

# Kod wyjscia niesie werdykt (weryfikacja 2026-10-06): obie proby musza byc zatrzymane.
sys.exit(0 if (rc_k and rc) else 1)
