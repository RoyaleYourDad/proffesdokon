const fs = require('fs').promises;
const path = require('path');

const dbPath = path.join(__dirname, 'database.json');

const readDB = async () => {
    try {
        const data = await fs.readFile(dbPath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading database:', err);
        return { products: [], users: [], carts: [], reviews: [] };
    }
};

const writeDB = async (data) => {
    try {
        await fs.writeFile(dbPath, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Error writing database:', err);
    }
};

module.exports = { readDB, writeDB };