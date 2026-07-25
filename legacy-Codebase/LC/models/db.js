import mysql from 'mysql';
import { HOST, DB, PASSWORD, USER, DBPORT } from '../config/index.js'

const connection = mysql.createConnection({
    host: HOST,
    user: USER,
    password: PASSWORD,
    database: DB,
    port: DBPORT
});

connection.connect(error => {
    if (error) throw error;
    console.log("Successfully connected to the database.");
});

export default connection;