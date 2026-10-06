#!/usr/bin/env python3
"""Sondy bramki pre-push na SZTUCZNYM repo (bez zadnego git push).
Stan "publiczny" = refs/remotes/mat/main ustawiony update-refem.
Kazda sonda: tresc, ktora bramka MA zatrzymac -> oczekiwane rc=1."""
import json, os, shutil, subprocess, sys, tempfile
from pathlib import Path
import pathlib as _pl
_SCRIPTS = str(_pl.Path(__file__).resolve().parents[3] / "scripts")  # korzen repo/scripts
sys.path.insert(0, _SCRIPTS)
from pre_push_gate import sprawdz          # noqa
from publication_gate import stem_hash     # noqa

SCR = Path(os.environ.get("SCR", tempfile.gettempdir()))

def nip():
    w = [6,5,7,2,3,4,5,6,7]
    for p in range(123456780, 123456999):
        d = [int(c) for c in str(p)]; k = sum(a*b for a,b in zip(w,d)) % 11
        if k != 10: return str(p)+str(k)
NIP = nip()

class Repo:
    def __init__(self, name):
        self.tmp = SCR / name
        shutil.rmtree(self.tmp, ignore_errors=True); self.tmp.mkdir(parents=True)
        self.pub = self.tmp / "publiczne.git"
        subprocess.run(["git","init","-q","--bare",str(self.pub)], check=True)
        self.root = self.tmp / "repo"; self.root.mkdir()
        self.git("init","-q"); self.git("symbolic-ref","HEAD","refs/heads/main")
        (self.root/".git/info/exclude").write_text(".publication-gate.json\n")
        (self.root/".publication-gate.json").write_text(json.dumps({
            "deny_term_hashes":[stem_hash("kowalsk")],
            "deny_paths":[".matematic/","klienci/"]}))
        body = "".join(f"linia {i} tresci publicznej dokumentu\n" for i in range(40))
        self.commit("docs/a.md", body, "init")
        self.git("remote","add","mat",str(self.pub))
        self.base = self.git("rev-parse","HEAD")
        self.git("update-ref","refs/remotes/mat/main",self.base)   # "juz publiczne"
    def git(self,*a, check=True):
        return subprocess.run(["git","-C",str(self.root),"-c","user.name=t","-c","user.email=t@t",*a],
                              check=check,capture_output=True,text=True).stdout.strip()
    def commit(self, rel, tresc, msg):
        p = self.root/rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(tresc)
        self.git("add","-A","-f"); self.git("commit","-q","-m",msg); return self.git("rev-parse","HEAD")
    def push(self, sha, lref="refs/heads/main"):
        return sprawdz(self.root,"mat",str(self.pub),f"{lref} {sha} {lref} {self.base}\n",
                       {"PATRON_PUBLIC_REPO":str(self.pub)})

wyniki = []
def sonda(nazwa, rc, out):
    ok = rc == 1
    wyniki.append(ok)
    print(f"[{'ZATRZYMANE' if ok else 'PRZEPUSZCZONE'}] {nazwa}: rc={rc}")
    print("   " + out.replace("\n","\n   ")[:600])

# K0 kontrola pozytywna: NIP dopisany zwyklym commitem -> musi byc zatrzymany
r = Repo("k0"); s = r.commit("docs/n.md", f"NIP klienta {NIP}\n", "dodaj notatke")
sonda("K0 kontrola: NIP w nowym pliku", *r.push(s))

# S1 deny_paths: plik z prywatnego warsztatu (.matematic/) bez PII
r = Repo("s1"); s = r.commit(".matematic/releases/1.4.0/README.md", "Rejestr wolnych numerow\nplan wydania\n", "docs: notatka")
print("   (drzewo tego samego commita w trybie zwyklym:)", subprocess.run([sys.executable,_SCRIPTS + "/publication_gate.py",str(r.root)],capture_output=True,text=True).stdout.strip().splitlines()[:1])
sonda("S1 commit dodaje .matematic/ (deny_paths)", *r.push(s))

# S2 rename + dopisany NIP w tym samym commicie
r = Repo("s2"); r.git("mv","docs/a.md","docs/b.md")
p = r.root/"docs/b.md"; p.write_text(p.read_text()+f"NIP klienta {NIP}\n")
r.git("add","-A"); r.git("commit","-q","-m","przenies notatke"); s = r.git("rev-parse","HEAD")
sonda("S2 git mv + dopisany NIP (status R)", *r.push(s))

# S3 'zly merge': NIP wprowadzony w rozwiazaniu merge'a
r = Repo("s3")
r.git("checkout","-q","-b","x"); r.commit("docs/x.md","x\n","x")
r.git("checkout","-q","main"); r.commit("docs/y.md","y\n","y")
r.git("merge","-q","--no-commit","--no-ff","x", check=False)
(r.root/"docs/y.md").write_text(f"y\nNIP klienta {NIP}\n"); r.git("add","-A")
r.git("commit","-q","-m","Merge branch x"); s = r.git("rev-parse","HEAD")
sonda("S3 NIP dodany w commicie merge (evil merge)", *r.push(s))

# S4 blad `git log -p` (brak obiektu blob - jak w klonie --filter=blob:none offline)
r = Repo("s4"); s = r.commit("docs/n.md", f"NIP klienta {NIP}\n", "dodaj notatke")
blob = r.git("rev-parse", f"{s}:docs/n.md")
o = r.root/".git/objects"/blob[:2]/blob[2:]; o.chmod(0o644); o.unlink()  # Windows: obiekt tylko-do-odczytu
sonda("S4 git log -p pada (brakujacy blob)", *r.push(s))

# S5 adnotowany tag: tresc tagu z nazwa z denylisty
r = Repo("s5"); r.git("tag","-a","v9","-m","Wydanie dla kancelarii Kowalskiego", r.base)
t = r.git("rev-parse","v9")
sonda("S5 tag adnotowany z nazwa z denylisty w tresci", *r.push(t, "refs/tags/v9"))

# S6 PESEL/NIP sklejony z literami a-f
r = Repo("s6"); s = r.commit("docs/n.md", f"klient id=a{NIP}\n", "dodaj notatke")
sonda("S6 NIP sklejony z litera a-f", *r.push(s))

print("\nPODSUMOWANIE:", sum(wyniki), "z", len(wyniki), "zatrzymanych (oczekiwane: wszystkie)")

# Kod wyjscia niesie werdykt (weryfikacja 2026-10-06): pusta lista albo cokolwiek
# przepuszczone = 1, inaczej sonda konczy sie sukcesem niezaleznie od wyniku.
sys.exit(0 if wyniki and all(wyniki) else 1)
