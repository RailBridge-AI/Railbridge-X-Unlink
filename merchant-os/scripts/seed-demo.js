import { initializeDatabase, seedDemoData } from "../src/db.js";
import { config } from "../src/config.js";

initializeDatabase();
seedDemoData();
console.log(`Seeded Merchant OS demo data in ${config.dbPath}`);
