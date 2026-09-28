import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
describe("School admin access UI", () => {
  it("preserves tabs and exposes the complete administrator form", () => {
    const html = readFileSync("public/index.html", "utf8");
    for (const text of [
      "requestsPanel",
      "instancesPanel",
      "ACCÈS ADMINISTRATEURS",
      "Créer administrateur",
      "Nom complet",
      "E-mail",
      "Téléphone",
      "Confirmation mot de passe",
      "Générer un mot de passe",
      "Copier",
      "CRÉER L’ACCÈS",
    ])
      expect(html).toContain(text);
  });
  it("supports every state and action without password storage", () => {
    const js = readFileSync("public/app.js", "utf8");
    for (const text of [
      "school-admin-access",
      "reset-password",
      "reactivate",
      "suspend",
      "revoke",
      "Accès révoqué",
      "École créée",
      "À créer",
      "crypto.getRandomValues",
      "Révoquer définitivement cet accès ?",
    ])
      expect(js).toContain(text);
    expect(js).not.toMatch(/localStorage.setItem\([^\n]*password/i);
  });
});

import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { vi } from "vitest";

function uiHarness() {
  const elements = new Map<string, any>();
  const makeElement = (id = ""): any => {
    const classes = new Set<string>();
    let content = "",
      html = "";
    const el: any = {
      id,
      value: "",
      type: "password",
      disabled: false,
      required: false,
      dataset: {},
      style: {},
      listeners: {},
      classList: {
        add: (c: string) => classes.add(c),
        remove: (c: string) => classes.delete(c),
        toggle: (c: string, on: boolean) =>
          on ? classes.add(c) : classes.delete(c),
        contains: (c: string) => classes.has(c),
      },
      addEventListener: (event: string, fn: any) => {
        el.listeners[event] = fn;
      },
      focus: () => {},
      querySelectorAll: () => [],
      reset: () => {
        for (const [key, value] of elements)
          if (key.startsWith("access")) value.value = "";
      },
      get textContent() {
        return content;
      },
      set textContent(v: string) {
        content = v;
        html = String(v)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      },
      get innerHTML() {
        return html;
      },
      set innerHTML(v: string) {
        html = v;
      },
    };
    return el;
  };
  const get = (id: string) => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };
  const tabs = ["requests", "instances", "adminAccess"].map((tab) => {
    const el = makeElement();
    el.dataset.tab = tab;
    return el;
  });
  let rows: any[] = [];
  const calls: Array<{ path: string; method: string; body: any }> = [];
  const fetch = vi.fn(async (path: string, options: any) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method, body });
    if (options.method === "POST" && path === "/school-admin-access") {
      rows.push({
        id: "qa-id",
        display_name: body.display_name,
        email_normalized: body.email,
        phone_normalized: body.phone,
        status: "active",
        onboarding_state: "pending",
        school_id: null,
        created_at: "2026-01-01",
      });
    } else if (options.method === "POST") {
      const action = path.split("/").at(-1);
      if (action === "suspend") rows[0].status = "suspended";
      if (action === "reactivate") rows[0].status = "active";
      if (action === "revoke") rows[0].status = "revoked";
    }
    return { ok: true, status: 200, json: async () => ({ data: rows }) };
  });
  const confirm = vi.fn(() => true);
  const clipboard = vi.fn(async () => {});
  const storage = { getItem: () => "", setItem: vi.fn(), removeItem: vi.fn() };
  runInNewContext(readFileSync("public/app.js", "utf8"), {
    document: {
      getElementById: get,
      createElement: () => makeElement(),
      querySelectorAll: (s: string) => (s === ".tab" ? tabs : []),
    },
    fetch,
    confirm,
    crypto: webcrypto,
    Uint8Array,
    localStorage: storage,
    navigator: { clipboard: { writeText: clipboard } },
    setTimeout: () => 0,
    Date,
    console,
  });
  const fire = async (id: string, event = "click", extra: any = {}) =>
    get(id).listeners[event]({
      preventDefault() {},
      target: get(id),
      ...extra,
    });
  const action = async (name: string) =>
    fire("adminAccessBody", "click", {
      target: {
        closest: () => ({
          dataset: { accessId: "qa-id", accessAction: name },
          disabled: false,
        }),
      },
    });
  return {
    get,
    fire,
    action,
    calls,
    confirm,
    clipboard,
    storage,
    setRows: (value: any[]) => {
      rows = value;
    },
  };
}

describe("Administrator UI interactions", () => {
  it("creates, resets, suspends, reactivates and revokes through the real UI handlers", async () => {
    const h = uiHarness();
    await h.fire("createAdminAccessBtn");
    h.get("accessDisplayName").value = "QA Administrator";
    h.get("accessEmail").value = "qa-admin-access@schoolsafe.test";
    await h.fire("generateAccessPassword");
    const generated = h.get("accessPassword").value;
    expect(generated.length).toBeGreaterThanOrEqual(16);
    expect(h.get("accessPasswordConfirm").value).toBe(generated);
    await h.fire("copyAccessPassword");
    expect(h.clipboard).toHaveBeenCalledWith(generated);
    await h.fire("adminAccessForm", "submit");
    expect(h.calls[0]).toMatchObject({
      path: "/school-admin-access",
      method: "POST",
      body: { password: generated },
    });
    expect(h.get("accessPassword").value).toBe("");
    expect(h.get("adminAccessBody").innerHTML).toContain("ACTIVE");
    expect(h.get("adminAccessBody").innerHTML).toContain("À créer");
    await h.action("reset-password");
    h.get("accessPassword").value = "New-QA-Password!2026";
    h.get("accessPasswordConfirm").value = "New-QA-Password!2026";
    await h.fire("adminAccessForm", "submit");
    expect(h.calls.some((call) => call.path.endsWith("/reset-password"))).toBe(
      true,
    );
    expect(h.confirm).toHaveBeenCalled();
    await h.action("suspend");
    expect(h.get("adminAccessBody").innerHTML).toContain("SUSPENDED");
    expect(h.get("adminAccessBody").innerHTML).toContain("Réactiver");
    await h.action("reactivate");
    expect(h.get("adminAccessBody").innerHTML).toContain("ACTIVE");
    await h.action("revoke");
    expect(h.get("adminAccessBody").innerHTML).toContain("REVOKED");
    expect(h.get("adminAccessBody").innerHTML).toContain("Accès révoqué");
    expect(h.get("adminAccessBody").innerHTML).not.toContain(
      "data-access-action",
    );
    expect(h.storage.setItem).not.toHaveBeenCalled();
  });
  it("blocks missing identity and mismatched passwords, clears secrets on cancel", async () => {
    const h = uiHarness();
    await h.fire("createAdminAccessBtn");
    h.get("accessPassword").value = "QA-Password!2026";
    h.get("accessPasswordConfirm").value = "different";
    await h.fire("adminAccessForm", "submit");
    expect(h.calls).toHaveLength(0);
    h.get("accessPasswordConfirm").value = "QA-Password!2026";
    await h.fire("adminAccessForm", "submit");
    expect(h.calls).toHaveLength(0);
    expect(h.get("adminAccessError").textContent).toContain(
      "E-mail ou téléphone",
    );
    await h.fire("cancelAdminAccess");
    expect(h.get("accessPassword").value).toBe("");
  });
  it("cancels destructive actions and escapes values rendered in the table", async () => {
    const h = uiHarness();
    h.setRows([
      {
        id: "qa-id",
        display_name: "<img src=x onerror=alert(1)>",
        status: "active",
        onboarding_state: "completed",
        school_id: "school-qa",
      },
    ]);
    await h.fire("refreshAdminAccessBtn");
    expect(h.get("adminAccessBody").innerHTML).not.toContain("<img");
    expect(h.get("adminAccessBody").innerHTML).toContain("École créée");
    h.confirm.mockReturnValue(false);
    await h.action("revoke");
    expect(h.calls.filter((call) => call.method === "POST")).toHaveLength(0);
    expect(h.confirm).toHaveBeenCalledWith(
      "Révoquer définitivement cet accès ?\nL’historique sera conservé.",
    );
  });
});
