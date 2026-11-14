import { Client } from "pg";
import { randomUUID } from "node:crypto";

export type TestUser = { id: string; email: string };

/**
 * Executa `fn` dentro de uma transação que sempre sofre ROLLBACK.
 * Nada criado nos testes permanece no banco.
 */
export async function withRollback(fn: (db: Db) => Promise<void>) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida (.env)");

  // Supabase local (CI) não usa SSL; o projeto na nuvem exige.
  const local = /@(127.0.0.1|localhost)[:/]/.test(url);
  const client = new Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("begin");
    await fn(new Db(client));
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
}

export class Db {
  private savepoint = 0;
  private platformAdmin?: TestUser;

  constructor(private client: Client) {}

  /** Cria um usuário em auth.users (o trigger cria o profile). */
  async createUser(label: string): Promise<TestUser> {
    await this.asSuperuser();
    const id = randomUUID();
    const email = `${label}-${id.slice(0, 8)}@teste.pedeae.local`;
    await this.client.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '',
         now(), '{}', $3, now(), now())`,
      [id, email, JSON.stringify({ name: label })],
    );
    return { id, email };
  }

  async asSuperuser() {
    await this.client.query("reset role");
    await this.client.query("select set_config('request.jwt.claims', '', true)");
  }

  /** Passa a agir como o usuário (role authenticated) ou como visitante anônimo (null). */
  async as(user: TestUser | null) {
    await this.client.query("reset role");
    const claims = user
      ? { sub: user.id, email: user.email, role: "authenticated" }
      : { role: "anon" };
    await this.client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await this.client.query(`set local role ${user ? "authenticated" : "anon"}`);
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.client.query(sql, params);
    return res.rows as T[];
  }

  /**
   * Executa a consulta esperando erro; usa savepoint para a transação continuar válida.
   * Retorna a mensagem do erro (ou lança se não houve erro).
   */
  async expectError(sql: string, params: unknown[] = []): Promise<string> {
    const sp = `sp_${++this.savepoint}`;
    await this.client.query(`savepoint ${sp}`);
    try {
      await this.client.query(sql, params);
    } catch (e) {
      await this.client.query(`rollback to savepoint ${sp}`);
      return (e as Error).message;
    }
    await this.client.query(`release savepoint ${sp}`);
    throw new Error(`Era esperado erro em: ${sql}`);
  }

  /** Admin da plataforma do teste (criado uma vez por transação). */
  async getPlatformAdmin(): Promise<TestUser> {
    if (!this.platformAdmin) {
      this.platformAdmin = await this.createUser("plataforma");
      await this.query("insert into platform_admins (user_id) values ($1)", [this.platformAdmin.id]);
    }
    return this.platformAdmin;
  }

  /** O admin da plataforma cria a organização e vincula `owner` como admin; termina agindo como `owner`. */
  async createOrg(owner: TestUser, name: string): Promise<string> {
    await this.as(await this.getPlatformAdmin());
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID().slice(0, 6)}`;
    const [row] = await this.query<{ id: string }>("select public.platform_create_organization($1, $2) as id", [name, slug]);
    await this.query("select public.platform_create_member($1, $2, '', '', 'admin')", [row.id, owner.email]);
    await this.as(owner);
    return row.id;
  }
}
