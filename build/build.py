import json, re, sys, pathlib, datetime
import sys, zipfile, re, html
def cells(path):
    z = zipfile.ZipFile(path)
    ss = []
    if "xl/sharedStrings.xml" in z.namelist():
        x = z.read("xl/sharedStrings.xml").decode()
        for si in re.findall(r"<si>(.*?)</si>", x, re.S):
            ss.append(html.unescape("".join(re.findall(r"<t[^>]*>(.*?)</t>", si, re.S))))
    sheets = sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml", n))
    out = {}
    for sh in sheets:
        x = z.read(sh).decode(); rows = []
        for row in re.findall(r"<row[^>]*>(.*?)</row>", x, re.S):
            vals = []
            for attrs, body in re.findall(r"<c([^>]*)>(.*?)</c>", row, re.S):
                v = re.search(r"<v>(.*?)</v>", body, re.S); t = re.search(r'\bt="(\w+)"', attrs)
                isv = re.search(r"<is>.*?<t[^>]*>(.*?)</t>", body, re.S)
                ref = re.search(r'r="([A-Z]+)\d+"', attrs).group(1)
                val = ss[int(v.group(1))] if (t and t.group(1)=="s" and v) else (html.unescape(isv.group(1)) if isv else (v.group(1) if v else ""))
                vals.append((ref, val))
            rows.append(vals)
        out[sh] = rows
    return out

# Build the Make the Mirror True page.
#   python3 build/build.py
# Embeds the playbooks (skills/*/SKILL.md) and a California WARN layoff snapshot
# (build/ca_warn_report.xlsx) into the template, and writes:
#   site/mirror.html  the page as a claude.ai artifact (no <html>/<head>; the host adds them)
#   index.html        the same page as a standalone document, for GitHub Pages
# Refresh the layoff data first with:
#   curl -L -o build/ca_warn_report.xlsx https://edd.ca.gov/siteassets/files/jobs_and_training/warn/warn_report1.xlsx
here = pathlib.Path(__file__).resolve().parent
kit = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else here.parent
tpl = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else here/"mirror.template.html").read_text()
meta = [
 ("my-standards","Start here","My standards","Your rulebook and the claims you can defend. Every other playbook leans on it."),
 ("honest-resume","Vanity","Honest resume","Tailor to the posting, then rate every claim for whether it survives a technical round."),
 ("job-triage","Vanity","Job triage","Rank saved jobs, save top choices for later, park slow portals."),
 ("search-tracker","Preoccupation","Search tracker","The AI keeps your tracker and tells you what the numbers say."),
 ("interview-debrief","Self-surveillance","Interview debrief","Consent, attribution check, then question by question game tape."),
 ("story-bank","Need for admiration","Story bank","True stories in every voice you need, timed for the room."),
 ("prep-card","Mirroring","Prep card","Interviewer research, ranked questions, and the closer."),
 ("salary-script","The salary question","Salary script","Four moves in 90 seconds, plus recruiter role-play."),
]
pbs = []
for slug, section, title, blurb in meta:
    body = (kit/"skills"/slug/"SKILL.md").read_text()
    body = re.sub(r"\A---.*?---\s*", "", body, flags=re.S)
    text = f"I'm running a job search and want you to follow this playbook for the rest of our conversation. If I haven't given you what it needs, ask me for it first.\n\n{body.strip()}\n"
    pbs.append(dict(section=section, title=title, blurb=blurb, text=text))
data = json.dumps(pbs, ensure_ascii=False).replace("</", "<\\/")
warn_path = sys.argv[3] if len(sys.argv) > 3 else here/"ca_warn_report.xlsx"
sheet = cells(warn_path)["xl/worksheets/sheet3.xml"]
title = sheet[0][0][1]
rng = re.search(r"(\d\d/\d\d/\d\d)\s*to\s*(\d\d/\d\d/\d{2,4})", title)
def iso(serial):
    return (datetime.date(1899,12,30) + datetime.timedelta(days=int(float(serial)))).isoformat()
SUFFIX = r"\b(inc|llc|l\.l\.c|corp|corporation|co|company|ltd|lp|llp|plc|holdings|group|the|usa|us|na)\b"
def norm(s):
    s = s.lower().replace("&rsquo;","'")
    s = re.sub(r"\b(dba|d/b/a)\b.*", "", s)
    s = re.sub(r"[^a-z0-9& ]+", " ", s)
    s = re.sub(SUFFIX, " ", s)
    return re.sub(r"\s+", " ", s).strip()
agg = {}
for row in sheet[2:]:
    r = dict(row)
    if not r.get("E") or not r.get("B","").replace(".","").isdigit(): continue
    k = norm(r["E"])
    if len(k) < 3: continue
    a = agg.setdefault(k, {"name": r["E"].replace("&rsquo;","'"), "notices": 0, "employees": 0, "latest": "", "counties": set()})
    a["notices"] += 1; a["employees"] += int(float(r.get("G") or 0))
    a["latest"] = max(a["latest"], iso(r["B"])); a["counties"].add(r.get("A","").replace(" County",""))
warn = {"source": "California EDD WARN report", "range": f"{rng.group(1)} to {rng.group(2)}" if rng else title.split("\n")[0],
        "companies": {k: [v["name"], v["notices"], v["employees"], v["latest"], sorted(c for c in v["counties"] if c)[:3]] for k, v in agg.items()}}
tpl = tpl.replace("/*WARN*/", json.dumps(warn, ensure_ascii=False).replace("</", "<\\/"))
print("warn companies:", len(agg), warn["range"])
out = kit/"site"/"mirror.html"; out.parent.mkdir(exist_ok=True)
page = tpl.replace("/*PLAYBOOKS*/", data)
out.write_text(page)
# Standalone copy: the doctype keeps browsers in standards mode, and the parser places the
# leading <meta>/<title>/<link>/<style> into <head> on its own.
(kit/"index.html").write_text('<!doctype html>\n<html lang="en">\n' + page + '\n</html>\n')
print(out, out.stat().st_size, "and index.html")
