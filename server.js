const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// CONEXIÓN DB
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'Pepe17',
  password: process.env.DB_PASSWORD || 'Giuseppe1704',
  database: process.env.DB_NAME || 'gestor_stock_3d',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

let pool;
async function initDatabase() {
  try {
    pool = mysql.createPool(dbConfig);
    console.log('✅ MySQL Conectado');
  } catch (error) {
    console.error('❌ Error MySQL:', error.message);
  }
}

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const [rows] = await pool.execute(
      'SELECT id, username, name, role FROM utilizadores WHERE username = ? AND password = ?',
      [username, password]
    );
    if (rows.length > 0) res.json({ success: true, user: rows[0] });
    else res.status(401).json({ success: false });
  } catch (e) { res.status(500).json({ success: false }); }
});

// ================= RUTAS CRUD =================

// 1. FILAMENTOS
app.post('/api/registos/filament', async (req, res) => {
  try {
    const d = req.body;
    const sql = `INSERT INTO filamentos (registo_id, barcode, name, material, color, weightPerUnit, pricePerUnit, minStock, supplier, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    await pool.execute(sql, [d.id||d.registo_id, d.barcode, d.name, d.material, d.color, d.weightPerUnit, d.pricePerUnit, d.minStock, d.supplier, d.timestamp]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// 2. PROVEEDORES
app.post('/api/registos/supplier', async (req, res) => {
  try {
    const d = req.body;
    const sql = `INSERT INTO fornecedores (registo_id, supplierName, supplierEmail, supplierPhone, supplierAddress, timestamp) VALUES (?, ?, ?, ?, ?, ?)`;
    await pool.execute(sql, [d.id||d.registo_id, d.supplierName, d.supplierEmail, d.supplierPhone, d.supplierAddress, d.timestamp]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// 3. PRODUCTOS
app.post('/api/registos/product', async (req, res) => {
  try {
    const d = req.body;
    const sql = `INSERT INTO produtos (registo_id, barcode, name, productCategory, stock, cost, salePrice, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    await pool.execute(sql, [d.id||d.registo_id, d.barcode, d.name, d.productCategory, d.stock, d.cost, d.salePrice, d.timestamp]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false }); }
});

// 4. COMPRAS (ENTRADAS)
app.post('/api/registos/purchase', async (req, res) => {
  try {
    const d = req.body;
    const sql = `INSERT INTO entradas (registo_id, filamentBarcode, quantityPurchased, purchaseDate, supplier, timestamp) VALUES (?, ?, ?, ?, ?, ?)`;
    await pool.execute(sql, [d.id||d.registo_id, d.filamentBarcode, d.quantityPurchased, d.purchaseDate, d.supplier, d.timestamp]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false }); }
});

// 5. VENTAS (SALES) - ¡Resta Stock Automático!
app.post('/api/registos/sale', async (req, res) => {
  try {
    const d = req.body;
    const qty = parseInt(d.quantitySold || 0);

    // Guardar venta
    const sqlVenta = `INSERT INTO ventas (registo_id, productBarcode, quantitySold, totalPrice, saleDate, timestamp) VALUES (?, ?, ?, ?, ?, ?)`;
    await pool.execute(sqlVenta, [d.id||d.registo_id, d.productBarcode, qty, d.totalPrice, d.saleDate, d.timestamp]);

    // Restar Stock del Producto
    const sqlStock = `UPDATE produtos SET stock = stock - ? WHERE barcode = ?`;
    await pool.execute(sqlStock, [qty, d.productBarcode]);

    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// 6. IMPRESIONES
app.post('/api/registos/print', async (req, res) => {
  try {
    const d = req.body;
    // Si envías JSON string desde el front, úsalo, si no, stringify
    const jsonStr = typeof d.filamentsUsed === 'string' ? d.filamentsUsed : JSON.stringify(d.filamentsUsed || []);
    
    const sql = `INSERT INTO impressoes (registo_id, printName, filamentsUsed, notes, timestamp) VALUES (?, ?, ?, ?, ?)`;
    await pool.execute(sql, [d.id||d.registo_id, d.printName, jsonStr, d.notes, d.timestamp]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false }); }
});

// 7. ELIMINAR (GENÉRICO)
app.delete('/api/registos/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    let table = '';
    
    // Mapear tipo a tabla
    if(type === 'filament') table = 'filamentos';
    else if(type === 'supplier') table = 'fornecedores';
    else if(type === 'product') table = 'produtos';
    else if(type === 'purchase') table = 'entradas';
    else if(type === 'print') table = 'impressoes';
    else if(type === 'sale') table = 'ventas';
    else return res.status(400).json({success:false});

    try {
        // Usamos registo_id como identificador principal
        await pool.execute(`DELETE FROM ${table} WHERE registo_id = ?`, [id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});


// GET TOTAL (DASHBOARD)
app.get('/api/registos', async (req, res) => {
  try {
    let all = [];
    
    const [fil] = await pool.execute('SELECT * FROM filamentos');
    all = all.concat(fil.map(x => ({ ...x, __backendId: x.registo_id, type: 'filament' })));

    const [sup] = await pool.execute('SELECT * FROM fornecedores');
    all = all.concat(sup.map(x => ({ ...x, __backendId: x.registo_id, type: 'supplier', name: x.supplierName })));

    const [prod] = await pool.execute('SELECT * FROM produtos');
    all = all.concat(prod.map(x => ({ ...x, __backendId: x.registo_id, type: 'product' })));

    const [purchases] = await pool.execute('SELECT * FROM entradas');
    all = all.concat(purchases.map(x => ({ ...x, __backendId: x.registo_id, type: 'purchase' })));

    const [prints] = await pool.execute('SELECT * FROM impressoes');
    all = all.concat(prints.map(x => ({ ...x, __backendId: x.registo_id, type: 'print' })));

    const [sales] = await pool.execute('SELECT * FROM ventas');
    all = all.concat(sales.map(x => ({ ...x, __backendId: x.registo_id, type: 'sale', totalPrice: parseFloat(x.totalPrice) })));

    res.json({ success: true, data: all });
  } catch (e) { 
    console.error(e);
    res.status(500).json({ success: false }); 
  }
});

async function start() {
  await initDatabase();
  app.listen(PORT, () => console.log(`🚀 Server en puerto ${PORT}`));
}
start();
