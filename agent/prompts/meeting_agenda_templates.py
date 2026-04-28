MEETING_AGENDA_TEMPLATES = """
## Meeting Agenda Templates (EOS/Traction)

When the transcript discusses planning a future meeting, create an agenda using the appropriate template below.
Use the create_meeting_agenda tool with the correct meeting_type and populate all available fields.

### L10 (Level 10) Meeting Agenda — Weekly, exactly 90 minutes

Structure:
1. SEGUE (5 min) — Each person shares one personal and one professional good news item.
2. SCORECARD REVIEW (5 min) — Report metrics as "on track" or "off track" only. Drop items needing discussion to Issues List.
3. ROCK REVIEW (5 min) — Report quarterly priorities as "on track" or "off track" only.
4. CUSTOMER/EMPLOYEE HEADLINES (5 min) — Share notable news in one sentence. Good and bad news welcome.
5. TO-DO LIST REVIEW (5 min) — Report last week's items as "done" or "not done". Target: 90%+ completion rate.
6. IDS — IDENTIFY, DISCUSS, SOLVE (60 min) — Prioritize top 3 issues from Issues List. Work through each using IDS process.
7. CONCLUDE (5 min) — Recap all new To-Dos, determine cascading messages, rate meeting 1-10 (target: 8+).

When creating an L10 agenda:
- Set duration_minutes to 90
- Extract rocks_to_review from any Rocks/quarterly priorities mentioned
- Extract known_issues from any problems, blockers, or concerns discussed
- Identify facilitator if mentioned
- List all attendees by name

### Quarterly Meeting Agenda — Full day, 6-8 hours

Morning Session:
1. SEGUE (15 min) — Best news from past 90 days
2. PREVIOUS QUARTER REVIEW (30 min) — Rock completion (target: 80%), carry forward/reassign/drop decisions, win or learn verdict
3. V/TO REVIEW (60 min) — Review Vision/Traction Organizer: Core Values, Core Focus, 10-Year Target, Marketing Strategy, 3-Year Picture, 1-Year Plan

Afternoon Session:
4. ESTABLISH NEXT QUARTER'S ROCKS (120 min) — Brainstorm, keep/kill/combine, select 3-7 Company Rocks, assign owners
5. IDS LONG-TERM ISSUES (180 min) — Strategic Issues List
6. NEXT STEPS (7 min) — Action item owners, org-wide communications
7. CONCLUDE (8 min) — Feedback, rate meeting 1-10

When creating a Quarterly agenda:
- Set duration_minutes to 480
- Extract rocks_to_review from current quarter rocks
- Extract known_issues from strategic issues mentioned

### Annual Planning Agenda — Two days

DAY 1 — STRATEGY & VISION (8 hours):
1. Personal Check-in (20 min)
2. State of the Company (20 min)
3. Team Health Exercises (60 min)
4. Organizational Checkup (90 min) — All Six Key Components: Vision, People, Data, Issues, Process, Traction
5. SWOT Analysis (60 min) — Feed findings into Issues List
6. V/TO Challenge (120 min) — Question and refresh every element

DAY 2 — EXECUTION & PLANNING (8 hours):
7. Day 2 Kickoff (15 min)
8. 3-Year Picture Refresh (90 min) — Revenue, profit, key measurables
9. 1-Year Plan (120 min) — 3-7 annual goals with owners
10. Q1 Rocks (90 min)
11. IDS Strategic Issues (120 min)
12. Rollout Planning (30 min)
13. Conclude (15 min)

### Same Page Meeting Agenda — Monthly, 2-4 hours

For Visionary and Integrator alignment only:
1. Check-in (10 min)
2. Build Issues List (20 min)
3. IDS Until Aligned (remaining time)
4. Confirm Same Page (5 min)
Rule: Do not leave until 100% agreement.

### State of the Company Agenda — Quarterly, 45-90 minutes

All-hands meeting, held 2 weeks after Quarterly Meeting:
1. Welcome (5 min)
2. Previous Quarter Results (15 min) — Rock completion, key wins and lessons
3. V/TO Review (15 min) — Core Values, Core Focus, 10-Year Target
4. New Quarterly Rocks (15 min)
5. Core Values Recognition (10 min)
6. Q&A (20 min)
7. Close (5 min)

### Quarterly Conversation Agenda — 30-60 minutes

One-on-one manager/direct report, held off-site:
THE 5-5-5 FORMAT (manager listens 80%, speaks 20%):
1. Employee shares what's working (5 min)
2. Manager shares what's working about employee (5 min)
3. Employee shares what's not working (5 min)
4. Manager shares what's not working (5 min)
5. Collaborate on solutions together (remaining time)

### Agenda Preparation Checklist

Before creating any agenda, extract from the transcript:
- Confirmed date, time, location
- Facilitator and Scribe assignments (for L10)
- Known metrics for Scorecard
- Current Rocks with owners
- Outstanding To-Dos carried forward
- Known issues for discussion
- Attendee list

### Ten Meeting Rules

Include these principles when creating agendas:
1. Same day, same time, every week
2. Same agenda structure — no deviations
3. Start on time regardless of attendance
4. End exactly on time — no extensions
5. No phones or devices (except for notes)
6. One conversation at a time
7. Binary responses only during reporting
8. Drop items to Issues — no explanations
9. Solve issues forever using IDS
10. Rate every meeting 1-10
"""
