import { testDatabase } from "./fixture.js";

// The real agent and adapters use the app's default database module, so it must point at the
// validated test database before they load. testDatabase() rejects anything but a local throwaway.
export const database = testDatabase();
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
