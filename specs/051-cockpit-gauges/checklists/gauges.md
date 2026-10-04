# Requirements Checklist: shared gauges

**Purpose**: unit-test the requirements for completeness, clarity and measurability before tasks
**Created**: 2026-10-04
**Feature**: [spec.md](../spec.md)

## Completeness

- [x] CHK001 Are all four lamp states and their meanings named? [Spec §Key Entities, FR-001]
- [x] CHK002 Is the behaviour for an unknown lamp state at run time defined? [FR-004]
- [x] CHK003 Are both dial sizes given concrete dimensions? [FR-008, Clarifications]
- [x] CHK004 Is "no rating" defined for missing, non-number and zero values? [FR-007]
- [x] CHK005 Are single, range, equal-ends, missing-end and empty odometer states defined? [FR-010, Edge Cases]
- [x] CHK006 Are the texts the parts own listed with both languages? [FR-009, plan Texts]
- [x] CHK007 Is the motion hand-off to ST-53 defined without animating here? [FR-012]

## Clarity

- [x] CHK008 Is "rounded half up" defined against binary approximation (4.85 → 4.9)? [Assumptions, US2-S4]
- [x] CHK009 Is "whole lei" defined as rounding per amount before formatting? [FR-010]
- [x] CHK010 Is "screen reader hears once" stated as an observable (one atomic live region)? [FR-011]
- [x] CHK011 Is "styled only by tokens" split into token-bound properties and local geometry? [FR-013]

## Measurability

- [x] CHK012 Are contrast floors given as ratios with the surfaces they apply to? [FR-005, SC-001]
- [x] CHK013 Are widths for the overflow check given (320/375/1280 px)? [SC-003]
- [x] CHK014 Are the expected strings for both languages written out? [SC-002]

## Scope and conflicts

- [x] CHK015 Is placement on real screens excluded? [Spec Input; ST-51 Out of scope]
- [x] CHK016 Are the screenshot comparison and axe scan replacements recorded with a reason? [Assumptions]
- [x] CHK017 Is the catalogue location decided (existing `/cockpit`) with the reason? [Assumptions]
