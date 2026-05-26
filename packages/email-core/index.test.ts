import { describe, expect, it } from "vitest";
import { htmlToText, parseCsvContacts, renderTemplate, signToken, verifyToken, validateSenderDomain } from "./index";

describe("email core", () => {
  it("parses contacts, skips invalid rows, and dedupes emails", () => {
    const result = parseCsvContacts("email,first_name,plan\nada@example.com,Ada,Pro\nbad,nope,Free\nada@example.com,Ada,Pro");
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0].custom_fields_json.plan).toBe("Pro");
    expect(result.skipped[0].reason).toBe("invalid_email");
    expect(result.duplicates).toEqual(["ada@example.com"]);
  });

  it("normalizes common CSV header aliases", () => {
    const result = parseCsvContacts("Email Address,First Name,Company Name\nada@example.com,Ada,Acme");
    expect(result.contacts[0].email).toBe("ada@example.com");
    expect(result.contacts[0].first_name).toBe("Ada");
    expect(result.contacts[0].company).toBe("Acme");
  });

  it("maps full name CSV headers to contact name fields", () => {
    const result = parseCsvContacts("email,full name,source\nada@example.com,Ada Lovelace,signup");
    expect(result.contacts[0].first_name).toBe("Ada");
    expect(result.contacts[0].last_name).toBe("Lovelace");
    expect(result.contacts[0].source).toBe("signup");
    expect(result.contacts[0].custom_fields_json).not.toHaveProperty("full_name");
  });

  it("imports headerless contacts as email, full name, and source", () => {
    const result = parseCsvContacts("ada@example.com,Ada Lovelace,signup\ngrace@example.com,Grace Hopper,waitlist");
    expect(result.contacts).toHaveLength(2);
    expect(result.contacts[0]).toMatchObject({
      email: "ada@example.com",
      first_name: "Ada",
      last_name: "Lovelace",
      source: "signup"
    });
    expect(result.contacts[1]).toMatchObject({
      email: "grace@example.com",
      first_name: "Grace",
      last_name: "Hopper",
      source: "waitlist"
    });
    expect(result.skipped).toEqual([]);
  });

  it("renders template variables", () => {
    expect(renderTemplate("Hi {{ first_name }} from {{company}}", { first_name: "Ada", company: "Acme" })).toBe("Hi Ada from Acme");
  });

  it("derives plain text from basic HTML email content", () => {
    expect(htmlToText('<p>Hi Ada,</p><p><a href="https://example.com">Continue</a></p>')).toBe("Hi Ada,\n\nContinue: https://example.com");
  });

  it("validates sender domains", () => {
    expect(validateSenderDomain("hello@example.com", ["example.com"]).ok).toBe(true);
    expect(validateSenderDomain("hello@other.com", ["example.com"]).ok).toBe(false);
  });

  it("signs and verifies tracking tokens", async () => {
    const token = await signToken({ type: "unsubscribe", campaignId: "c1", recipientId: "r1", contactId: "ct1" }, "secret");
    await expect(verifyToken(token, "secret")).resolves.toMatchObject({ campaignId: "c1" });
    await expect(verifyToken(`${token}x`, "secret")).rejects.toThrow();
  });
});
