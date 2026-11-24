import { expect, sql, test } from "./fixtures";

// Tela de recebedores e KYC (Admin Geral) no simulador: iniciar KYC, compartilhar o link,
// aprovação e pagamento online liberado. Requer PAYMENTS_SIMULATOR=1 e nenhuma chave do Pagar.me no servidor.
test.skip(process.env.PAYMENTS_SIMULATOR !== "1", "recebedores: requer PAYMENTS_SIMULATOR=1");

test("admin geral inicia o KYC, compartilha o link e libera o pagamento online", async ({ page, shop }) => {
  test.setTimeout(120_000);
  await sql("insert into platform_admins (user_id) select id from auth.users where email = $1", [shop.admin.email]);

  await page.goto("/login");
  await page.getByLabel("E-mail").fill(shop.admin.email);
  await page.getByLabel("Senha", { exact: true }).fill(shop.admin.password);
  await page.locator("form button[type=submit]", { hasText: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Administração da plataforma" })).toBeVisible();

  await page.getByRole("link", { name: "Recebedores e KYC (Pagar.me)" }).click();
  await expect(page.getByRole("heading", { name: "Recebedores e KYC" })).toBeVisible();
  await expect(page.getByText(/Status consultado no Pagar.me às/)).toBeVisible({ timeout: 20_000 });

  const row = page.getByRole("listitem").filter({ hasText: shop.slug });
  await expect(row.getByText("Sem recebedor")).toBeVisible();
  await row.getByRole("link", { name: "Iniciar KYC" }).click();
  await expect(page.getByRole("heading", { name: "Lanchonete E2E" })).toBeVisible();

  // Pessoa jurídica (padrão)
  const f = (name: string, value: string) => page.locator(`#kyc-${name}`).fill(value);
  await f("company_name", "Lanchonete E2E Comércio LTDA");
  await f("trading_name", "Lanchonete E2E");
  await f("document", "11.222.333/0001-81");
  await f("annual_revenue", "300.000,00");
  await f("founding_date", "2018-05-10");
  await f("email", "contato@e2e.test");
  await f("phone", "(71) 99876-5432");
  await f("zip_code", "40140-110");
  await f("street", "Rua A");
  await f("street_number", "10");
  await f("neighborhood", "Barra");
  await f("city", "Salvador");
  await page.locator("#kyc-state").selectOption("BA");
  await page.locator("#kyc-partner_name").fill("Ana Souza");
  await page.locator("#kyc-partner_document").fill("529.982.247-25");
  await page.locator("#kyc-partner_email").fill("ana@e2e.test");
  await page.locator("#kyc-partner_phone").fill("(71) 99876-5432");
  await page.locator("#kyc-partner_birthdate").fill("1985-07-01");
  await page.locator("#kyc-partner_monthly_income").fill("8.000,00");
  await page.locator("#kyc-partner_occupation").fill("Empresária");
  await f("holder_name", "Lanchonete E2E");
  await f("bank", "341");
  await f("branch_number", "1234");
  await f("account_number", "56789");
  await f("account_check_digit", "0");

  // Erro do servidor não apaga o que foi digitado.
  await f("document", "11.222.333/0001-80");
  await page.getByRole("button", { name: "Iniciar KYC" }).click();
  await expect(page.getByText("CNPJ inválido")).toBeVisible();
  await expect(page.locator("#kyc-company_name")).toHaveValue("Lanchonete E2E Comércio LTDA");
  await f("document", "11.222.333/0001-81");
  await page.getByRole("button", { name: "Iniciar KYC" }).click();
  // Criado: o formulário dá lugar à situação no Pagar.me.
  await expect(page.getByText("Em credenciamento").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Aguardando documentos").first()).toBeVisible();
  await expect(page.locator("#iniciar-kyc")).toHaveCount(0);
  await expect(page.getByText(/Compartilhar o link de KYC/)).toBeVisible();

  // Liga antes da aprovação: fica esperando o KYC.
  await page.getByLabel("Aceitar pagamento online (Pix e cartão) no cardápio").check();
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByText(/começa a funcionar sozinho quando o KYC for aprovado/)).toBeVisible();

  // Compartilhar KYC: link, QR e opções de envio.
  await page.getByRole("button", { name: "Compartilhar KYC" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByAltText("QR Code do link de KYC")).toBeVisible();
  await expect(dialog.getByLabel("Link de KYC")).toHaveValue(/simulador\.pedeae\.local\/kyc\/re_sim/);
  await expect(dialog.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", /wa\.me/);
  await expect(dialog.getByText(/Vale por mais/)).toBeVisible();
  await dialog.getByRole("button", { name: "Fechar" }).click();

  // No simulador, o link conclui a prova de vida: a consulta seguinte traz "Aprovado".
  await page.getByRole("button", { name: "Atualizar status" }).click();
  await expect(page.getByText("Status atualizado.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Funcionando")).toBeVisible();

  const [s] = await sql<{ recipient_status: string; kyc_status: string; enabled: boolean }>(
    "select recipient_status, kyc_status, enabled from organization_payment_settings where organization_id = $1",
    [shop.orgId],
  );
  expect(s).toEqual({ recipient_status: "active", kyc_status: "approved", enabled: true });

  // O cardápio passa a oferecer o pagamento online.
  await page.goto(`/q/${shop.tableToken}`);
  await expect(page.getByRole("button", { name: "Pagar a conta pelo celular (Pix ou cartão)" })).toBeVisible();

  // Na lista: aprovado e recebendo.
  await page.goto("/painel/recebedores");
  const approved = page.getByRole("listitem").filter({ hasText: shop.slug });
  await expect(approved.getByText("Aprovado", { exact: true })).toBeVisible();
  await expect(approved.getByText("KYC aprovado", { exact: true })).toBeVisible();
  await expect(approved.getByText("Funcionando")).toBeVisible();
});
