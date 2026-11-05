import { describe, expect, it } from "vitest";
import { withRollback, type Db } from "./helpers";

type Context = {
  organization: { id: string; slug: string };
  membership: { id: string; role: string } | null;
  is_platform_admin: boolean;
} | null;

const contextOf = async (db: Db, slug: string) =>
  (await db.query<{ c: Context }>("select public.get_org_context($1) as c", [slug]))[0].c;

describe("get_org_context", () => {
  it("só devolve o estabelecimento a quem tem acesso", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const bruno = await db.createUser("bruno");
      const orgA = await db.createOrg(ana, "Loja A");
      await db.createOrg(bruno, "Loja B");

      await db.as(ana);
      const [{ slug }] = await db.query<{ slug: string }>("select slug from organizations where id = $1", [orgA]);
      const own = await contextOf(db, slug);
      expect(own?.organization.id).toBe(orgA);
      expect(own?.membership?.role).toBe("admin");
      expect(own?.is_platform_admin).toBe(false);

      await db.as(bruno);
      expect(await contextOf(db, slug)).toBeNull();

      await db.as(null);
      expect(await db.expectError("select public.get_org_context($1)", [slug])).toMatch(/permission denied/);
    }));

  it("membro desativado perde o acesso; admin da plataforma entra sem vínculo", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const carla = await db.createUser("carla");
      const orgA = await db.createOrg(ana, "Loja A");
      const dono = await db.getPlatformAdmin();

      await db.as(dono);
      const [{ slug }] = await db.query<{ slug: string }>("select slug from organizations where id = $1", [orgA]);
      await db.query("select public.platform_create_member($1, $2, '', '', 'staff')", [orgA, carla.email]);
      const platform = await contextOf(db, slug);
      expect(platform?.membership).toBeNull();
      expect(platform?.is_platform_admin).toBe(true);

      const [m] = await db.query<{ id: string }>("select id from memberships where user_id = $1", [carla.id]);
      await db.as(carla);
      expect((await contextOf(db, slug))?.membership?.role).toBe("staff");

      await db.as(dono);
      await db.query("select public.update_membership($1, 'staff', 'disabled')", [m.id]);
      await db.as(carla);
      expect(await contextOf(db, slug)).toBeNull();
    }));
});
