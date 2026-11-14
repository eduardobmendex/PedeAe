import { expect, login, test } from "./fixtures";

// Fluxo completo de um pedido de mesa:
// QR Code → cardápio → carrinho → pedido → cozinha (tempo real) → pronto → cliente vê → relatório.
test("pedido pela mesa chega na cozinha ao vivo e o cliente acompanha até ficar pronto", async ({ browser, shop }) => {
  // ---------- Equipe: entra e abre a cozinha antes do pedido existir ----------
  const staffCtx = await browser.newContext();
  const kitchen = await staffCtx.newPage();
  await login(kitchen, shop.admin);
  await kitchen.goto(`/painel/${shop.slug}/cozinha`);
  // A primeira assinatura do Realtime para um estabelecimento novo pode levar alguns segundos.
  await expect(kitchen.getByText("Ao vivo")).toBeVisible({ timeout: 30_000 });
  await expect(kitchen.getByText("Nenhum pedido esperando.")).toBeVisible();

  // ---------- Cliente: escaneia o QR Code da mesa e faz o pedido ----------
  const customerCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const customer = await customerCtx.newPage();
  await customer.goto(`/q/${shop.tableToken}`);
  await expect(customer.getByText("Você está na Mesa 9")).toBeVisible();

  await customer.getByRole("button", { name: /X-Teste/ }).click();
  await customer.getByRole("button", { name: "Adicionar" }).click();
  await customer.getByRole("button", { name: /Ver pedido/ }).click();
  await customer.getByRole("button", { name: "Enviar pedido" }).click();

  await customer.waitForURL(/\/pedido\//);
  await expect(customer.getByText(/#1\b/).first()).toBeVisible();

  // ---------- Cozinha recebe sem recarregar ----------
  await expect(kitchen.getByText("Novo pedido #1")).toBeVisible();
  const ticket = kitchen.locator("article", { hasText: "#1" });
  await expect(ticket).toContainText("X-Teste");
  await expect(ticket).toContainText("Mesa 9");

  await ticket.getByRole("button", { name: "Iniciar preparo" }).click();
  await expect(kitchen.locator("section[aria-label='Em preparo'] article", { hasText: "#1" })).toBeVisible();
  await kitchen.locator("article", { hasText: "#1" }).getByRole("button", { name: "Marcar pronto" }).click();
  await expect(kitchen.locator("section[aria-label='Prontos'] article", { hasText: "#1" })).toBeVisible();

  // ---------- Cliente vê o pedido pronto (página de acompanhamento atualiza sozinha) ----------
  await expect(customer.getByText("Pronto", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // ---------- Entregue e contabilizado no relatório do dia ----------
  await kitchen.locator("article", { hasText: "#1" }).getByRole("button", { name: "Entregue" }).click();
  await expect(kitchen.getByText("Nenhum pedido aguardando entrega.")).toBeVisible();

  await kitchen.goto(`/painel/${shop.slug}/relatorios?periodo=hoje`);
  const revenue = kitchen.locator("div", { has: kitchen.getByText("Faturamento", { exact: true }) }).first();
  await expect(revenue).toContainText("25,00");
  await expect(kitchen.getByRole("cell", { name: "X-Teste" })).toBeVisible();

  await staffCtx.close();
  await customerCtx.close();
});

test("QR Code inválido mostra aviso em vez do cardápio", async ({ page }) => {
  await page.goto("/q/codigo-que-nao-existe");
  await expect(page.getByRole("heading", { name: "QR Code inválido" })).toBeVisible();
});
