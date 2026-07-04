# Feature: CI na galeziach roboczych + testy frontendu w CI

**Branch:** `feat/etap-a3-fabryka` (pozycja A3-4)
**Date:** 2026-07-05
**Status:** Implemented

## Problem statement

CI biegal tylko na main + release/** - galaz robocza dowiadywala sie o czerwonej
suicie dopiero przy merge do linii wydaniowej (o cala faze za pozno). Dodatkowo
job frontend nie odpalal swiezych testow vitest (spec 012).

## Acceptance Criteria

- [x] AC1: `ci.yml` trigger push na WSZYSTKIE galezie (publication-gate zostaje
  na main+release/** - leak-scan pilnuje linii publikacyjnych, nie WIP-ow).
- [x] AC2: job frontend: krok `npm test` (vitest) po TSC, przed next build.

## Non-Goals

- npm audit / supply-chain gate w CI - osobna decyzja (backlog A4; na starcie
  bylby czerwony od zastanych advisories i nauczy ignorowania CI).
