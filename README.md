# Make the Mirror True

A job search kit for any AI assistant (ChatGPT, Gemini, or Claude), from the talk *Getting in Touch with Your Inner Narcissist to Accelerate Your Job Search* (Women in Security, November 12, 2026).

Eight playbooks that turn your AI into a job search partner that flatters you on purpose and tells you the truth on schedule. The thread through all of them: the AI is built to please you, so every playbook makes it name what fell flat before it is allowed to tell you what went well.

## The playbooks

| Playbook | What it does | Talk section |
|---|---|---|
| **my-standards** | Your personal rulebook: writing rules plus a ledger of claims you can defend. It grows every time the AI gets something wrong. | Vanity |
| **honest-resume** | Tailors a resume to a posting, then rates every claim green, yellow, or red for whether it survives an expert interviewer. | Vanity |
| **job-triage** | Ranks your saved jobs, saves top choices for when you are warmed up, parks slow portals. | Vanity |
| **search-tracker** | Keeps your tracker for you and turns it into a Sankey, conversion by lane, the round where you stall, and pace. | Preoccupation |
| **interview-debrief** | Question-by-question game tape from a transcript, with an attribution check first. | Self-surveillance |
| **story-bank** | Your true stories, retold in each voice you need, timed for interviews. | Need for admiration |
| **prep-card** | Interviewer research, likely questions, ranked questions to ask, and the closer. | Mirroring |
| **salary-script** | The four-move salary script, recruiter role-play, and the real cost of an offer. | The salary question |

## The page

**[Open the page](https://ssscaryn.github.io/job-search-mirror/)** (`index.html`). It reads a tracker (Excel .xlsx or .xls, OpenDocument, or CSV) entirely in the browser, combining outcomes and rounds kept on separate sheets, and shows your funnel, where you stall, your pace, and **posting watch**: red flags by company from the posting to the offer (stale or reposted postings, missing pay bands, roles shopped by several agencies, unnamed clients, scam patterns, long processes, possibly unlawful questions, resume misstatements, homogeneous panels, ghosting, offers that changed). It also checks company names against California's public WARN layoff filings, embedded as a dated snapshot. Every flag is an observation with its evidence, never a verdict. It also has every playbook ready to copy.

It works for any field: lanes are grouped from your own job titles, and you can edit them.

## Use the playbooks

The playbooks are plain text in `skills/<name>/SKILL.md`, and the page has a copy button for each.

### ChatGPT

Paste a playbook at the start of a chat. To keep it, create a **Project**, paste the playbook into the project's instructions, and add your tracker and resumes as files.

### Gemini

Create a **Gem** and paste the playbook as its instructions. Attach your tracker and resumes in the chat.

### Claude app (claude.ai, desktop, mobile)

1. Open **Settings → Capabilities** and turn on **Skills** (Code execution must be on).
2. Upload each zip from the `upload/` folder.
3. Start a chat and try: *"Here are my LinkedIn export, my last two resumes and a job I want. Use honest-resume."*

Tip: put your tracker, resumes, and story bank in a **Project** so every chat can see them.

### Claude Code

```
/plugin marketplace add ssscaryn/job-search-mirror
/plugin install make-the-mirror-true
```

Or copy the `skills/` folders into `~/.claude/skills/`.

## Start here

1. **my-standards:** spend twenty minutes filling in the claim ledger with Claude. Everything else reads it.
2. **search-tracker:** create or import your tracker, then load it into the page.
3. After your first interview, **interview-debrief**. That is where the kit starts paying for itself.

## A few rules the kit enforces

- **Consent.** Recording an interview without everyone's consent is illegal in California and several other states. Tell them a note taker is running and give them the chance to decline.
- **Your data stays yours.** Company and interviewer names stay in your files and out of anything you share.
- **You are the last check.** Read everything once before it goes out the door.

## Rebuilding the page

```
curl -L -o build/ca_warn_report.xlsx https://edd.ca.gov/siteassets/files/jobs_and_training/warn/warn_report1.xlsx
python3 build/build.py
```

This embeds the playbooks and the latest California layoff filings into `index.html` and `site/mirror.html`.

Questions or ideas: find Caryn Moore on LinkedIn.

## License

The playbooks and written content are [CC BY-NC 4.0](LICENSE-CONTENT): share and adapt them for non-commercial use with credit. The page and build code are [MIT](LICENSE).
