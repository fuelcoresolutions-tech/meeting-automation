MEETING_NOTES_TEMPLATES = """
## Meeting Notes Templates (EOS/Traction)

When creating meeting notes with create_meeting_note, structure the overview and key_points
according to the meeting type detected from the transcript.

### L10 (Level 10) Meeting Notes

Structure the overview to cover each section that was discussed:

**SEGUE**: List each person's good news (personal/professional) shared.

**SCORECARD REVIEW**: For each metric discussed, note:
- Metric name | Owner | Goal vs Actual | On Track or Off Track
- Any metrics dropped to Issues List for deeper discussion

**ROCK REVIEW**: For each Rock discussed, note:
- Rock name | Owner | On Track or Off Track
- Any Rocks dropped to Issues List

**CUSTOMER/EMPLOYEE HEADLINES**: One-sentence headlines only. Note items dropped to Issues List.

**TO-DO LIST REVIEW**: For each to-do from last meeting:
- To-Do description | Owner | Done or Not Done
- Calculate and report completion rate (target: 90%+)

**IDS (IDENTIFY, DISCUSS, SOLVE)**: For each issue resolved, document:
- Issue: One clear sentence stating the problem
- Root Cause: The underlying cause, not symptoms
- Discussion Summary: Key points raised (2-3 sentences max)
- Solution: What was decided (Live with it / End it / Change it)
- To-Do(s): Action verb + Specific task | Owner | Due Date

**CONCLUDE**: Document:
- All new To-Dos with owners and due dates
- Cascading Messages: What needs communicating | Who communicates | To whom
- Meeting Rating: Each attendee's 1-10 rating and the average (target: 8+)

### Quarterly Meeting Notes

Structure the overview to cover:
- SEGUE: Best news from past 90 days per person
- PREVIOUS QUARTER REVIEW: Rock completion status (target: 80%), carry forward/reassign/drop decisions, quarter verdict (Win or Learn)
- V/TO REVIEW: Any updates to Core Values, Core Focus, 10-Year Target, Marketing Strategy, 3-Year Picture, 1-Year Plan
- NEXT QUARTER ROCKS: Company Rocks (3-7 max) each with Owner and success criteria
- IDS LONG-TERM ISSUES: Strategic issues resolved, to-dos and owners assigned
- NEXT STEPS: Action items with owners, org-wide communication plan
- Meeting ratings

### Annual Planning Notes

DAY 1 (Strategy Focus):
- Personal wins from the year
- State of the Company (CEO assessment)
- Organizational Checkup results across Six Key Components
- SWOT analysis findings fed into Issues List
- V/TO Challenge — any changes to Core Values, Core Focus, 10-Year Target, Marketing Strategy

DAY 2 (Execution Focus):
- 3-Year Picture refresh with measurable targets (revenue, profit, key measurables)
- 1-Year Plan with 3-7 annual goals and owners
- Q1 Rocks with owners and success criteria
- Long-term IDS resolutions
- Rollout plan for organization-wide communication

### General Meeting Notes (Non-EOS)

For meetings that don't follow EOS format:
- Meeting Overview: Purpose and key context
- Key Discussion Points: Main topics with bullet points
- Decisions Made: Clear decisions with rationale
- Action Items: Who does what by when
- Issues for Future Discussion: Parked items
- Next Steps: Follow-up meetings or checkpoints

### Notes Formatting Rules

1. Use structured sections matching the meeting type detected
2. Keep headlines to one sentence maximum
3. To-Dos MUST have: Action verb + Specific task + Owner + 7-day deadline
4. Binary status only: On Track/Off Track, Done/Not Done
5. Calculate and display completion rates where applicable
6. Preserve speaker names and original context from the transcript
7. IDS documentation must include root cause and specific solution, not just "discussed"

### Meeting Type Detection

Detect the meeting type from transcript cues:
- **L10**: References to "L10", "Level 10", weekly cadence, 90-minute format, segue/scorecard/rocks/IDS sections
- **Quarterly**: References to "quarterly", full-day format, rock setting, V/TO review
- **Annual**: References to "annual planning", two-day format, SWOT, 3-year picture
- **Same Page**: Only Visionary + Integrator present, alignment focus
- **State of Company**: All-hands format, company-wide updates
- **Quarterly Conversation**: 1-on-1 format, 5-5-5 structure
- **General**: Any meeting not matching EOS patterns
"""
