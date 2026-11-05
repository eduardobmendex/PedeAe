import { describe, expect, it } from "vitest";
import { permissions, ruleFor } from "@/lib/permissions";
import { memberRoles } from "@/lib/validation";
import { withRollback } from "./helpers";

describe("matriz de permissões", () => {
  it("o espelho em TypeScript é idêntico à regra do banco", () =>
    withRollback(async (db) => {
      await db.asSuperuser();
      const rows = await db.query<{ role: string; permission: string; rule: string }>(
        `select r.role::text as role, p as permission, private.permission_rule(r.role, p) as rule
         from unnest(enum_range(null::public.member_role)) as r(role), unnest($1::text[]) as p`,
        [permissions],
      );
      expect(rows).toHaveLength(memberRoles.length * permissions.length);
      for (const row of rows) {
        expect([row.role, row.permission, row.rule]).toEqual([
          row.role,
          row.permission,
          ruleFor(row.role as (typeof memberRoles)[number], row.permission as (typeof permissions)[number]),
        ]);
      }
    }));

  it("permissões configuráveis seguem o padrão e os ajustes do admin", () =>
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

      const canDo = async (perm: string) =>
        (await db.query<{ ok: boolean }>("select private.can($1, $2) as ok", [orgA, perm]))[0].ok;

      expect(await canDo("view_orders")).toBe(true);
      expect(await canDo("close_tabs")).toBe(false);
      expect(await canDo("manage_menu")).toBe(false);

      await db.as(ana);
      const [m] = await db.query<{ id: string }>("select id from memberships where user_id = $1", [carla.id]);
      // manage_menu não é configurável para funcionário: deve ser descartado.
      await db.query("select public.set_membership_permissions($1, $2)", [
        m.id,
        JSON.stringify({ close_tabs: true, manage_menu: true }),
      ]);
      const [{ permissions: saved }] = await db.query<{ permissions: Record<string, boolean> }>(
        "select permissions from memberships where id = $1",
        [m.id],
      );
      expect(saved).toEqual({ close_tabs: true });

      await db.as(carla);
      expect(await canDo("close_tabs")).toBe(true);
      expect(await canDo("manage_menu")).toBe(false);
      expect(
        await db.expectError("select public.set_membership_permissions($1, '{}')", [m.id]),
      ).toMatch(/forbidden|cannot_change_own/);
    }));

  it("alterações de marca geram auditoria automaticamente", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const orgA = await db.createOrg(ana, "Pastelaria A");

      await db.as(ana);
      await db.query("update organization_settings set theme = 'dark', brand_color = '#000000' where organization_id = $1", [
        orgA,
      ]);
      const [log] = await db.query<{ action: string; metadata: Record<string, { to: unknown }> }>(
        "select action, metadata from audit_logs where organization_id = $1 and action = 'settings.updated'",
        [orgA],
      );
      expect(log.metadata.theme.to).toBe("dark");
      expect(log.metadata.brand_color.to).toBe("#000000");
    }));

  it("supervisor troca a identidade, mas não o resto da marca; funcionário não troca", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const sara = await db.createUser("sara");
      const carla = await db.createUser("carla");
      const bruno = await db.createUser("bruno");
      const orgA = await db.createOrg(ana, "Loja A");
      await db.createOrg(bruno, "Loja B");

      await db.as(await db.getPlatformAdmin());
      await db.query("select public.platform_create_member($1, $2, '', '', 'supervisor')", [orgA, sara.email]);
      await db.query("select public.platform_create_member($1, $2, '', '', 'staff')", [orgA, carla.email]);
      const theme = async () => {
        await db.asSuperuser();
        return (await db.query<{ theme: string }>("select theme from organization_settings where organization_id = $1", [orgA]))[0].theme;
      };
      const setTheme = "select public.set_organization_theme($1, $2)";

      await db.as(sara);
      await db.query(setTheme, [orgA, "dark"]);
      expect(await theme()).toBe("dark");
      await db.as(sara);
      expect(await db.query("update organization_settings set brand_color = '#000000' where organization_id = $1 returning 1", [orgA])).toEqual([]);

      await db.as(carla);
      expect(await db.expectError(setTheme, [orgA, "red"])).toMatch(/forbidden/);
      await db.as(bruno);
      expect(await db.expectError(setTheme, [orgA, "red"])).toMatch(/forbidden/);
      await db.as(null);
      expect(await db.expectError(setTheme, [orgA, "red"])).toMatch(/permission denied/);

      // Admin Geral altera o de qualquer estabelecimento; valor fora da lista é recusado.
      await db.as(await db.getPlatformAdmin());
      await db.query(setTheme, [orgA, "red"]);
      expect(await db.expectError(setTheme, [orgA, "azul"])).toMatch(/check constraint/);
      expect(await theme()).toBe("red");
    }));
});
