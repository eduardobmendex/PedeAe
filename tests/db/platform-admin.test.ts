import { describe, expect, it } from "vitest";
import { withRollback, type Db, type TestUser } from "./helpers";

async function makePlatformAdmin(db: Db, user: TestUser) {
  await db.asSuperuser();
  await db.query("insert into platform_admins (user_id) values ($1)", [user.id]);
}

describe("administrador da plataforma", () => {
  it("gerencia qualquer estabelecimento como admin, sem ser membro", () =>
    withRollback(async (db) => {
      const dono = await db.createUser("dono");
      const ana = await db.createUser("ana");
      const carla = await db.createUser("carla");
      await makePlatformAdmin(db, dono);
      const orgA = await db.createOrg(ana, "Pastelaria A");

      await db.as(dono);
      expect((await db.query<{ ok: boolean }>("select public.am_i_platform_admin() as ok"))[0].ok).toBe(true);

      const [cat] = await db.query<{ id: string }>(
        "insert into categories (organization_id, name) values ($1, 'Bebidas') returning id",
        [orgA],
      );
      await db.query("insert into products (organization_id, category_id, name, price_cents) values ($1, $2, 'Suco', 900)", [
        orgA,
        cat.id,
      ]);
      await db.query("update organization_settings set theme = 'dark' where organization_id = $1", [orgA]);
      const [{ token }] = await db.query<{ token: string }>("select public.create_invitation($1, $2, 'supervisor') as token", [
        orgA,
        carla.email,
      ]);
      expect(token).toHaveLength(48);

      // Alterar o papel da dona do estabelecimento também é permitido.
      const [m] = await db.query<{ id: string }>("select id from memberships where user_id = $1", [ana.id]);
      await db.query("select public.update_membership($1, 'supervisor', 'active')", [m.id]);

      // As ações ficam auditadas com o admin da plataforma como autor.
      const logs = await db.query<{ actor_user_id: string }>(
        "select actor_user_id from audit_logs where organization_id = $1 and action = 'products.insert'",
        [orgA],
      );
      expect(logs[0].actor_user_id).toBe(dono.id);
    }));

  it("cria estabelecimento, cadastra membros com senha e suspende", () =>
    withRollback(async (db) => {
      const dono = await db.createUser("dono");
      const existente = await db.createUser("existente");
      await makePlatformAdmin(db, dono);

      await db.as(dono);
      const [{ id: orgId }] = await db.query<{ id: string }>(
        "select public.platform_create_organization('Cliente Novo', 'cliente-novo-teste') as id",
      );
      // O admin da plataforma não vira membro.
      expect(await db.query("select 1 from memberships where organization_id = $1", [orgId])).toEqual([]);

      const email = `novo-${orgId.slice(0, 6)}@teste.pedeae.local`;
      const [{ r }] = await db.query<{ r: { user_id: string; created: boolean } }>(
        "select public.platform_create_member($1, $2, 'Novo Admin', 'senhaforte1', 'admin') as r",
        [orgId, email],
      );
      expect(r.created).toBe(true);

      // Conta existente: só vincula, sem trocar a senha.
      const [{ r: r2 }] = await db.query<{ r: { user_id: string; created: boolean } }>(
        "select public.platform_create_member($1, $2, '', '', 'staff') as r",
        [orgId, existente.email],
      );
      expect(r2).toEqual({ user_id: existente.id, created: false });

      expect(await db.expectError("select public.platform_create_member($1, 'x@y.com', '', '123', 'staff')", [orgId])).toMatch(
        /weak_password/,
      );

      await db.asSuperuser();
      const [user] = await db.query<{ ok: boolean; confirmed: boolean }>(
        `select encrypted_password = extensions.crypt('senhaforte1', encrypted_password) as ok,
                email_confirmed_at is not null as confirmed
         from auth.users where id = $1`,
        [r.user_id],
      );
      expect(user).toEqual({ ok: true, confirmed: true });
      expect(await db.query("select 1 from auth.identities where user_id = $1", [r.user_id])).toHaveLength(1);

      // O novo admin enxerga só o próprio estabelecimento.
      await db.as({ id: r.user_id, email });
      expect((await db.query<{ id: string }>("select id from organizations")).map((o) => o.id)).toEqual([orgId]);

      await db.as(dono);
      await db.query("select public.platform_set_organization_status($1, 'suspended')", [orgId]);
      await db.as(null);
      const [{ menu }] = await db.query<{ menu: unknown }>("select public.get_public_menu('cliente-novo-teste') as menu");
      expect(menu).toBeNull();
    }));

  it("usuários comuns não acessam as funções da plataforma", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const bruno = await db.createUser("bruno");
      const orgA = await db.createOrg(ana, "Pastelaria A");
      const orgB = await db.createOrg(bruno, "Hamburgueria B");

      await db.as(ana);
      expect((await db.query<{ ok: boolean }>("select public.am_i_platform_admin() as ok"))[0].ok).toBe(false);
      expect(await db.expectError("select public.platform_create_organization('X', 'xyz-teste')")).toMatch(/forbidden/);
      // Não existe mais caminho para um usuário comum criar estabelecimento.
      expect(await db.expectError("select public.create_organization('X', 'xyz-teste')")).toMatch(/does not exist/);
      expect(await db.expectError("select public.platform_set_organization_status($1, 'suspended')", [orgB])).toMatch(/forbidden/);
      expect(
        await db.expectError("select public.platform_create_member($1, 'x@y.com', '', 'senhaforte1', 'admin')", [orgA]),
      ).toMatch(/forbidden/);
      // E continuam isolados: Ana não vê a Hamburgueria B.
      expect(await db.query("select id from organizations where id = $1", [orgB])).toEqual([]);
    }));
});
