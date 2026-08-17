import { describe, it, expect } from "vitest";
import { decideRoute } from "./decideRoute";
import type { DataClassification, EgressFlag } from "../llm/provider";

const CLASSIFICATIONS: DataClassification[] = [
    "public",
    "internal",
    "client_general",
    "attorney_client_privileged",
];
const EGRESS: EgressFlag[] = ["no-egress", "eu-only", "us-with-dpa"];

describe("decideRoute - straznik data-residency (macierz)", () => {
    it("model lokalny (no-egress) zawsze dozwolony - kazda klasyfikacja", () => {
        for (const classification of CLASSIFICATIONS) {
            for (const allowUsProviders of [false, true]) {
                const d = decideRoute({
                    classification,
                    egress: "no-egress",
                    allowUsProviders,
                });
                expect(d.action).toBe("allow");
                expect(d.reason).toBe("local-no-egress");
            }
        }
    });

    it("tajemnica zawodowa: blok do KAZDEGO modelu nielokalnego, nawet z ALLOW_US", () => {
        for (const egress of ["eu-only", "us-with-dpa"] as EgressFlag[]) {
            for (const allowUsProviders of [false, true]) {
                const d = decideRoute({
                    classification: "attorney_client_privileged",
                    egress,
                    allowUsProviders,
                });
                expect(d.action).toBe("block");
                expect(d.reason).toBe("privileged-requires-local");
            }
        }
    });

    it("eu-only: dozwolony dla public/internal/client_general", () => {
        for (const classification of [
            "public",
            "internal",
            "client_general",
        ] as DataClassification[]) {
            const d = decideRoute({
                classification,
                egress: "eu-only",
                allowUsProviders: false,
            });
            expect(d.action).toBe("allow");
            expect(d.reason).toBe("eu-within-allowed-zone");
        }
    });

    it("us-with-dpa + ALLOW_US=false: blok dla wszystkich nie-tajemnicowych", () => {
        for (const classification of [
            "public",
            "internal",
            "client_general",
        ] as DataClassification[]) {
            const d = decideRoute({
                classification,
                egress: "us-with-dpa",
                allowUsProviders: false,
            });
            expect(d.action).toBe("block");
            expect(d.reason).toBe("us-providers-disabled");
        }
    });

    it("us-with-dpa + ALLOW_US=true: dozwolony dla nie-tajemnicowych (decyzja Administratora)", () => {
        for (const classification of [
            "public",
            "internal",
            "client_general",
        ] as DataClassification[]) {
            const d = decideRoute({
                classification,
                egress: "us-with-dpa",
                allowUsProviders: true,
            });
            expect(d.action).toBe("allow");
            expect(d.reason).toBe("us-allowed-by-administrator");
        }
    });

    it("us-with-dpa + ALLOW_US=true: tajemnica DALEJ zablokowana (flaga nie odblokowuje)", () => {
        const d = decideRoute({
            classification: "attorney_client_privileged",
            egress: "us-with-dpa",
            allowUsProviders: true,
        });
        expect(d.action).toBe("block");
        expect(d.reason).toBe("privileged-requires-local");
    });

    it("decyzja zawiera echo klasyfikacji i strefy (dla audytu)", () => {
        const d = decideRoute({
            classification: "client_general",
            egress: "us-with-dpa",
            allowUsProviders: false,
        });
        expect(d.classification).toBe("client_general");
        expect(d.egress).toBe("us-with-dpa");
    });

    it("pelna macierz: zaden przypadek nie zostaje bez decyzji allow/block", () => {
        for (const classification of CLASSIFICATIONS) {
            for (const egress of EGRESS) {
                for (const allowUsProviders of [false, true]) {
                    const d = decideRoute({
                        classification,
                        egress,
                        allowUsProviders,
                    });
                    expect(["allow", "block"]).toContain(d.action);
                }
            }
        }
    });
});

describe("decideRoute - zgoda Operatora na chmure dla tajemnicy (ADR-0101)", () => {
    it("domyslnie (allowPrivilegedCloud falsy) tajemnica do chmury = blok", () => {
        for (const egress of ["eu-only", "us-with-dpa"] as EgressFlag[]) {
            const d = decideRoute({
                classification: "attorney_client_privileged",
                egress,
                allowUsProviders: true,
            });
            expect(d.action).toBe("block");
            expect(d.reason).toBe("privileged-requires-local");
        }
    });

    it("ze zgoda Operatora tajemnica dopuszcza KAZDY model (eu-only i us-with-dpa)", () => {
        for (const egress of ["eu-only", "us-with-dpa"] as EgressFlag[]) {
            const d = decideRoute({
                classification: "attorney_client_privileged",
                egress,
                allowUsProviders: false, // zgoda na tajemnice obejmuje tez US
                allowPrivilegedCloud: true,
            });
            expect(d.action).toBe("allow");
            expect(d.reason).toBe("privileged-cloud-by-operator");
        }
    });

    it("model lokalny pozostaje dozwolony bez wzgledu na zgode", () => {
        const d = decideRoute({
            classification: "attorney_client_privileged",
            egress: "no-egress",
            allowUsProviders: false,
            allowPrivilegedCloud: true,
        });
        expect(d.action).toBe("allow");
        expect(d.reason).toBe("local-no-egress");
    });

    it("zgoda na tajemnice NIE zmienia regul dla nizszych klasyfikacji (US nadal pod allowUsProviders)", () => {
        const d = decideRoute({
            classification: "internal",
            egress: "us-with-dpa",
            allowUsProviders: false,
            allowPrivilegedCloud: true,
        });
        expect(d.action).toBe("block");
        expect(d.reason).toBe("us-providers-disabled");
    });
});
