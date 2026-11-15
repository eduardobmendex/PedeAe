import { expect, login, sql, test } from "./fixtures";

// Uma noite de salão completa: esgotado, chamar garçom, cupom, pedir a conta,
// receber em dinheiro com troco, fechar a conta e imprimir o cupom.
test("salão: esgotado, chamado, cupom, conta com troco e cupom impresso", async ({ browser, shop }) => {
  test.setTimeout(240_000);
  await sql("insert into coupons (organization_id, code, kind, value, description) values ($1, 'E2E10', 'percent', 10, '10% de teste')", [shop.orgId]);

  // ---------- Equipe ----------
  const staffCtx = await browser.newContext();
  const staff = await staffCtx.newPage();
  await login(staff, shop.admin);
  await staff.goto(`/painel/${shop.slug}/cozinha`);
  await expect(staff.getByText("Ao vivo")).toBeVisible({ timeout: 30_000 });

  // Esgotado com um toque.
  await staff.getByText("Disponibilidade dos produtos").click();
  await staff.getByRole("switch", { name: "Suco E2E disponível" }).uncheck({ force: true });
  await expect(staff.getByText("1 esgotado(s)")).toBeVisible();

  // ---------- Cliente ----------
  const customerCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const customer = await customerCtx.newPage();
  await customer.goto(`/q/${shop.tableToken}`);
  await expect(customer.getByRole("button", { name: /Suco E2E/ })).toContainText("Esgotado");

  // Chamar garçom → aparece no painel → atendido.
  await customer.getByRole("button", { name: "Chamar garçom" }).click();
  await expect(customer.getByText("Garçom chamado!")).toBeVisible();
  const dock = staff.getByRole("complementary", { name: "Chamados das mesas" });
  await expect(dock.getByText("Mesa 9 chamou o garçom")).toBeVisible({ timeout: 30_000 });
  await dock.getByRole("button", { name: "Atendido" }).click();
  await expect(dock).toBeHidden();

  // Pedido com cupom: 25,00 − 10% = 22,50.
  await customer.getByRole("button", { name: /X-Teste/ }).click();
  await customer.getByRole("button", { name: "Adicionar" }).click();
  await customer.getByRole("button", { name: /Ver pedido/ }).click();
  await customer.getByLabel("Cupom de desconto").fill("e2e10");
  await customer.getByRole("button", { name: "Aplicar" }).click();
  await expect(customer.getByText("Desconto (E2E10)")).toBeVisible();
  await expect(customer.getByText("R$ 22,50")).toBeVisible();
  await customer.getByRole("button", { name: "Enviar pedido" }).click();
  await customer.waitForURL(/\/pedido\//);

  // Cozinha leva até entregue.
  const ticket = staff.locator("article", { hasText: "#1" });
  await expect(ticket).toBeVisible({ timeout: 30_000 });
  for (const step of ["Iniciar preparo", "Marcar pronto", "Entregue"]) {
    await staff.locator("article", { hasText: "#1" }).getByRole("button", { name: step }).click();
    if (step !== "Entregue") await expect(staff.locator("article", { hasText: "#1" }).getByRole("button", { name: step })).toBeHidden();
  }
  await expect(staff.locator("article", { hasText: "#1" })).toBeHidden();

  // Pedir a conta: o cliente vê o total; o painel recebe o aviso com atalho para a conta.
  await customer.goto(`/q/${shop.tableToken}`);
  await customer.getByRole("button", { name: "Pedir a conta" }).click();
  await expect(customer.getByText(/Total até agora: R\$\s22,50/)).toBeVisible();
  await expect(dock.getByText("Mesa 9 pediu a conta")).toBeVisible({ timeout: 30_000 });
  await dock.getByRole("link", { name: "Abrir a conta →" }).click();

  // Conta: 22,50 + 10% = 24,75. Cliente paga com 30,00 em dinheiro → troco 5,25.
  await expect(staff.getByRole("heading", { name: "Conta · Mesa 9" })).toBeVisible();
  await expect(staff.getByText("R$ 24,75").first()).toBeVisible();
  await staff.getByRole("radio", { name: "Dinheiro" }).click();
  await staff.getByLabel("Valor entregue pelo cliente (R$)").fill("30,00");
  await expect(staff.getByText("Troco: R$ 5,25")).toBeVisible();
  await staff.getByRole("button", { name: "Registrar pagamento" }).click();
  await expect(staff.getByText("Recebido R$ 24,75. Troco: R$ 5,25.")).toBeVisible();

  // O aviso pode ser minimizado para não cobrir a página.
  await dock.getByRole("button", { name: /1 chamado · minimizar/ }).click();
  await expect(dock.getByText("Mesa 9 pediu a conta")).toBeHidden();

  // Fechar a conta e imprimir o cupom.
  await staff.getByRole("button", { name: "Fechar conta e liberar a mesa" }).click();
  await expect(staff.getByText("Conta fechada. A mesa está livre.")).toBeVisible();
  const [receipt] = await Promise.all([staffCtx.waitForEvent("page"), staff.getByRole("link", { name: "Imprimir cupom" }).click()]);
  await receipt.waitForLoadState();
  await expect(receipt.getByText("CUPOM DA CONTA")).toBeVisible();
  await expect(receipt.getByText("Desconto E2E10")).toBeVisible();
  await expect(receipt.locator(".row", { hasText: "TOTAL" })).toContainText("24,75");

  // A mesa ficou livre e a conta aparece entre as fechadas hoje; o chamado de conta foi resolvido.
  await staff.goto(`/painel/${shop.slug}/contas`);
  await expect(staff.getByText("Nenhuma conta aberta")).toBeVisible();
  await expect(staff.getByText(/Fechadas hoje/)).toBeVisible();
  await expect(dock).toBeHidden();

  // Comanda da cozinha também imprime.
  const [{ id: orderId }] = await sql<{ id: string }>("select id from orders where organization_id = $1", [shop.orgId]);
  const kitchenTicket = await staffCtx.newPage();
  await kitchenTicket.goto(`/imprimir/${shop.slug}/pedido/${orderId}`);
  await expect(kitchenTicket.getByText("COMANDA DA COZINHA")).toBeVisible();
  await expect(kitchenTicket.getByText("1x X-Teste")).toBeVisible();

  await staffCtx.close();
  await customerCtx.close();
});
