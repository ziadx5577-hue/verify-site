import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const paths = {
  products: path.join(root, "data/products.json"),
  orders: path.join(root, "data/orders.json"),
  stats: path.join(root, "data/stats.json")
};

let queue = Promise.resolve();

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJson(file, value) {
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2));
  await fs.rename(temp, file);
}

export const getProducts = () => readJson(paths.products);
export const getStats = () => readJson(paths.stats);

export async function findOrder(orderId) {
  return (await readJson(paths.orders)).find((order) => order.id === orderId);
}

export function createOrder(data) {
  const id = `NS-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const confirmToken = crypto.randomBytes(24).toString("hex");

  const order = {
    id,
    confirmToken,
    productId: data.productId,
    productName: data.productName,
    price: data.price,
    paymentMethod: data.paymentMethod,
    discordId: data.discordId,
    discordUsername: data.discordUsername,
    status: "pending",
    createdAt: new Date().toISOString(),
    confirmedAt: null
  };

  queue = queue.then(async () => {
    const orders = await readJson(paths.orders);
    orders.push(order);
    await writeJson(paths.orders, orders);
  });

  return queue.then(() => order);
}

export function confirmOrder(orderId, token) {
  let confirmedOrder = null;

  queue = queue.then(async () => {
    const orders = await readJson(paths.orders);
    const order = orders.find((item) => item.id === orderId);

    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (order.confirmToken !== token) throw new Error("INVALID_CONFIRM_TOKEN");

    if (order.status !== "paid") {
      order.status = "paid";
      order.confirmedAt = new Date().toISOString();
      await writeJson(paths.orders, orders);

      const stats = await readJson(paths.stats);
      stats.purchaseCount = (stats.purchaseCount || 0) + 1;
      await writeJson(paths.stats, stats);
    }

    confirmedOrder = { ...order };
  });

  return queue.then(() => confirmedOrder);
}
