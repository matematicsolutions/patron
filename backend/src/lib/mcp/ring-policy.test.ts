// Testy dla decideRing - ring-policy.ts (ADR-0027).
//
// decideRing jest PURE FUNCTION - zero IO, zero side effects, zero zaleznosci
// od stanu globalnego. Testowalna w izolacji bez mockow.
//
// Sekcje:
//   Ring 1 - trusted patron connectors (6 nazw z APPROVED_PATRON_CONNECTORS)
//   Ring 2 - 3rd-party operator approved (explicit allow)
//   Ring 2 - default deny (fail-closed)
//   Pure function - determinism + brak mutacji argumentow
//   RingReason values (kontrakt audit_log)

import { describe, expect, it } from "vitest";
import { APPROVED_PATRON_CONNECTORS } from "../mcp-security";
import { decideRing } from "./ring-policy";

describe("decideRing (ADR-0027)", () => {
    describe("Ring 1 - trusted patron connectors", () => {
        it.each(APPROVED_PATRON_CONNECTORS)(
            "allow dla approved konektora: %s",
            (name) => {
                const decision = decideRing(name);
                expect(decision).toEqual({
                    ring: 1,
                    action: "allow",
                    reason: "trusted-patron-connector",
                });
            },
        );

        it("Ring 1 NIE wymaga config w ogole", () => {
            const decision = decideRing("saos");
            expect(decision.action).toBe("allow");
            expect(decision.ring).toBe(1);
        });

        it("Ring 1 ignoruje operatorApproved=false (nie obniza Ring 1 do deny)", () => {
            const decision = decideRing("saos", { operatorApproved: false });
            expect(decision.action).toBe("allow");
            expect(decision.ring).toBe(1);
            expect(decision.reason).toBe("trusted-patron-connector");
        });

        it("Ring 1 ignoruje trustLevel - decyzja na podstawie canonical list", () => {
            const decision = decideRing("saos", { trustLevel: "untrusted" });
            expect(decision.action).toBe("allow");
            expect(decision.ring).toBe(1);
        });

        it("Operator NIE moze podniesc nieznanego konektora do Ring 1", () => {
            // Nawet z 'trusted' i 'operatorApproved=true' nieznany konektor
            // dostaje Ring 2 (operatorApproved decyduje, ale Ring 2 nie Ring 1).
            const decision = decideRing("malicious-connector", {
                trustLevel: "trusted",
                operatorApproved: true,
            });
            expect(decision.ring).toBe(2);
            expect(decision.action).toBe("allow");
            expect(decision.reason).toBe("operator-approved-3rd-party");
        });
    });

    describe("Ring 2 - 3rd-party operator approved (explicit allow)", () => {
        it("allow gdy operatorApproved=true", () => {
            const decision = decideRing("vendor-x-mcp", {
                operatorApproved: true,
            });
            expect(decision).toEqual({
                ring: 2,
                action: "allow",
                reason: "operator-approved-3rd-party",
            });
        });

        it("allow gdy operatorApproved=true + trustLevel='trusted'", () => {
            const decision = decideRing("vendor-x-mcp", {
                trustLevel: "trusted",
                operatorApproved: true,
            });
            expect(decision.action).toBe("allow");
            expect(decision.ring).toBe(2);
        });

        it("allow gdy operatorApproved=true + trustLevel='untrusted' (operatorApproved decyduje)", () => {
            const decision = decideRing("vendor-x-mcp", {
                trustLevel: "untrusted",
                operatorApproved: true,
            });
            expect(decision.action).toBe("allow");
            expect(decision.reason).toBe("operator-approved-3rd-party");
        });
    });

    describe("Ring 2 - default deny (fail-closed)", () => {
        it("deny gdy operatorApproved=false (explicit reject)", () => {
            const decision = decideRing("vendor-x-mcp", {
                operatorApproved: false,
            });
            expect(decision).toEqual({
                ring: 2,
                action: "deny",
                reason: "no-operator-approval",
            });
        });

        it("deny gdy operatorApproved=undefined (brak pola)", () => {
            const decision = decideRing("vendor-x-mcp", { trustLevel: "trusted" });
            expect(decision.action).toBe("deny");
            expect(decision.reason).toBe("no-operator-approval");
        });

        it("deny gdy config=undefined (brak config w ogole)", () => {
            const decision = decideRing("vendor-x-mcp");
            expect(decision.action).toBe("deny");
            expect(decision.ring).toBe(2);
        });

        it("deny gdy config={} (empty)", () => {
            const decision = decideRing("vendor-x-mcp", {});
            expect(decision.action).toBe("deny");
        });

        it("deny gdy trustLevel='trusted' ale brak operatorApproved", () => {
            // trustLevel sam w sobie NIE wystarczy - operatorApproved jest obowiazkowy
            // dla Ring 2 allow. trustLevel jest tylko informacyjne (audytor widzi w git).
            const decision = decideRing("vendor-x-mcp", { trustLevel: "trusted" });
            expect(decision.action).toBe("deny");
        });

        it("deny dla pustego serverName (edge case)", () => {
            const decision = decideRing("");
            expect(decision.action).toBe("deny");
            expect(decision.ring).toBe(2);
        });

        it("deny gdy operatorApproved jest 'truthy' ale nie === true (safety)", () => {
            // Dokumentacja kontraktu: tylko operatorApproved === true (strict) zezwala.
            // String "true", liczba 1, etc. zwracaja deny - zabezpieczenie przed bledami
            // parsowania konfigu JSON / YAML z luznym typowaniem.
            const decision = decideRing("vendor-x-mcp", {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                operatorApproved: "true" as any,
            });
            expect(decision.action).toBe("deny");
        });
    });

    describe("Pure function - determinism + brak mutacji argumentow", () => {
        it("wielokrotne wywolanie z tymi samymi argumentami zwraca rowna decyzje", () => {
            const cfg = { operatorApproved: true, trustLevel: "trusted" as const };
            const d1 = decideRing("vendor-x", cfg);
            const d2 = decideRing("vendor-x", cfg);
            const d3 = decideRing("vendor-x", cfg);
            expect(d1).toEqual(d2);
            expect(d2).toEqual(d3);
        });

        it("nie modyfikuje przekazanego config (pure)", () => {
            const cfg = { operatorApproved: true, trustLevel: "trusted" as const };
            const cfgClone = { ...cfg };
            decideRing("vendor-x", cfg);
            expect(cfg).toEqual(cfgClone);
        });

        it("decyzja nie zalezy od kolejnosci wywolan (no global state)", () => {
            const d1 = decideRing("vendor-x", { operatorApproved: true });
            const d2 = decideRing("saos");
            const d3 = decideRing("vendor-x", { operatorApproved: true });
            expect(d1).toEqual(d3);
            expect(d2.reason).toBe("trusted-patron-connector");
        });
    });

    describe("RingReason values (kontrakt audit_log payload.reason)", () => {
        it("Ring 1 -> reason='trusted-patron-connector'", () => {
            expect(decideRing("krs").reason).toBe("trusted-patron-connector");
        });

        it("Ring 2 allow -> reason='operator-approved-3rd-party'", () => {
            expect(
                decideRing("vendor-x", { operatorApproved: true }).reason,
            ).toBe("operator-approved-3rd-party");
        });

        it("Ring 2 deny -> reason='no-operator-approval'", () => {
            expect(decideRing("vendor-x").reason).toBe("no-operator-approval");
        });
    });

    describe("Defense-in-depth narrative (ADR-0027)", () => {
        // Te testy dokumentuja zachowanie systemu zgodnie z opisem w ADR-0027.
        // Jesli te asercje failuja, ADR-0027 lub kod sa rozjazdze - sprawdz drift.

        it("ring-policy NIE zastepuje mcp-security gateway (defense-in-depth)", () => {
            // mcp-security gateway dziala LOAD-TIME (rejestracja konektora).
            // ring-policy dziala RUNTIME (per call). Razem - 2 warstwy obrony.
            // Ten test dokumentuje ze decideRing operuje tylko na nazwie + config,
            // NIE wykonuje skanu - to robi gateway oddzielnie.
            const decision = decideRing("saos");
            expect(decision.action).toBe("allow");
            // Gateway moglby odrzucic saos load-time (typosquat, drift, etc.) -
            // to NIE jest sprawa ring-policy. Ring-policy ufa ze do runtime
            // dotarl tylko approved konektor.
        });

        it("fail-closed default chroni przed bledem konfiguracji", () => {
            // Krytyczne: brak konfigu / brak pola = deny, NIE allow.
            // To chroni Kancelarie przed wlaczeniem konektora przez przypadek.
            expect(decideRing("any-name").action).toBe("deny");
            expect(decideRing("any-name", {}).action).toBe("deny");
            expect(decideRing("any-name", { trustLevel: "trusted" }).action).toBe("deny");
        });
    });
});
