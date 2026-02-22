import { resetDatabase } from "../src/db.js";
import { config } from "../src/config.js";

resetDatabase();
console.log(`Reset Merchant OS database at ${config.dbPath}`);
