---
name: search-tracker
description: Create and maintain the job seeker's application tracker, then turn it into honest analysis such as a Sankey funnel, conversion by role family or resume version, the round where they stall, and pipeline pace. Use when the user logs an application or response, asks how their search is going, feels discouraged, or asks for a chart.
---

# Search Tracker

Feelings swing during a search. The tracker keeps them honest. It is there to provide data, and the data is what backs up their confidence on a bad day.

## The tracker

If they do not have one, create it from `job-tracker-template.csv` in this skill folder (or the columns below) in whatever they use: a spreadsheet, a CSV, a Notion table. If they already have one, **keep their format exactly** and never restructure it without asking.

Core columns: Date applied · Company · Role title · Role family · Resume version · Location / onsite days · Commute cost per office day · Comp band · Source · Posting age · Times reposted · Furthest round · Outcome · Notes · Revisit reason.

Red flag columns (filled in by **job-triage**, **interview-debrief**, and **salary-script** as they come up): Client disclosed · Approved submission · Scam signals · Number of rounds · Interview hours · Take-home hours · First contact · Decision date · Interviewers · Panel observation · Possibly unlawful questions · Resume misstated · Rescheduled by company · Ghosted after final · Offer changes.

Rules:
- **You maintain it.** When they tell you about an application or a response in plain language, write the row and tell them exactly what changed.
- **Check the real date** before stamping anything. Ask if unsure.
- **Never invent a cause.** If a status is unclear, ask.

## Analysis they can ask for

1. **Funnel / Sankey.** Applied → no response / rejected / screener → hiring manager → panel or technical → offer. Draw it as a Sankey (an artifact or SVG). Show counts and percentages.
2. **Conversion by lane.** Response and interview rate by role family and by resume version. Small samples get a warning ("1 of 2 is not a trend").
3. **Where they stall.** Advancement rate per round. This is often the most useful single number in the search.
4. **Pace.** Applications per week alongside interviews per week. When interviews ramp up, applications usually collapse, and a few weeks later the pipeline looks like it ended on its own. Suggest a steady floor (around a dozen applications a week while interviewing) and show them when they drop below it.
5. **Any question they bring.** "Does it matter who interviews me?" Cut the data and report what it shows, even when the comforting story is different.

6. **Red flags by company.** Group what they observed by stage (posting, recruiter, process, offer): postings open 60+ days, repeat reposts, no pay band, roles shopped by several agencies, recent layoff filings, clients not named, submissions without approval, scam patterns, long processes, possibly unlawful questions, resume misstatements, homogeneous panels, repeated rescheduling, ghosting after the final round, offers that changed. Show the evidence next to each flag, and word every one as an observation.

## Bad days

When they say they feel the search is failing, look at the numbers with them first. Name what is genuinely working (a response rate that is good for the market, an active pipeline) and the one thing that would most improve it. Keep it short and kind.

## Privacy

Company and interviewer names stay in their tracker. Strip them from any chart or summary meant to be shared or presented.
