import { addDays, isoDate, isoTimestamp, Random, round2 } from "./prng";
import type { BuiltinDataset, CellValue, GeneratedTable } from "./types";

const SEED = 20241001;
export const ECOMMERCE_START = new Date(Date.UTC(2024, 9, 1)); // 2024-10-01
const DAYS = 730; // two full years: 2024-10-01 .. 2026-09-30

const REGIONS = {
  "North America": { weight: 38, countries: ["United States", "Canada", "Mexico"] },
  Europe: { weight: 30, countries: ["United Kingdom", "Germany", "France", "Netherlands", "Spain"] },
  "Asia Pacific": { weight: 22, countries: ["India", "Australia", "Japan", "Singapore"] },
  "Latin America": { weight: 10, countries: ["Brazil", "Argentina", "Chile", "Colombia"] },
} as const;
type Region = keyof typeof REGIONS;
const REGION_NAMES = Object.keys(REGIONS) as Region[];

const FIRST_NAMES = [
  "Aarav",
  "Olivia",
  "Liam",
  "Emma",
  "Noah",
  "Ava",
  "Mateo",
  "Sophia",
  "Lucas",
  "Isabella",
  "Ethan",
  "Mia",
  "Arjun",
  "Amelia",
  "Hiro",
  "Chloe",
  "Leo",
  "Zara",
  "Daniel",
  "Priya",
  "Gabriel",
  "Hannah",
  "Omar",
  "Elena",
  "Kenji",
  "Sara",
  "Felix",
  "Nora",
  "Diego",
  "Ananya",
  "Jonas",
  "Lucia",
  "Ravi",
  "Grace",
  "Tomás",
  "Ines",
  "Samuel",
  "Yuki",
  "Max",
  "Aisha",
];
const LAST_NAMES = [
  "Sharma",
  "Smith",
  "Garcia",
  "Müller",
  "Martin",
  "Tanaka",
  "Silva",
  "Brown",
  "Kumar",
  "Rossi",
  "Johnson",
  "Dubois",
  "Lopez",
  "Wilson",
  "Nguyen",
  "Patel",
  "Schmidt",
  "Taylor",
  "Costa",
  "Kim",
  "Anderson",
  "Fernandez",
  "Ito",
  "Clarke",
  "Mehta",
  "Novak",
  "Hughes",
  "Reyes",
  "Sato",
  "Fischer",
];

const SEGMENTS = ["Consumer", "Small Business", "Corporate"] as const;
const SEGMENT_WEIGHTS = [72, 20, 8];
const ACQUISITION = ["Organic Search", "Paid Social", "Email", "Referral", "Direct"] as const;
const ACQUISITION_WEIGHTS = [30, 24, 14, 12, 20];

interface CategorySpec {
  name: string;
  items: string[];
  brands: string[];
  price: [number, number];
  /** Relative demand per calendar month (Jan..Dec). */
  season: number[];
}

const CATEGORIES: CategorySpec[] = [
  {
    name: "Electronics",
    items: [
      "Wireless Earbuds",
      "Bluetooth Speaker",
      "4K Webcam",
      "Mechanical Keyboard",
      "Smartwatch",
      "USB-C Hub",
      "Noise-Cancelling Headphones",
      "Portable SSD",
    ],
    brands: ["Volta", "Nimbus", "Arcwave"],
    price: [29, 349],
    season: [0.8, 0.8, 0.9, 0.9, 0.9, 1, 1.1, 1, 1, 1.1, 1.6, 2],
  },
  {
    name: "Home & Kitchen",
    items: [
      "Pour-Over Coffee Set",
      "Cast Iron Skillet",
      "Linen Duvet Cover",
      "Air Purifier",
      "Chef's Knife",
      "Ceramic Planter",
      "Stand Mixer",
    ],
    brands: ["Hearth & Co", "Kinfolk", "Oakline"],
    price: [18, 289],
    season: [0.9, 0.9, 1, 1.1, 1.1, 1, 0.9, 0.9, 1, 1.1, 1.4, 1.6],
  },
  {
    name: "Apparel",
    items: [
      "Merino Crew Sweater",
      "Rain Shell Jacket",
      "Organic Cotton Tee",
      "Chino Pants",
      "Puffer Vest",
      "Linen Shirt",
      "Wool Beanie",
    ],
    brands: ["Northbound", "Common Thread", "Fieldday"],
    price: [16, 189],
    season: [1.1, 0.9, 1, 1.1, 1.1, 1.2, 1.1, 1, 1.1, 1.2, 1.4, 1.5],
  },
  {
    name: "Sports & Outdoors",
    items: [
      "Trail Running Shoes",
      "Yoga Mat",
      "Insulated Bottle",
      "Camping Hammock",
      "Resistance Bands",
      "Daypack 24L",
      "Cycling Gloves",
    ],
    brands: ["Summit", "Pacer", "Wildroot"],
    price: [14, 179],
    season: [1.3, 1, 1.1, 1.2, 1.4, 1.5, 1.5, 1.3, 1, 0.9, 1, 1.1],
  },
  {
    name: "Beauty",
    items: ["Vitamin C Serum", "Mineral Sunscreen", "Hydrating Cleanser", "Hair Repair Oil", "Clay Mask"],
    brands: ["Lumen", "Petal & Pine"],
    price: [12, 68],
    season: [1, 1.1, 1, 1, 1.1, 1.2, 1.2, 1.1, 1, 1, 1.2, 1.4],
  },
  {
    name: "Books",
    items: ["Data Storytelling Guide", "Modern Cookbook", "Sci-Fi Anthology", "Travel Atlas", "Mindful Habits"],
    brands: ["Paperlane", "Inkwell Press"],
    price: [11, 45],
    season: [1.2, 1, 0.9, 0.9, 0.9, 1, 1.1, 1.1, 1.2, 1, 1.2, 1.5],
  },
];

/** Relative order volume per calendar month (Jan..Dec). */
const MONTH_SEASONALITY = [0.82, 0.86, 0.95, 0.97, 1.0, 1.02, 1.12, 1.0, 0.96, 1.04, 1.45, 1.68];
/** Relative order volume per weekday (Sun..Sat). */
const WEEKDAY_FACTOR = [1.16, 0.93, 0.95, 0.97, 1.0, 1.06, 1.18];

export function generateEcommerce(): GeneratedTable[] {
  const rng = new Random(SEED);

  // --- products -----------------------------------------------------------
  const products: CellValue[][] = [];
  const productMeta: { id: number; categoryIndex: number; price: number; popularity: number }[] = [];
  CATEGORIES.forEach((category, categoryIndex) => {
    for (const item of category.items) {
      const variants = rng.int(1, 2);
      for (let v = 0; v < variants; v++) {
        const id = products.length + 1;
        const brand = category.brands[(v + item.length) % category.brands.length] ?? category.brands[0]!;
        const name = variants > 1 && v === 1 ? `${brand} ${item} Pro` : `${brand} ${item}`;
        const base = rng.float(category.price[0], category.price[1]);
        const price = Math.floor(v === 1 ? base * 1.35 : base) + 0.99;
        const cost = round2(price * rng.float(0.42, 0.66));
        const launched = isoDate(addDays(ECOMMERCE_START, -rng.int(30, 900)));
        products.push([id, name, category.name, brand, round2(price), cost, launched]);
        productMeta.push({ id, categoryIndex, price: round2(price), popularity: rng.float(0.4, 1.6) });
      }
    }
  });

  // --- customers ----------------------------------------------------------
  const CUSTOMER_COUNT = 1600;
  const customers: CellValue[][] = [];
  const customerMeta: { id: number; signupDay: number; region: Region; loyalty: number }[] = [];
  for (let i = 0; i < CUSTOMER_COUNT; i++) {
    const id = i + 1;
    // 25% joined before the window; the rest join with a gentle growth curve.
    const signupDay = rng.bool(0.25) ? -rng.int(1, 540) : Math.floor(Math.pow(rng.next(), 0.8) * (DAYS - 10));
    const region = rng.weighted(
      REGION_NAMES,
      REGION_NAMES.map((r) => REGIONS[r].weight),
    );
    const country = rng.pick(REGIONS[region].countries);
    const first = rng.pick(FIRST_NAMES);
    const last = rng.pick(LAST_NAMES);
    const email =
      `${first}.${last}${id}`
        .toLowerCase()
        .normalize("NFD")
        .replace(/[^a-z0-9.]/g, "") + "@example.com";
    customers.push([
      id,
      first,
      last,
      email,
      region,
      country,
      rng.weighted(SEGMENTS, SEGMENT_WEIGHTS),
      rng.weighted(ACQUISITION, ACQUISITION_WEIGHTS),
      isoDate(addDays(ECOMMERCE_START, signupDay)),
    ]);
    // A long tail of loyal customers places most repeat orders.
    customerMeta.push({ id, signupDay, region, loyalty: Math.pow(rng.next(), 3) * 6 + 0.3 });
  }
  customerMeta.sort((a, b) => a.signupDay - b.signupDay);

  // --- orders & order_items -----------------------------------------------
  const orders: CellValue[][] = [];
  const orderItems: CellValue[][] = [];
  const BASE_ORDERS_PER_DAY = 7.4;
  let poolEnd = 0;

  for (let day = 0; day < DAYS; day++) {
    const date = addDays(ECOMMERCE_START, day);
    const month = date.getUTCMonth();
    while (poolEnd < customerMeta.length && customerMeta[poolEnd]!.signupDay <= day) poolEnd++;
    if (poolEnd === 0) continue;

    const growth = 1 + 0.42 * (day / DAYS);
    const lambda =
      BASE_ORDERS_PER_DAY * growth * (MONTH_SEASONALITY[month] ?? 1) * (WEEKDAY_FACTOR[date.getUTCDay()] ?? 1);
    const count = rng.poisson(lambda);

    for (let o = 0; o < count; o++) {
      // Loyal customers are more likely to order again.
      let customer = customerMeta[rng.int(0, poolEnd - 1)]!;
      const challenger = customerMeta[rng.int(0, poolEnd - 1)]!;
      if (challenger.loyalty > customer.loyalty) customer = challenger;

      const orderId = orders.length + 1;
      const timestamp = new Date(date.getTime() + rng.int(7 * 3600, 23 * 3600 + 3599) * 1000);
      const daysAgo = DAYS - day;
      let status: string;
      if (daysAgo <= 3) status = rng.bool(0.7) ? "processing" : "shipped";
      else if (daysAgo <= 8) status = rng.bool(0.6) ? "shipped" : "delivered";
      else status = rng.weighted(["delivered", "returned", "cancelled"], [90, 6, 4]);

      const mobileShare = 0.3 + 0.16 * (day / DAYS);
      const channel = rng.weighted(["web", "mobile_app", "marketplace"], [0.9 - mobileShare, mobileShare, 0.1]);
      const isPromo =
        month === 10 || month === 11 || (month === 6 && date.getUTCDate() >= 10 && date.getUTCDate() <= 16);

      const lines = Math.min(5, 1 + rng.poisson(0.8));
      let subtotal = 0;
      const used = new Set<number>();
      for (let l = 0; l < lines; l++) {
        const product = pickProduct(rng, productMeta, month, customer.region);
        if (used.has(product.id)) continue;
        used.add(product.id);
        const quantity = rng.weighted([1, 2, 3, 4], [74, 18, 6, 2]);
        // Prices rose ~4% at the start of 2026.
        const unitPrice = date.getUTCFullYear() >= 2026 ? round2(product.price * 1.04) : product.price;
        const discountPct = isPromo
          ? rng.weighted([0, 10, 15, 20, 25], [25, 20, 25, 20, 10])
          : rng.weighted([0, 5, 10, 15], [76, 10, 10, 4]);
        subtotal += quantity * unitPrice * (1 - discountPct / 100);
        orderItems.push([orderItems.length + 1, orderId, product.id, quantity, unitPrice, discountPct]);
      }
      const shipping = subtotal >= 75 ? 0 : 5.99;
      orders.push([orderId, customer.id, isoTimestamp(timestamp), status, channel, shipping]);
    }
  }

  return [
    {
      name: "customers",
      description: "One row per registered customer.",
      columns: [
        { name: "customer_id", type: "integer", primaryKey: true },
        { name: "first_name", type: "text" },
        { name: "last_name", type: "text" },
        { name: "email", type: "text" },
        { name: "region", type: "text", description: "North America, Europe, Asia Pacific or Latin America" },
        { name: "country", type: "text" },
        { name: "segment", type: "text", description: "Consumer, Small Business or Corporate" },
        { name: "acquisition_channel", type: "text", description: "Marketing channel that brought the customer in" },
        { name: "signup_date", type: "date" },
      ],
      rows: customers,
    },
    {
      name: "products",
      description: "Product catalog with list price and unit cost.",
      columns: [
        { name: "product_id", type: "integer", primaryKey: true },
        { name: "name", type: "text" },
        { name: "category", type: "text" },
        { name: "brand", type: "text" },
        { name: "list_price", type: "numeric", description: "Current list price in USD" },
        { name: "unit_cost", type: "numeric", description: "Cost of goods per unit in USD" },
        { name: "launched_on", type: "date" },
      ],
      rows: products,
    },
    {
      name: "orders",
      description: "One row per order (header). Order revenue lives in order_items.",
      columns: [
        { name: "order_id", type: "integer", primaryKey: true },
        { name: "customer_id", type: "integer", references: "customers.customer_id" },
        { name: "ordered_at", type: "timestamp", description: "UTC timestamp the order was placed" },
        { name: "status", type: "text", description: "delivered, shipped, processing, returned or cancelled" },
        { name: "channel", type: "text", description: "web, mobile_app or marketplace" },
        { name: "shipping_fee", type: "numeric", description: "Shipping charged in USD (free over $75)" },
      ],
      rows: orders,
    },
    {
      name: "order_items",
      description:
        "Order line items. Line revenue = quantity * unit_price * (1 - discount_pct / 100). Exclude cancelled/returned orders for net revenue.",
      columns: [
        { name: "order_item_id", type: "integer", primaryKey: true },
        { name: "order_id", type: "integer", references: "orders.order_id" },
        { name: "product_id", type: "integer", references: "products.product_id" },
        { name: "quantity", type: "integer" },
        { name: "unit_price", type: "numeric", description: "Price charged per unit before discount, USD" },
        { name: "discount_pct", type: "integer", description: "Percentage discount applied to the line (0-25)" },
      ],
      rows: orderItems,
    },
  ];
}

function pickProduct(
  rng: Random,
  products: { id: number; categoryIndex: number; price: number; popularity: number }[],
  month: number,
  region: Region,
) {
  const categoryWeights = CATEGORIES.map((c, i) => {
    let weight = c.season[month] ?? 1;
    if (region === "Asia Pacific" && c.name === "Electronics") weight *= 1.3;
    if (region === "Europe" && c.name === "Apparel") weight *= 1.2;
    if (region === "Latin America" && c.name === "Sports & Outdoors") weight *= 1.25;
    return weight * (i === 0 ? 1.25 : 1);
  });
  const categoryIndex = rng.weighted(
    CATEGORIES.map((_, i) => i),
    categoryWeights,
  );
  const candidates = products.filter((p) => p.categoryIndex === categoryIndex);
  // Cheaper products sell more units.
  return rng.weighted(
    candidates,
    candidates.map((p) => p.popularity / Math.sqrt(p.price)),
  );
}

export const ecommerceDataset: BuiltinDataset = {
  id: "ecommerce",
  name: "Northwind Goods",
  tagline: "E-commerce · 2 years of orders",
  description:
    "An online retailer selling electronics, home goods, apparel and more across four regions, with seasonality, promotions and a growing mobile channel.",
  suggestions: [
    "How has monthly revenue trended over the last two years?",
    "Which product categories drive the most revenue in each region?",
    "What share of orders come from repeat customers?",
    "Which acquisition channel brings the highest-value customers?",
  ],
  generate: generateEcommerce,
};
