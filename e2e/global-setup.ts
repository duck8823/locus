import { execSync } from "node:child_process";

export default async function globalSetup() {
  execSync("npm run demo:data:reseed", {
    stdio: "inherit",
    env: process.env,
  });
}
