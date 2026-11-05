// Catálogo base do PedeAe — v1 (2026-10).
// Fonte única dos modelos de cardápio. Preços são VALORES BASE FIXOS
// (estimativa de mercado para a Bahia), usados só como ponto de partida
// na importação; o estabelecimento edita livremente depois.
//
// Para alterar o catálogo: edite este arquivo, aumente CATALOG_VERSION e gere
// uma nova migration com `node scripts/build-catalog-migration.mjs`.
// Chaves (`key`) são permanentes: nunca renomeie uma chave já publicada.

export const CATALOG_VERSION = 6;

export const establishmentTypes = [
  { id: "pizzaria", name: "Pizzaria", description: "Pizzas por tamanho e sabor, bebidas e sobremesas." },
  { id: "bar", name: "Bar e boteco", description: "Cervejas, drinks, petiscos, porções e espetinhos." },
  { id: "hamburgueria", name: "Hamburgueria", description: "Hambúrgueres tradicionais e artesanais, combos e porções." },
  { id: "pastelaria", name: "Pastelaria e lanchonete", description: "Pastéis, salgados, sanduíches, sucos e açaí." },
  { id: "regional", name: "Restaurante e comida baiana", description: "Pratos regionais, moquecas, caldos e acompanhamentos." },
];

/** Ordem das categorias no cardápio importado. */
export const categoryOrder = [
  "Pizzas",
  "Hambúrgueres",
  "Hambúrgueres artesanais",
  "Combos",
  "Pastéis",
  "Salgados",
  "Sanduíches",
  "Pratos baianos",
  "Acompanhamentos",
  "Porções e petiscos",
  "Espetinhos",
  "Cervejas",
  "Drinks",
  "Vinhos",
  "Refrigerantes e águas",
  "Sucos",
  "Sobremesas",
];

const c = (reais) => Math.round(reais * 100);
const ALL = ["pizzaria", "bar", "hamburgueria", "pastelaria", "regional"];

// ---------------------------------------------------------------- Bebidas

const beers = [
  ["skol-lata-350", "Skol lata 350 ml", 7],
  ["brahma-lata-350", "Brahma lata 350 ml", 7],
  ["itaipava-lata-350", "Itaipava lata 350 ml", 6],
  ["heineken-lata-350", "Heineken lata 350 ml", 10],
  ["heineken-ln-330", "Heineken long neck 330 ml", 12],
  ["stella-ln-330", "Stella Artois long neck 330 ml", 11],
  ["budweiser-ln-330", "Budweiser long neck 330 ml", 10],
  ["spaten-ln-355", "Spaten long neck 355 ml", 10],
  ["corona-ln-330", "Corona long neck 330 ml", 13],
  ["skol-600", "Skol garrafa 600 ml", 13],
  ["brahma-600", "Brahma garrafa 600 ml", 13],
  ["itaipava-600", "Itaipava garrafa 600 ml", 11],
  ["original-600", "Antarctica Original garrafa 600 ml", 15],
  ["heineken-600", "Heineken garrafa 600 ml", 18],
].map(([key, name, price]) => ({
  key: `cerveja-${key}`,
  types: ["bar", "pizzaria", "hamburgueria", "regional"],
  category: "Cervejas",
  name,
  description: "Bem gelada.",
  price: c(price),
}));

const softDrinks = [
  ["coca-lata", "Coca-Cola lata 350 ml", 6],
  ["coca-zero-lata", "Coca-Cola Zero lata 350 ml", 6],
  ["guarana-lata", "Guaraná Antarctica lata 350 ml", 5.5],
  ["fanta-lata", "Fanta Laranja lata 350 ml", 5.5],
  ["sprite-lata", "Sprite lata 350 ml", 5.5],
  ["coca-1l", "Coca-Cola 1 litro", 10],
  ["coca-2l", "Coca-Cola 2 litros", 14],
  ["guarana-2l", "Guaraná Antarctica 2 litros", 12],
  ["agua-500", "Água mineral 500 ml", 4],
  ["agua-gas-500", "Água mineral com gás 500 ml", 5],
  ["agua-coco", "Água de coco 300 ml", 7],
].map(([key, name, price]) => ({
  key: `bebida-${key}`,
  types: ALL,
  category: "Refrigerantes e águas",
  name,
  description: "",
  price: c(price),
}));

const juice = {
  key: "suco-natural-400",
  types: ["pastelaria", "regional", "hamburgueria", "pizzaria"],
  category: "Sucos",
  name: "Suco natural 400 ml",
  description: "Feito na hora com a fruta.",
  price: c(9),
  options: [
    {
      name: "Sabor",
      min: 1,
      max: 1,
      items: ["Laranja", "Maracujá", "Cajá", "Acerola", "Umbu", "Graviola", "Caju"].map((name) => ({ name, price: 0 })),
    },
    { name: "Preparo", min: 1, max: 1, items: [{ name: "Com açúcar" }, { name: "Sem açúcar" }, { name: "Com adoçante" }] },
  ],
};

const drinks = [
  {
    key: "drink-caipirinha",
    types: ["bar", "regional"],
    category: "Drinks",
    name: "Caipirinha",
    description: "Preparada na hora.",
    price: c(18),
    options: [
      { name: "Fruta", min: 1, max: 1, items: ["Limão", "Maracujá", "Caju", "Morango"].map((name) => ({ name })) },
      {
        name: "Bebida",
        min: 1,
        max: 1,
        items: [{ name: "Cachaça" }, { name: "Vodka", price: c(4) }, { name: "Saquê", price: c(5) }],
      },
    ],
  },
  { key: "drink-dose-cachaca", types: ["bar"], category: "Drinks", name: "Dose de cachaça", description: "", price: c(6) },
];

const wines = [
  { key: "vinho-taca-tinto", name: "Vinho tinto (taça)", description: "Taça de 180 ml.", price: c(18) },
  { key: "vinho-garrafa-tinto-seco", name: "Vinho tinto seco (garrafa 750 ml)", description: "", price: c(69) },
  { key: "vinho-garrafa-tinto-suave", name: "Vinho tinto suave (garrafa 750 ml)", description: "", price: c(55) },
].map((w) => ({ ...w, types: ["pizzaria", "regional"], category: "Vinhos" }));

// ---------------------------------------------------------------- Pizzas
// Cada tamanho é um produto; o sabor é cobrado pelo MAIS CARO escolhido.

const flavors = [
  // nome, descrição, [média, grande, família]
  ["Mussarela", "Molho de tomate, mussarela e orégano", [42, 52, 68]],
  ["Calabresa", "Calabresa fatiada, cebola e azeitona", [44, 54, 70]],
  ["Margherita", "Mussarela, tomate e manjericão", [46, 56, 72]],
  ["Portuguesa", "Presunto, ovo, cebola, ervilha e mussarela", [48, 58, 76]],
  ["Frango com catupiry", "Frango desfiado e catupiry", [48, 58, 76]],
  ["Baiana", "Calabresa moída apimentada, cebola e pimenta", [48, 58, 76]],
  ["Quatro queijos", "Mussarela, provolone, parmesão e catupiry", [52, 62, 82]],
  ["Carne do sol com catupiry", "Carne do sol desfiada, cebola roxa e catupiry", [56, 68, 88]],
  ["Camarão", "Camarão refogado, catupiry e mussarela", [62, 76, 98]],
  ["Chocolate", "Chocolate ao leite e granulado", [46, 56, 72]],
  ["Banana com canela", "Banana, açúcar, canela e leite condensado", [44, 54, 70]],
];

const crusts = [
  ["Catupiry", [8, 10, 12]],
  ["Cheddar", [8, 10, 12]],
  ["Chocolate", [10, 12, 14]],
];

const pizzaSizes = [
  { id: "media", name: "Pizza média", description: "6 fatias · até 2 sabores", maxFlavors: 2 },
  { id: "grande", name: "Pizza grande", description: "8 fatias · até 2 sabores", maxFlavors: 2 },
  { id: "familia", name: "Pizza família", description: "12 fatias · até 3 sabores", maxFlavors: 3 },
];

const pizzas = pizzaSizes.map((size, i) => ({
  key: `pizza-${size.id}`,
  types: ["pizzaria"],
  category: "Pizzas",
  name: size.name,
  description: `${size.description}. Com mais de um sabor, vale o preço do sabor mais caro.`,
  price: 0,
  featured: size.id === "grande",
  options: [
    {
      name: "Sabores",
      min: 1,
      max: size.maxFlavors,
      rule: "max",
      items: flavors.map(([name, , prices]) => ({ name, price: c(prices[i]) })),
    },
    { name: "Borda recheada", min: 0, max: 1, items: crusts.map(([name, prices]) => ({ name, price: c(prices[i]) })) },
  ],
}));

// ---------------------------------------------------------------- Hambúrgueres

const burgerExtras = {
  name: "Adicionais",
  min: 0,
  max: 5,
  items: [
    { name: "Bacon", price: c(5) },
    { name: "Cheddar", price: c(4) },
    { name: "Ovo", price: c(3) },
    { name: "Cebola caramelizada", price: c(4) },
    { name: "Catupiry", price: c(4) },
  ],
};

const classicBurgers = [
  ["x-burger", "X-Burger", "Pão, hambúrguer, queijo e molho da casa", 18],
  ["x-salada", "X-Salada", "Pão, hambúrguer, queijo, alface, tomate e maionese", 20],
  ["x-egg", "X-Egg", "Pão, hambúrguer, queijo, ovo e salada", 22],
  ["x-bacon", "X-Bacon", "Pão, hambúrguer, queijo, bacon e salada", 25],
  ["x-tudo", "X-Tudo", "Hambúrguer, queijo, presunto, bacon, ovo, calabresa e salada", 30],
].map(([key, name, description, price]) => ({
  key: `burger-${key}`,
  types: ["hamburgueria", "pastelaria", "bar"],
  category: "Hambúrgueres",
  name,
  description,
  price: c(price),
  options: [burgerExtras],
}));

const doneness = {
  name: "Ponto da carne",
  min: 1,
  max: 1,
  items: [{ name: "Ao ponto" }, { name: "Mal passado" }, { name: "Bem passado" }],
};
const extraPatty = { name: "Carne extra", min: 0, max: 2, items: [{ name: "Blend 150 g", price: c(10) }] };

const craftBurgers = [
  ["classico", "Clássico", "Pão brioche, blend 180 g, queijo prato, alface, tomate e molho especial", 32, true],
  ["cheddar-bacon", "Cheddar & Bacon", "Pão brioche, blend 180 g, cheddar cremoso e bacon crocante", 36, false],
  ["smash-duplo", "Smash duplo", "Pão brioche, 2 smash de 90 g, queijo americano e picles", 34, false],
  ["costela", "Costela BBQ", "Blend de costela 180 g, queijo coalho, cebola caramelizada e barbecue", 38, false],
  ["frango-crispy", "Frango crispy", "Sobrecoxa empanada, alface, tomate e maionese temperada", 30, false],
  ["veggie", "Veggie", "Hambúrguer de grão-de-bico, queijo, rúcula e tomate", 30, false],
].map(([key, name, description, price, featured]) => ({
  key: `burger-artesanal-${key}`,
  types: ["hamburgueria"],
  category: "Hambúrgueres artesanais",
  name,
  description,
  price: c(price),
  featured,
  options: key === "frango-crispy" || key === "veggie" ? [burgerExtras] : [doneness, extraPatty, burgerExtras],
}));

const comboDrink = {
  name: "Bebida",
  min: 1,
  max: 1,
  items: ["Coca-Cola lata", "Coca-Cola Zero lata", "Guaraná lata", "Fanta lata", "Água mineral"].map((name) => ({ name })),
};

const combos = [
  ["classico", "Combo Clássico", "Hambúrguer Clássico + batata frita individual + bebida", 45],
  ["smash", "Combo Smash", "Smash duplo + batata frita individual + bebida", 47],
  ["x-tudo", "Combo X-Tudo", "X-Tudo + batata frita individual + bebida", 40],
].map(([key, name, description, price]) => ({
  key: `combo-${key}`,
  types: ["hamburgueria"],
  category: "Combos",
  name,
  description,
  price: c(price),
  options: [comboDrink],
}));

// ---------------------------------------------------------------- Porções e espetinhos

const halfOrFull = (half, full) => ({
  name: "Tamanho",
  min: 1,
  max: 1,
  items: [
    { name: "Meia porção", price: 0 },
    { name: "Porção inteira", price: c(full - half) },
  ],
});

const portions = [
  ["batata-frita", "Batata frita", "Batata crocante com sal", 22, 35, ["bar", "hamburgueria", "pizzaria", "regional"]],
  ["batata-cheddar-bacon", "Batata com cheddar e bacon", "", 28, 42, ["bar", "hamburgueria"]],
  ["aipim-frito", "Aipim frito", "Aipim cozido e frito na hora", 20, 32, ["bar", "regional"]],
  ["calabresa-acebolada", "Calabresa acebolada", "Acompanha farofa e pão", 30, 45, ["bar", "regional"]],
  ["frango-passarinho", "Frango a passarinho", "Frango temperado e frito com alho", 35, 55, ["bar", "regional"]],
  ["isca-peixe", "Isca de peixe", "Acompanha molho tártaro", 38, 58, ["bar", "regional"]],
  ["carne-do-sol-acebolada", "Carne do sol acebolada", "Acompanha aipim e manteiga de garrafa", 45, 70, ["bar", "regional"]],
].map(([key, name, description, half, full, types]) => ({
  key: `porcao-${key}`,
  types,
  category: "Porções e petiscos",
  name,
  description,
  price: c(half),
  options: [halfOrFull(half, full)],
}));

const singlePortions = [
  ["queijo-coalho", "Queijo coalho na brasa", "6 espetos com melaço", 25, ["bar", "regional"]],
  ["amendoim", "Amendoim torrado", "", 8, ["bar"]],
  ["batata-individual", "Batata frita individual", "Porção para uma pessoa", 12, ["hamburgueria", "pastelaria"]],
].map(([key, name, description, price, types]) => ({
  key: `porcao-${key}`,
  types,
  category: "Porções e petiscos",
  name,
  description,
  price: c(price),
}));

const skewers = [
  ["carne", "Espetinho de carne", 10],
  ["frango", "Espetinho de frango", 9],
  ["queijo-coalho", "Espetinho de queijo coalho", 9],
  ["linguica", "Espetinho de linguiça", 9],
  ["coracao", "Espetinho de coração", 9],
  ["misto", "Espetinho misto", 11],
].map(([key, name, price]) => ({
  key: `espetinho-${key}`,
  types: ["bar", "regional"],
  category: "Espetinhos",
  name,
  description: "Acompanha farofa e vinagrete.",
  price: c(price),
}));

// ---------------------------------------------------------------- Pastelaria

const pastryExtras = {
  name: "Adicionais",
  min: 0,
  max: 3,
  items: [
    { name: "Catupiry", price: c(3) },
    { name: "Cheddar", price: c(3) },
    { name: "Bacon", price: c(4) },
  ],
};

const pastries = [
  ["carne", "Pastel de carne", "Carne moída temperada", 10],
  ["queijo", "Pastel de queijo", "Mussarela", 10],
  ["frango", "Pastel de frango", "Frango desfiado temperado", 10],
  ["pizza", "Pastel de pizza", "Presunto, mussarela, tomate e orégano", 11],
  ["frango-catupiry", "Pastel de frango com catupiry", "", 12],
  ["carne-do-sol", "Pastel de carne do sol com queijo coalho", "", 14],
  ["camarao", "Pastel de camarão", "Camarão refogado com catupiry", 16],
  ["banana", "Pastel de banana com canela", "", 10],
].map(([key, name, description, price]) => ({
  key: `pastel-${key}`,
  types: ["pastelaria"],
  category: "Pastéis",
  name,
  description,
  price: c(price),
  featured: key === "carne",
  options: key === "banana" ? undefined : [pastryExtras],
}));

const snacks = [
  ["coxinha", "Coxinha de frango", 7],
  ["kibe", "Kibe", 7],
  ["enroladinho", "Enroladinho de salsicha", 6],
  ["esfirra", "Esfirra de carne", 6],
  ["empada", "Empada de frango", 7],
  ["pao-queijo", "Pão de queijo (porção com 6)", 8],
].map(([key, name, price]) => ({
  key: `salgado-${key}`,
  types: ["pastelaria"],
  category: "Salgados",
  name,
  description: "",
  price: c(price),
}));

const sandwiches = [
  ["misto", "Misto quente", "Pão de forma, presunto e queijo na chapa", 10],
  ["americano", "Americano", "Presunto, queijo, ovo, alface e tomate", 14],
  ["bauru", "Bauru", "Pão francês, rosbife, queijo e tomate", 16],
].map(([key, name, description, price]) => ({
  key: `sanduiche-${key}`,
  types: ["pastelaria"],
  category: "Sanduíches",
  name,
  description,
  price: c(price),
}));

// ---------------------------------------------------------------- Comida baiana

const regional = [
  {
    key: "regional-acaraje",
    name: "Acarajé",
    description: "Bolinho de feijão-fradinho frito no dendê, com vatapá, caruru, salada e camarão seco",
    price: c(15),
    featured: true,
    types: ["regional", "bar"],
    options: [
      { name: "Pimenta", min: 1, max: 1, items: [{ name: "Sem pimenta" }, { name: "Pouca pimenta" }, { name: "Com pimenta" }] },
      { name: "Temperatura", min: 1, max: 1, items: [{ name: "Quente" }, { name: "Frio" }] },
    ],
  },
  { key: "regional-abara", name: "Abará", description: "Massa de feijão-fradinho cozida na folha de bananeira, com vatapá e camarão", price: c(13), types: ["regional"] },
  {
    key: "regional-moqueca-peixe",
    name: "Moqueca de peixe",
    description: "Serve 2 pessoas. Acompanha arroz, pirão e farofa de dendê",
    price: c(120),
    featured: true,
    types: ["regional"],
  },
  { key: "regional-moqueca-camarao", name: "Moqueca de camarão", description: "Serve 2 pessoas. Acompanha arroz, pirão e farofa de dendê", price: c(150), types: ["regional"] },
  { key: "regional-moqueca-mista", name: "Moqueca mista (peixe e camarão)", description: "Serve 2 pessoas. Acompanha arroz, pirão e farofa", price: c(140), types: ["regional"] },
  { key: "regional-bobo-camarao", name: "Bobó de camarão", description: "Serve 2 pessoas. Acompanha arroz", price: c(130), types: ["regional"] },
  { key: "regional-carne-do-sol", name: "Carne do sol com aipim", description: "Acompanha manteiga de garrafa, arroz e vinagrete", price: c(75), types: ["regional"] },
  { key: "regional-feijoada", name: "Feijoada (individual)", description: "Acompanha arroz, couve, farofa e laranja", price: c(45), types: ["regional"] },
  { key: "regional-escondidinho", name: "Escondidinho de carne do sol", description: "Purê de aipim gratinado com carne do sol", price: c(38), types: ["regional", "bar"] },
  { key: "regional-caldo-sururu", name: "Caldo de sururu", description: "", price: c(18), types: ["regional", "bar"] },
  { key: "regional-caldo-feijao", name: "Caldo de feijão", description: "Com bacon e cheiro-verde", price: c(12), types: ["regional", "bar"] },
  { key: "regional-prato-executivo", name: "Prato executivo do dia", description: "Arroz, feijão, salada e proteína do dia", price: c(28), types: ["regional"] },
].map((item) => ({ ...item, category: "Pratos baianos" }));

const sides = [
  ["arroz", "Arroz branco", 10],
  ["pirao", "Pirão", 8],
  ["farofa-dende", "Farofa de dendê", 8],
  ["vinagrete", "Vinagrete", 6],
  ["feijao-tropeiro", "Feijão tropeiro", 14],
].map(([key, name, price]) => ({
  key: `acompanhamento-${key}`,
  types: ["regional"],
  category: "Acompanhamentos",
  name,
  description: "",
  price: c(price),
}));

// ---------------------------------------------------------------- Sobremesas

const desserts = [
  { key: "sobremesa-cocada", name: "Cocada", description: "Cocada branca ou queimada", price: c(6), types: ["regional", "pastelaria", "bar"] },
  { key: "sobremesa-pudim", name: "Pudim de leite", description: "Fatia", price: c(10), types: ["regional", "pastelaria", "pizzaria", "hamburgueria"] },
  { key: "sobremesa-brownie", name: "Brownie com sorvete", description: "Brownie de chocolate com bola de sorvete de creme", price: c(18), types: ["hamburgueria", "pizzaria"] },
  {
    key: "sobremesa-acai-300",
    name: "Açaí 300 ml",
    description: "",
    price: c(16),
    types: ["pastelaria", "hamburgueria"],
    options: [
      {
        name: "Complementos",
        min: 0,
        max: 4,
        items: [
          { name: "Granola", price: c(2) },
          { name: "Leite condensado", price: c(2) },
          { name: "Banana", price: c(2) },
          { name: "Paçoca", price: c(2) },
          { name: "Leite em pó", price: c(2) },
        ],
      },
    ],
  },
].map((item) => ({ ...item, category: "Sobremesas" }));

export const catalogItems = [
  ...pizzas,
  ...classicBurgers,
  ...craftBurgers,
  ...combos,
  ...pastries,
  ...snacks,
  ...sandwiches,
  ...regional,
  ...sides,
  ...portions,
  ...singlePortions,
  ...skewers,
  ...beers,
  ...drinks,
  ...wines,
  ...softDrinks,
  juice,
  ...desserts,
];
