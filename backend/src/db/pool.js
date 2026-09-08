import mysql from "mysql2/promise";
import { config } from "../config.js";

const databaseUrl = new URL(config.databaseUrl);

export const pool = mysql.createPool({
	host: databaseUrl.hostname,
	port: Number(databaseUrl.port || 3306),
	user: decodeURIComponent(databaseUrl.username),
	password: decodeURIComponent(databaseUrl.password),
	database: databaseUrl.pathname.slice(1),
	waitForConnections: true,
	connectionLimit: 10,
	multipleStatements: true,
});
