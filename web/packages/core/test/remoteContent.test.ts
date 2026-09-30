import { describe, expect, it } from "vitest";
import { matchRemoteContentException, normalizeRemoteContentException, senderDomain } from "../src/index.js";

describe("Ausnahmen für externe Inhalte", () => {
  it.each([
    ["shop.example", "shop.example"],
    ["  Shop.Example  ", "shop.example"],
    ["@shop.example", "shop.example"],
    ["*.shop.example", "shop.example"],
    ["https://www.shop.example/newsletter?id=1", "shop.example"],
    ["News@Shop.Example", "news@shop.example"],
    ["Shop Newsletter <news@shop.example>", "news@shop.example"],
    ["mailto:news@shop.example", "news@shop.example"],
    ["bücher.example", "bücher.example"],
  ])("vereinheitlicht %j zu %j", (input, expected) => {
    expect(normalizeRemoteContentException(input)).toBe(expected);
  });

  it.each(["", "   ", "shop", "news@", "@", "a b.example", "news@shop", "https://", "a@b@c", "-shop.example"])(
    "lehnt %j ab",
    (input) => {
      expect(normalizeRemoteContentException(input)).toBeNull();
    },
  );

  it("Domain gilt für Subdomains, nicht für ähnliche Domains", () => {
    const list = ["shop.example"];
    expect(matchRemoteContentException(list, "news@shop.example")).toBe("shop.example");
    expect(matchRemoteContentException(list, "info@mail.shop.example")).toBe("shop.example");
    expect(matchRemoteContentException(list, "x@evilshop.example")).toBeNull();
    expect(matchRemoteContentException(list, "x@shop.example.evil.example")).toBeNull();
  });

  it("Adresse gilt nur für genau diese Adresse", () => {
    const list = ["news@shop.example"];
    expect(matchRemoteContentException(list, "News@Shop.example")).toBe("news@shop.example");
    expect(matchRemoteContentException(list, "rechnung@shop.example")).toBeNull();
    expect(matchRemoteContentException(list, "")).toBeNull();
  });

  it("schlägt die Domain des Absenders vor", () => {
    expect(senderDomain("News@Mail.Shop.example")).toBe("mail.shop.example");
    expect(senderDomain("kaputt")).toBe("");
  });
});
