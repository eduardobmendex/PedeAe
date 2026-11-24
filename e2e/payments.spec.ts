import { expect, sql, test } from "./fixtures";

// Pagamento online no modo simulador (sem dinheiro real): pedido pago antes e conta paga pelo celular.
// Requer SUPABASE_SECRET_KEY e PAYMENTS_SIMULATOR=1 no servidor (o CI usa o Supabase local).
test.skip(!process.env.SUPABASE_SECRET_KEY || process.env.PAYMENTS_SIMULATOR !== "1", "pagamentos: requer SUPABASE_SECRET_KEY e PAYMENTS_SIMULATOR=1");

const PAYER = { name: "Ana Souza", email: "ana@exemplo.com", cpf: "529.982.247-25", phone: "(71) 99876-5432" };

async function fillPayer(page: import("@playwright/test").Page) {
  await page.getByLabel("Nome completo").fill(PAYER.name);
  await page.getByLabel("E-mail").fill(PAYER.email);
  await page.getByLabel("CPF").fill(PAYER.cpf);
  await page.getByLabel("Celular com DDD").fill(PAYER.phone);
}

test("pedido pago antes (Pix) vai para a cozinha; conta paga com cartão entra na mesa", async ({ browser, shop }) => {
  test.setTimeout(180_000);
  await sql("insert into organization_payment_settings (organization_id, enabled, pagarme_recipient_id, recipient_status) values ($1, true, 're_e2eteste', 'active')", [shop.orgId]);

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  // ---------- Pedido pago antes, com Pix ----------
  await page.goto(`/q/${shop.tableToken}`);
  await page.getByRole("button", { name: /X-Teste/ }).click();
  await page.getByRole("button", { name: "Adicionar" }).click();
  await page.getByRole("button", { name: /Ver pedido/ }).click();
  await page.getByText("Pagar agora", { exact: true }).click();
  await page.getByRole("button", { name: "Ir para o pagamento" }).click();
  await page.waitForURL(/\/pagar\//);

  await expect(page.getByText("R$ 25,00")).toBeVisible();
  const [{ status: before }] = await sql<{ status: string }>("select status from orders where organization_id = $1", [shop.orgId]);
  expect(before).toBe("awaiting_payment"); // ainda não foi para a cozinha

  await fillPayer(page);
  await page.getByRole("button", { name: "Gerar Pix" }).click();
  await expect(page.getByRole("button", { name: /Copiar código Pix/ })).toBeVisible();
  await expect(page.getByAltText("QR Code do Pix")).toBeVisible();
  await page.getByRole("button", { name: "Simular pagamento (modo de teste)" }).click();
  await expect(page.getByText("Pagamento confirmado!")).toBeVisible();
  await page.waitForURL(/\/pedido\//, { timeout: 15_000 });

  const [order] = await sql<{ status: string; payment_status: string }>("select status, payment_status from orders where organization_id = $1", [shop.orgId]);
  expect(order).toEqual({ status: "received", payment_status: "paid" });

  // ---------- Novo pedido no fim, e a conta paga pelo celular com cartão ----------
  await page.goto(`/q/${shop.tableToken}`);
  await page.getByRole("button", { name: /Suco E2E/ }).click();
  await page.getByRole("button", { name: "Adicionar" }).click();
  await page.getByRole("button", { name: /Ver pedido/ }).click();
  await page.getByRole("button", { name: "Enviar pedido" }).click();
  await page.waitForURL(/\/pedido\//);

  await page.goto(`/q/${shop.tableToken}`);
  await page.getByRole("button", { name: "Pagar a conta pelo celular (Pix ou cartão)" }).click();
  await page.getByLabel("Incluir 10% de serviço (opcional)").uncheck();
  await page.getByRole("button", { name: "Ir para o pagamento" }).click();
  await page.waitForURL(/\/pagar\//);
  // Falta só o suco (9,00): o pedido antecipado já entrou pago na conta.
  await expect(page.getByText("R$ 9,00")).toBeVisible();

  await fillPayer(page);
  await page.getByRole("tab", { name: "Cartão de crédito" }).click();
  await page.getByLabel("Número do cartão").fill("4111 1111 1111 1111");
  await page.getByLabel("Nome impresso no cartão").fill("ANA SOUZA");
  await page.getByLabel("Validade (MM/AA)").fill("12/30");
  await page.getByLabel("CVV").fill("123");
  await page.getByLabel("CEP").fill("40140-110");
  await page.getByLabel("Rua").fill("Rua A");
  await page.getByLabel("Número", { exact: true }).fill("10");
  await page.getByLabel("Bairro").fill("Barra");
  await page.getByLabel("Cidade").fill("Salvador");
  await page.getByLabel("UF").fill("BA");
  await page.getByRole("button", { name: "Pagar com cartão" }).click();
  await expect(page.getByText("Pagamento confirmado!")).toBeVisible();

  const pays = await sql<{ method: string; amount_cents: string; online: boolean }>(
    "select method, amount_cents, payment_intent_id is not null as online from tab_payments where organization_id = $1 order by created_at",
    [shop.orgId],
  );
  expect(pays).toEqual([
    { method: "pix", amount_cents: "2500", online: true },
    { method: "credito", amount_cents: "900", online: true },
  ]);
  await ctx.close();
});
