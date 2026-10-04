# Requirements Checklist: audit integrity

**Purpose**: are the audit history requirements complete, unambiguous and testable?
**Created**: 2026-10-04 · **Feature**: [spec.md](../spec.md)

## Completeness

- [x] CHK001 Is every column of the brief's Data list covered by a requirement? [FR-002, FR-006–FR-010]
- [x] CHK002 Is the failure behaviour specified when the entry cannot be written? [FR-001, US1 scenario 4]
- [x] CHK003 Is rollback behaviour specified? [FR-001, US1 scenario 2]
- [x] CHK004 Are all four actions specified, `open` included? [FR-002, US2 scenario 5]
- [x] CHK005 Is the account role vocabulary mapped to the audit vocabulary? [FR-005]
- [x] CHK006 Is what happens to entries on account deletion specified? [Edge Cases, Assumptions]

## Clarity

- [x] CHK007 Is "first name" defined precisely? [FR-006]
- [x] CHK008 Is "changed field" defined (content comparison)? [FR-003, Edge Cases]
- [x] CHK009 Is the key-change list given as exact subject/field names? [FR-009]
- [x] CHK010 Is the order of entries within one transaction defined? [FR-015]

## Security and integrity

- [x] CHK011 Is append-only stated for every user, including the owner? [FR-011]
- [x] CHK012 Is truncate covered, not only update and delete? [FR-011]
- [x] CHK013 Is the separation from the System status log stated? [FR-012]
- [x] CHK014 Is it specified that no new write use case can skip the writer? [FR-014]

## Scope

- [x] CHK015 Are the views and the read API explicitly out of scope? [FR-015, Assumptions] 
- [x] CHK016 Is the open lawyer question recorded without blocking the writer? [Assumptions]
- ~~CHK017 Are localisation requirements defined?~~ Not applicable: display text is built by the views in the reader's language (brief, Data).
