const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// ==================== CONFIGURACIÓN ====================
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Configuración de conexión MySQL (Render / Clever Cloud / Local)
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
    console.log('✅ Conexão com MySQL estabelecida com sucesso');
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
  } catch (error) {
    console.error('❌ Erro ao conectar ao MySQL:', error.message);
  }
}

// ==================== AUTENTICACIÓN ====================
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const [rows] = await pool.execute(
      'SELECT id, username, name, role FROM utilizadores WHERE username = ? AND password = ?',
      [username, password]
    );
    if (rows.length > 0) {
      res.json({ success: true, user: rows[0] });
    } else {
      res.status(401).json({ success: false, message: 'Credenciais inválidas' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false });
  }
});

// ==================== RUTAS MANUALES (CRUD) ====================
// Usamos rutas específicas para evitar errores de nombres de columnas

// 1. REGISTRAR FORNECEDOR (PROVEEDOR)
app.post('/api/registos/supplier', async (req, res) => {
  try {
    const { id, registo_id, supplierName, name, supplierEmail, email, supplierPhone, phone, supplierAddress, address, timestamp } = req.body;
    
    // Normalización de datos
    const finalID = id || registo_id; 
    const finalName = supplierName || name; 
    const finalEmail = supplierEmail || email;
    const finalPhone = supplierPhone || phone;
    const finalAddress = supplierAddress || address;

    const sql = `INSERT INTO fornecedores (registo_id, supplierName, supplierEmail, supplierPhone, supplierAddress, timestamp) VALUES (?, ?, ?, ?, ?, ?)`;
    const [result] = await pool.execute(sql, [finalID, finalName, finalEmail, finalPhone, finalAddress, timestamp]);
    res.json({ success: true, backendId: result.insertId });
  } catch (error) {
    console.error('Error supplier:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. REGISTRAR FILAMENTO
app.post('/api/registos/filament', async (req, res) => {
  try {
    const data = req.body;
    const sql = `INSERT INTO filamentos 
      (registo_id, barcode, name, material, color, weightPerUnit, pricePerUnit, minStock, supplier, timestamp) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const weight = parseFloat(data.weightPerUnit || data.weight_per_unit || 0);
    const price = parseFloat(data.pricePerUnit || data.price_per_unit || 0);
    const stock = parseFloat(data.minStock || data.min_stock || 0);

    await pool.execute(sql, [
      data.id || data.registo_id, data.barcode, data.name, data.material, data.color, weight, price, stock, data.supplier, data.timestamp
    ]);
    res.json({ success: true, message: 'Filamento criado' });
  } catch (error) {
    console.error('Error filament:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. REGISTRAR PRODUCTO (Venta)
app.post('/api/registos/product', async (req, res) => {
  try {
    const data = req.body;
    const sql = `INSERT INTO produtos (registo_id, barcode, name, productCategory, stock, cost, salePrice, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    await pool.execute(sql, [
      data.id || data.registo_id, data.barcode, data.name, data.productCategory, data.stock, data.cost, data.salePrice, data.timestamp
    ]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error producto:', error);
    res.status(500).json({ success: false });
  }
});

// 4. REGISTRAR ENTRADA (COMPRA) - ¡AQUÍ ESTABA EL ERROR 404!
app.post('/api/registos/purchase', async (req, res) => {
  try {
    const data = req.body;
    const sql = `INSERT INTO entradas (registo_id, filamentBarcode, quantityPurchased, purchaseDate, supplier, timestamp) VALUES (?, ?, ?, ?, ?, ?)`;
    
    const qty = parseFloat(data.quantityPurchased || 0);

    await pool.execute(sql, [
      data.id || data.registo_id, data.filamentBarcode, qty, data.purchaseDate, data.supplier, data.timestamp
    ]);
    res.json({ success: true, message: 'Entrada registrada' });
  } catch (error) {
    console.error('Error purchase:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 5. REGISTRAR IMPRESSÃO (PRINT)
app.post('/api/registos/print', async (req, res) => {
  try {
    const data = req.body;
    // Convertimos el array de filamentos a JSON string para guardar en TEXT
    const filamentsString = JSON.stringify(data.filamentsUsed || []);

    const sql = `INSERT INTO impressoes (registo_id, printName, filamentsUsed, notes, timestamp) VALUES (?, ?, ?, ?, ?)`;

    await pool.execute(sql, [
      data.id || data.registo_id, data.printName, filamentsString, data.notes, data.timestamp
    ]);
    res.json({ success: true, message: 'Impressão registrada' });
  } catch (error) {
    console.error('Error print:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== LISTAR TODO (GET) PARA EL DASHBOARD ====================
app.get('/api/registos', async (req, res) => {
  try {
    let allRecords = [];

    // 1. Filamentos
    const [filaments] = await pool.execute('SELECT * FROM filamentos');
    allRecords = allRecords.concat(filaments.map(f => ({
      ...f, 
      id: f.registo_id, 
      type: 'filament',
      weightPerUnit: parseFloat(f.weightPerUnit), 
      pricePerUnit: parseFloat(f.pricePerUnit),
      minStock: parseFloat(f.minStock)
    })));

    // 2. Proveedores
    const [suppliers] = await pool.execute('SELECT * FROM fornecedores');
    allRecords = allRecords.concat(suppliers.map(s => ({
      ...s,
      id: s.registo_id,
      type: 'supplier',
      supplierName: s.supplierName, 
      name: s.supplierName 
    })));

    // 3. Productos
    const [products] = await pool.execute('SELECT * FROM produtos');
    allRecords = allRecords.concat(products.map(p => ({
      ...p,
      id: p.registo_id,
      type: 'product'
    })));

    // 4. Entradas
    const [purchases] = await pool.execute('SELECT * FROM entradas');
    allRecords = allRecords.concat(purchases.map(p => ({
      ...p,
      id: p.registo_id,
      type: 'purchase',
      quantityPurchased: parseFloat(p.quantityPurchased)
    })));

    // 5. Impresiones
    const [prints] = await pool.execute('SELECT * FROM impressoes');
    allRecords = allRecords.concat(prints.map(p => ({
      ...p,
      id: p.registo_id,
      type: 'print',
      filamentsUsed: JSON.parse(p.filamentsUsed || '[]') // Convertimos de vuelta a Array
    })));

    res.json({ success: true, data: allRecords });
  } catch (error) {
    console.error('Error GET All:', error);
    res.status(500).json({ success: false });
  }
});

// ==================== INICIAR SERVIDOR ====================
async function startServer() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`🚀 Servidor activo en puerto ${PORT}`);
  });
}

startServer();
