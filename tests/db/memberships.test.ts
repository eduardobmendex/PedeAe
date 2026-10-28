import { describe, expect, it } from "vitest";
import { withRollback } from "./helpers";

describe("papéis, convites e auditoria", () => {
  it("quem cria o estabelecimento vira admin e a criação é auditada", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const orgA = await db.createOrg(ana, "Pastelaria A");

      await db.as(ana);
      const [m] = await db.query<{ role: string; status: string }>(
        "select role, status from memberships where organization_id = $1",
        [orgA],
      );
      expect(m).toEqual({ role: "admin", status: "active" });

      const logs = await db.query<{ action: string }>("select action from audit_logs where organization_id = $1", [orgA]);
      expect(logs.map((l) => l.action)).toContain("organization.created");
    }));

  it("funcionário não cria convites, não altera membros nem edita a organização", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const carla = await db.createUser("carla");
      const orgA = await db.createOrg(ana, "Pastelaria A");

      await db.as(ana);
      const [{ token }] = await db.query<{ token: string }>(
        "select public.create_invitation($1, $2, 'staff') as token",
        [orgA, carla.email],
      );
      const [anaMembership] = await db.query<{ id: string }>(
        "select id from memberships where user_id = $1",
        [ana.id],
      );

      await db.as(carla);
      await db.query("select public.accept_invitation($1)", [token]);

      expect(await db.expectError("select public.create_invitation($1, 'x@y.com', 'admin')", [orgA])).toMatch(/forbidden/);
      expect(await db.expectError("select public.update_membership($1, 'staff', 'disabled')", [anaMembership.id])).toMatch(
        /forbidden/,
      );
      expect(await db.query("update organizations set name = 'Hack' where id = $1 returning id", [orgA])).toEqual([]);
      // Funcionário não enxerga a lista da equipe nem a auditoria.
      expect(await db.query("select user_id from memberships where organization_id = $1", [orgA])).toHaveLength(1);
      expect(await db.query("select id from audit_logs where organization_id = $1", [orgA])).toEqual([]);
    }));

  it("convite só pode ser aceito pelo e-mail convidado e apenas uma vez", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const carla = await db.createUser("carla");
      const intruso = await db.createUser("intruso");
      const orgA = await db.createOrg(ana, "Pastelaria A");

      await db.as(ana);
      const [{ token }] = await db.query<{ token: string }>(
        "select public.create_invitation($1, $2, 'supervisor') as token",
        [orgA, carla.email],
      );
      // O token em si nunca é armazenado, apenas o hash.
      const stored = await db.query("select 1 from invitations where token_hash = $1", [token]);
      expect(stored).toEqual([]);

      await db.as(intruso);
      expect(await db.expectError("select public.accept_invitation($1)", [token])).toMatch(/invitation_email_mismatch/);

      await db.as(carla);
      await db.query("select public.accept_invitation($1)", [token]);
      expect(await db.expectError("select public.accept_invitation($1)", [token])).toMatch(/invitation_invalid/);

      const [m] = await db.query<{ role: string }>("select role from memberships where user_id = $1", [carla.id]);
      expect(m.role).toBe("supervisor");
    }));

  it("convite revogado não pode ser aceito", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const carla = await db.createUser("carla");
      const orgA = await db.createOrg(ana, "Pastelaria A");

      await db.as(ana);
      const [{ token }] = await db.query<{ token: string }>(
        "select public.create_invitation($1, $2, 'staff') as token",
        [orgA, carla.email],
      );
      const [inv] = await db.query<{ id: string }>("select id from invitations where organization_id = $1", [orgA]);
      await db.query("select public.revoke_invitation($1)", [inv.id]);

      await db.as(carla);
      expect(await db.expectError("select public.accept_invitation($1)", [token])).toMatch(/invitation_invalid/);
    }));

  it("admin não pode alterar o próprio vínculo", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      await db.createOrg(ana, "Pastelaria A");

      await db.as(ana);
      const [m] = await db.query<{ id: string }>("select id from memberships where user_id = $1", [ana.id]);
      expect(await db.expectError("select public.update_membership($1, 'staff', 'active')", [m.id])).toMatch(
        /cannot_change_own_membership/,
      );
    }));

  it("slug de estabelecimento é único e validado", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      await db.as(ana);
      await db.query("select public.create_organization('Pastel do Zé', 'pastel-do-ze-teste')");
      expect(await db.expectError("select public.create_organization('Outro', 'pastel-do-ze-teste')")).toMatch(
        /duplicate key/,
      );
      expect(await db.expectError("select public.create_organization('Outro', 'Inválido!')")).toMatch(/check constraint/);
    }));
});
