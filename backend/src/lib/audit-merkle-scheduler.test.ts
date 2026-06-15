// Testy pure helpers schedulera Merkle auto-trigger (ADR-0036).
//
// Zero mockow, zero DB. Czyste decyzje pure function `shouldComputeNextRoot`
// + parsery env. Wrapper IO `runAutoCompute` w `audit-merkle-roots.ts` ma
// wlasne testy integracyjne (poza tym ADR - rezerwacja ADR-0042).

import { describe, it, expect } from "vitest";
import {
    shouldComputeNextRoot,
    parseIntervalHours,
    parsePositiveInt,
    type SchedulerState,
} from "./audit-merkle-scheduler";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function makeState(overrides: Partial<SchedulerState> = {}): SchedulerState {
    return {
        lastCoveredEventId: 100,
        maxEventId: 150,
        lastRootComputedAt: 1_000_000_000_000, // dowolny baseline
        now: 1_000_000_000_000 + HOUR,
        countThreshold: 1000,
        intervalMs: 24 * HOUR,
        ...overrides,
    };
}

describe("shouldComputeNextRoot - skip scenariusze", () => {
    it("brak nowych eventow (maxEventId == lastCoveredEventId)", () => {
        const decision = shouldComputeNextRoot(makeState({ maxEventId: 100 }));
        expect(decision).toEqual({ compute: false, reason: "no_new_events" });
    });

    it("brak nowych eventow (maxEventId < lastCoveredEventId, defensywnie)", () => {
        // Hipotetyczne - jezeli ktos drop'nal eventy z audit_log po policzeniu roota.
        // Lepiej zwrocic skip niz probowac compute na ujemnym zakresie.
        const decision = shouldComputeNextRoot(
            makeState({ lastCoveredEventId: 200, maxEventId: 150 }),
        );
        expect(decision).toEqual({ compute: false, reason: "no_new_events" });
    });

    it("ponizej obu progow (mala liczba nowych eventow + swiezy root)", () => {
        const decision = shouldComputeNextRoot(
            makeState({
                lastCoveredEventId: 100,
                maxEventId: 150, // tylko 50 nowych
                countThreshold: 1000,
                intervalMs: DAY,
                lastRootComputedAt: 1_000_000_000_000,
                now: 1_000_000_000_000 + HOUR, // 1h temu
            }),
        );
        expect(decision).toEqual({ compute: false, reason: "below_thresholds" });
    });
});

describe("shouldComputeNextRoot - compute scenariusze", () => {
    it("initial_root gdy brak jakiegokolwiek roota (lastCoveredEventId == 0)", () => {
        const decision = shouldComputeNextRoot(
            makeState({
                lastCoveredEventId: 0,
                maxEventId: 5, // ledwie 5 eventow ale brak roota - lecimy
                countThreshold: 1000,
                intervalMs: DAY,
            }),
        );
        expect(decision).toEqual({
            compute: true,
            reason: "initial_root",
            blockStart: 1,
            blockEnd: 5,
        });
    });

    it("count_threshold gdy liczba nowych eventow >= prog", () => {
        const decision = shouldComputeNextRoot(
            makeState({
                lastCoveredEventId: 100,
                maxEventId: 1200, // 1100 nowych
                countThreshold: 1000,
                intervalMs: DAY,
                now: 1_000_000_000_000 + HOUR, // 1h temu, ponizej intervalMs
            }),
        );
        expect(decision).toEqual({
            compute: true,
            reason: "count_threshold",
            blockStart: 101,
            blockEnd: 1200,
        });
    });

    it("count_threshold dziala dokladnie na progu (newEvents == countThreshold)", () => {
        const decision = shouldComputeNextRoot(
            makeState({
                lastCoveredEventId: 100,
                maxEventId: 1100, // dokladnie 1000 nowych
                countThreshold: 1000,
            }),
        );
        expect(decision.compute).toBe(true);
        expect(decision.reason).toBe("count_threshold");
    });

    it("interval_threshold gdy wiek roota >= prog czasowy", () => {
        const decision = shouldComputeNextRoot(
            makeState({
                lastCoveredEventId: 100,
                maxEventId: 150, // tylko 50 nowych, ponizej count
                countThreshold: 1000,
                intervalMs: DAY,
                lastRootComputedAt: 1_000_000_000_000,
                now: 1_000_000_000_000 + 25 * HOUR, // 25h temu
            }),
        );
        expect(decision).toEqual({
            compute: true,
            reason: "interval_threshold",
            blockStart: 101,
            blockEnd: 150,
        });
    });

    it("interval_threshold dziala dokladnie na progu (ageMs == intervalMs)", () => {
        const decision = shouldComputeNextRoot(
            makeState({
                lastRootComputedAt: 1_000_000_000_000,
                now: 1_000_000_000_000 + DAY, // dokladnie 24h
                intervalMs: DAY,
            }),
        );
        expect(decision.compute).toBe(true);
        expect(decision.reason).toBe("interval_threshold");
    });

    it("count_threshold wygrywa gdy oba progi spelnione", () => {
        const decision = shouldComputeNextRoot(
            makeState({
                lastCoveredEventId: 100,
                maxEventId: 5000, // 4900 nowych >> count
                countThreshold: 1000,
                intervalMs: DAY,
                lastRootComputedAt: 1_000_000_000_000,
                now: 1_000_000_000_000 + 48 * HOUR, // 48h temu (interval tez spelniony)
            }),
        );
        // Kolejnosc sprawdzenia w funkcji: count -> interval. count_threshold wygrywa.
        expect(decision.reason).toBe("count_threshold");
    });

    it("blockStart = lastCoveredEventId + 1, blockEnd = maxEventId", () => {
        const decision = shouldComputeNextRoot(
            makeState({
                lastCoveredEventId: 500,
                maxEventId: 1500,
                countThreshold: 1000,
            }),
        );
        expect(decision.blockStart).toBe(501);
        expect(decision.blockEnd).toBe(1500);
    });
});

describe("parseIntervalHours", () => {
    it("zwraca default gdy env nieustawiony", () => {
        expect(parseIntervalHours(undefined, 12345)).toBe(12345);
    });

    it("zwraca default gdy env pusty string", () => {
        expect(parseIntervalHours("", 12345)).toBe(12345);
    });

    it("zwraca default gdy env niepoprawny (NaN)", () => {
        expect(parseIntervalHours("abc", 12345)).toBe(12345);
    });

    it("zwraca default gdy env <= 0 (defensywnie)", () => {
        expect(parseIntervalHours("0", 12345)).toBe(12345);
        expect(parseIntervalHours("-5", 12345)).toBe(12345);
    });

    it("konwertuje godziny do ms (24h = 86400000)", () => {
        expect(parseIntervalHours("24", 0)).toBe(24 * 3600 * 1000);
    });

    it("akceptuje czesci ulamkowe godzin (0.5h = 30 min = 1800000ms)", () => {
        expect(parseIntervalHours("0.5", 0)).toBe(1800 * 1000);
    });
});

describe("parsePositiveInt", () => {
    it("zwraca default gdy env nieustawiony", () => {
        expect(parsePositiveInt(undefined, 999)).toBe(999);
    });

    it("zwraca default gdy env niepoprawny", () => {
        expect(parsePositiveInt("abc", 999)).toBe(999);
    });

    it("zwraca default gdy env <= 0", () => {
        expect(parsePositiveInt("0", 999)).toBe(999);
        expect(parsePositiveInt("-100", 999)).toBe(999);
    });

    it("parsuje poprawna liczbe calkowita", () => {
        expect(parsePositiveInt("1500", 999)).toBe(1500);
    });

    it("obcina czesci ulamkowe (parseInt)", () => {
        expect(parsePositiveInt("1500.7", 999)).toBe(1500);
    });
});
