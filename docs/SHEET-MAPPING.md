# Google Sheet Mapping

The React form mirrors the uploaded workbook and saves into the existing `Agents Reviewed` tab.

## Form fields

| React field | Original sheet cell | Destination header |
|---|---:|---|
| Agent Start Date | C3 | Agent Start Date |
| Today’s Date | C4 | Today's Date |
| Evaluator | C5 | Evaluator |
| Agent Name | C6 | Agent Name |
| Call Center | C7 | Call Center |
| Call ID | C8 | Call ID |
| QA Type | C9 | QA Type |
| Confirmation / Itinerary # | C10 | Itinerary Number |
| Length of Call | F8 | Length of Call |
| Date of Call | F9 | Date of Call |

## Criteria rows

The form uses up to nine criteria. Each criterion is saved into these existing headers:

- `Criteria N #`
- `Criteria N Name`
- `Criteria N Max Points`
- `Criteria N Status`
- `Criteria N Partial Points`
- `Criteria N Auto Points`
- `Criteria N Notes / Issue Found`
- `Custom Note N`

The metadata, nine criteria groups, nine custom-note columns, itinerary, call length, and call date match the existing A:CJ structure. Missing headers are appended only when necessary; existing rows are never shifted or cleared.
