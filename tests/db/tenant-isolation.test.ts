import { describe, expect, it } from "vitest";
import { withRollback } from "./helpers";

describe("isolamento multi-tenant", () => {
  it("membros de um estabelecimento não veem dados de outro", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const bruno = await db.createUser("bruno");
      const orgA = await db.createOrg(ana, "Pastelaria A");
      const orgB = await db.createOrg(bruno, "Hamburgueria B");

      await db.as(ana);
      const orgs = await db.query<{ id: string }>("select id from organizations");
      expect(orgs.map((o) => o.id)).toEqual([orgA]);

      expect(await db.query("select * from organization_settings where organization_id = $1", [orgB])).toEqual([]);
      expect(await db.query("select * from memberships where organization_id = $1", [orgB])).toEqual([]);
      expect(await db.query("select * from audit_logs where organization_id = $1", [orgB])).toEqual([]);
      expect(await db.query("select * from profiles where id = $1", [bruno.id])).toEqual([]);

      // Update em linha de outra organização simplesmente não afeta nada.
      const updated = await db.query("update organizations set name = 'Invadido' where id = $1 returning id", [orgB]);
      expect(updated).toEqual([]);
    }));

  it("visitante anônimo não acessa nenhuma tabela interna", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      await db.createOrg(ana, "Pastelaria A");

      await db.as(null);
      for (const table of ["organizations", "organization_settings", "memberships", "profiles", "invitations", "audit_logs"]) {
        expect(await db.expectError(`select * from ${table}`)).toMatch(/permission denied/);
      }
      expect(await db.expectError("select public.create_organization('X', 'xyz')")).toMatch(/permission denied/);
    }));

  it("usuário não consegue se inserir como membro de outra organização", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const bruno = await db.createUser("bruno");
      const orgB = await db.createOrg(bruno, "Hamburgueria B");

      await db.as(ana);
      expect(
        await db.expectError(
          "insert into memberships (organization_id, user_id, role) values ($1, $2, 'admin')",
          [orgB, ana.id],
        ),
      ).toMatch(/permission denied/);
      expect(await db.expectError("insert into organizations (name, slug) values ('X', 'xxx')")).toMatch(
        /permission denied/,
      );
    }));

  it("membro desativado perde o acesso imediatamente", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const carla = await db.createUser("carla");
      const orgA = await db.createOrg(ana, "Pastelaria A");

      await db.as(ana);
      const [{ token }] = await db.query<{ token: string }>(
        "select public.create_invitation($1, $2, 'staff') as token",
        [orgA, carla.email],
      );

      await db.as(carla);
      await db.query("select public.accept_invitation($1)", [token]);
      expect(await db.query("select id from organizations")).toHaveLength(1);

      await db.as(ana);
      const [m] = await db.query<{ id: string }>(
        "select id from memberships where organization_id = $1 and user_id = $2",
        [orgA, carla.id],
      );
      await db.query("select public.update_membership($1, 'staff', 'disabled')", [m.id]);

      await db.as(carla);
      expect(await db.query("select id from organizations")).toEqual([]);
    }));
});
