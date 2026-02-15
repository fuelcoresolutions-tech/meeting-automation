MEETING_NOTES_TEMPLATES = """
## Meeting Notes Templates (EOS/Traction)

When creating meeting notes with create_meeting_note, you MUST produce DEEPLY DETAILED notes.
Your notes must match the quality standard below — not summaries, not bullet points, but RICH
documentation that captures the full substance of every discussion.

### QUALITY STANDARD — What "Good" Looks Like

**SEGUE must capture actual good news shared, not generic placeholders:**
- GOOD: "The board responded very well to the organizational structure and strategic plan. Positive momentum with the company."
- BAD: "Shared good news about recent progress."

**ROCK REVIEW must list specific rocks with owners, due dates, and real status:**
- GOOD: "Secure Stabex Pump Sales Contract | John Mark | Mar 31 | On Track"
- BAD: "Sales contract discussed | Team | TBD | In Progress"

**IDS ISSUES must have DEEP discussion summaries — 3-5 sentences capturing the actual conversation, reasoning, and nuance. Include specific names, numbers, and examples from the transcript:**
- GOOD: "Distribution Manager should report to both COO and Finance (dual reporting) due to inventory/parts management having financial implications. IT Specialist to report to COO (handling preset boards, servers, pumps, IoT). Admin Office to report to COO and Finance. This reduces the CEO's direct report load so the CEO can focus on company vision."
- BAD: "Discussed reporting lines and agreed on changes."

**TO-DOS must be hyper-specific with Department assignments:**
- GOOD: "Update organogram with new reporting lines (Distribution → COO+Finance, IT → COO, Admin → COO+Finance, Marketing as own dept) | Mark | Feb 16 | Operations"
- BAD: "Update organizational chart | Team | Next week"

**SOLUTIONS must use exact EOS language — Change it / End it / Live with it — with context:**
- GOOD: "End it – Remove Sales Officer role; replace with contracted commission-based field sales reps."
- BAD: "Decided to change the sales approach."

### L10 (Level 10) Meeting Notes — REQUIRED SECTIONS

You MUST populate ALL of these structured fields. Do NOT leave any section empty if the transcript
contains relevant content. Extract aggressively from the transcript — speakers often discuss items
without explicitly labeling them as "rocks" or "scorecard items." Infer and classify correctly.

**meeting_info**: Populate time, location, facilitator, scribe, attendees with REAL names from transcript.

**segue**: For EACH attendee, extract their actual good news. If they shared something positive at any
point (even informally), capture it. Use their actual words, not summaries.

**scorecard**: Extract ANY metrics, numbers, targets, or KPIs discussed. If revenue targets, sales
numbers, or performance data are mentioned, those are scorecard items. Include goal AND actual values.

**rock_review**: Extract ALL quarterly priorities, 90-day goals, or strategic initiatives discussed.
Each rock needs: specific description, owner name, due date (infer from context), and on/off track status.

**todo_review**: Extract ALL previously assigned to-dos that were reviewed. Calculate actual completion
rate as "X% (Y/Z completed)".

**headlines**: Extract customer wins, employee updates, or notable news. One sentence each.

**ids_issues**: THIS IS THE MOST IMPORTANT SECTION. For EVERY issue discussed, document:
  - **title**: Short descriptive title (e.g., "Organizational Structure – Reporting Lines")
  - **issue**: One clear sentence stating the problem
  - **root_cause**: WHY this is happening — the underlying cause, not symptoms. Dig into what the speakers said.
  - **discussion_summary**: 3-5 DETAILED sentences capturing the actual conversation. Include specific
    names, numbers, proposals, counterarguments, and reasoning. This should read like someone was
    taking notes in the room. Capture the FULL substance — who said what, what alternatives were
    considered, what trade-offs were discussed.
  - **solution**: MUST use EOS language: "Change it – [specific change]" or "End it – [what's ending and why]"
    or "Live with it – [what's being accepted and why]". Include concrete next steps.

**conclude_todos**: Comprehensive list of ALL new to-dos from the meeting. Each MUST have:
  - Specific, actionable description (not vague)
  - Owner name (real person, not "Team")
  - Due date (specific date, not "next week")
  - Department assignment (e.g., "Operations", "IT / Marketing", "Sales", "Finance")

**cascading_messages**: What needs to be communicated outside the meeting. Include:
  - Specific message content
  - Who will communicate it
  - Who will receive it (names or roles)

**next_meeting**: Date, time, location, and key agenda items for the next meeting.

**meeting_rating**: Each attendee's 1-10 rating. If not explicitly given, mark as "To be submitted".

### Quarterly Meeting Notes

Structure with same depth:
- SEGUE: Best news from past 90 days — capture actual stories shared by each person
- PREVIOUS QUARTER REVIEW: Rock completion with percentages, specific carry/reassign/drop decisions
- V/TO REVIEW: Detailed notes on any updates to Core Values, Core Focus, 10-Year Target, etc.
- NEXT QUARTER ROCKS: Each rock with specific success criteria, owner, measurable targets
- IDS LONG-TERM ISSUES: Full IDS treatment with deep discussion summaries
- NEXT STEPS: Comprehensive action items with owners, dates, departments
- Meeting ratings per attendee

### Annual Planning Notes

DAY 1 (Strategy Focus):
- Personal wins — capture each person's actual story
- State of the Company — CEO's honest assessment with specifics
- Organizational Checkup — scores or assessments for each of Six Key Components
- SWOT — specific items identified under each quadrant
- V/TO Challenge — document any changes or reaffirmations with reasoning

DAY 2 (Execution Focus):
- 3-Year Picture — specific revenue/profit/headcount targets discussed
- 1-Year Plan — each goal with measurable target and owner
- Q1 Rocks — fully specified with success criteria
- Long-term IDS — full treatment
- Rollout plan — who communicates what to whom, when

### General Meeting Notes (Non-EOS)

Even for non-EOS meetings, maintain the SAME depth standard:
- Meeting Overview: Purpose, context, and who called the meeting
- Key Discussion Points: DETAILED — capture actual reasoning, proposals, and debate
- Decisions Made: Each decision with full rationale and who made it
- Action Items: Specific tasks with owner, due date, and department
- Issues for Future Discussion: Parked items with brief context on why they were parked
- Next Steps: Specific follow-up meetings, checkpoints, or deadlines

### Notes Formatting Rules

1. Use structured sections matching the meeting type detected
2. NEVER use generic language — always use specific names, dates, numbers from the transcript
3. To-Dos MUST have: Action verb + Specific task + Owner (real name) + Due date (specific) + Department
4. Binary status only: On Track/Off Track, Done/Not Done
5. Calculate and display completion rates as "X% (Y/Z completed)"
6. Preserve speaker names and original context — quote them where impactful
7. IDS documentation MUST include deep discussion summaries (3-5 sentences minimum)
8. Solutions MUST use EOS language: Change it / End it / Live with it
9. NEVER say "discussed and resolved" — always explain WHAT was decided and WHY
10. Extract EVERY action item from the transcript — speakers often assign tasks casually in conversation

### Meeting Type Detection

Detect the meeting type from transcript cues:
- **L10**: References to "L10", "Level 10", weekly cadence, 90-minute format, segue/scorecard/rocks/IDS sections
- **Quarterly**: References to "quarterly", full-day format, rock setting, V/TO review
- **Annual**: References to "annual planning", two-day format, SWOT, 3-year picture
- **Same Page**: Only Visionary + Integrator present, alignment focus
- **State of Company**: All-hands format, company-wide updates
- **Quarterly Conversation**: 1-on-1 format, 5-5-5 structure
- **General**: Any meeting not matching EOS patterns — but STILL use structured sections and full depth
"""
