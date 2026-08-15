const base = "http://127.0.0.1:8788";

async function register(name: string) {
  const response = await fetch(`${base}/v1/apps`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

console.log("Wallet A:");
console.log(await register("Wallet A"));

console.log("\nWallet B:");
console.log(await register("Wallet B"));
