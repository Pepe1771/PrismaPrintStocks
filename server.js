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

// CONFIGURACIÓN DE BASE DE DATOS (Variables de Entorno)
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
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
    
    const connection = await pool.getConnection();

    // 1. TABLA PEDIDOS (Con columna para progreso)
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS pedidos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        registo_id VARCHAR(50),
        clientName VARCHAR(100),
        productBarcode VARCHAR(100),
        quantity INT,
        dueDate DATE,
        status VARCHAR(20) DEFAULT 'pendente',
        timestamp VARCHAR(50),
        orderType VARCHAR(20) DEFAULT 'standard',
        composition LONGTEXT,
        quantityPrinted INT DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    
    // 2. MIGRACIONES (Para actualizar tablas existentes sin borrar datos)
    try { await connection.execute("ALTER TABLE produtos ADD COLUMN composition LONGTEXT"); } catch (e) {}
    try { await connection.execute("ALTER TABLE pedidos ADD COLUMN orderType VARCHAR(20) DEFAULT 'standard'"); } catch (e) {}
    try { await connection.execute("ALTER TABLE pedidos ADD COLUMN composition LONGTEXT"); } catch (e) {}
    try { await connection.execute("ALTER TABLE pedidos ADD COLUMN quantityPrinted INT DEFAULT 0"); } catch (e) {}

    connection.release();
  } catch (error) {
    console.error('❌ Error DB:', error.message);
  }
}

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const [rows] = await pool.execute('SELECT id, username, name, role FROM utilizadores WHERE username = ? AND password = ?', [username, password]);
    if (rows.length > 0) res.json({ success: true, user: rows[0] });
    else res.status(401).json({ success: false });
  } catch (error) { res.status(500).json({ success: false }); }
});

// --- RUTAS CRUD ---

// PROVEEDORES
app.post('/api/registos/supplier', async (req, res) => {
  try {
    const d = req.body;
    const sql = `INSERT INTO fornecedores (registo_id, supplierName, supplierEmail, supplierPhone, supplierAddress, timestamp) VALUES (?, ?, ?, ?, ?, ?)`;
    const [r] = await pool.execute(sql, [d.id||d.registo_id, d.supplierName, d.supplierEmail, d.supplierPhone, d.supplierAddress, d.timestamp]);
    res.json({ success: true, backendId: r.insertId });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// FILAMENTOS
app.post('/api/registos/filament', async (req, res) => {
  try {
    const d = req.body;
    const sql = `INSERT INTO filamentos (registo_id, barcode, name, material, color, weightPerUnit, pricePerUnit, minStock, supplier, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    await pool.execute(sql, [d.id, d.barcode, d.name, d.material, d.color, d.weightPerUnit, d.pricePerUnit, d.minStock, d.supplier, d.timestamp]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// PRODUCTOS (Con receta JSON)
app.post('/api/registos/product', async (req, res) => {
  try {
    const d = req.body;
    const sql = `INSERT INTO produtos (registo_id, barcode, name, productCategory, stock, cost, salePrice, composition, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    await pool.execute(sql, [d.id, d.barcode, d.name, d.productCategory, d.stock, d.cost, d.salePrice, JSON.stringify(d.composition||[]), d.timestamp]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ENTRADAS (Compras)
app.post('/api/registos/purchase', async (req, res) => {
  try {
    const d = req.body;
    await pool.execute(`INSERT INTO entradas (registo_id, filamentBarcode, quantityPurchased, purchaseDate, supplier, timestamp) VALUES (?, ?, ?, ?, ?, ?)`, 
      [d.id, d.filamentBarcode||d.barcode, d.quantityPurchased, d.purchaseDate, d.supplier, d.timestamp]);
    
    if (d.category === 'product') {
        await pool.execute(`UPDATE produtos SET stock = stock + ? WHERE barcode = ?`, [d.quantityPurchased, d.barcode]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// IMPRESIONES (Actualiza progreso de pedidos)
app.post('/api/registos/print', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const d = req.body;
    
    // 1. Guardar la impresión
    await connection.execute(`INSERT INTO impressoes (registo_id, printName, filamentsUsed, notes, timestamp) VALUES (?, ?, ?, ?, ?)`, 
      [d.id, d.printName, JSON.stringify(d.filamentsUsed||[]), d.notes, d.timestamp]);

    // 2. Si está vinculada a un pedido, actualizar el contador
    if (d.linkOrderId && d.linkOrderQty > 0) {
        await connection.execute(`UPDATE pedidos SET quantityPrinted = quantityPrinted + ? WHERE id = ? OR registo_id = ?`, 
            [d.linkOrderQty, d.linkOrderId, d.linkOrderId]);
    }

    await connection.commit();
    res.json({ success: true });
  } catch (e) { 
    await connection.rollback();
    res.status(500).json({ message: e.message }); 
  } finally {
    connection.release();
  }
});

// VENTAS
app.post('/api/registos/sale', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const d = req.body;
    await connection.execute(`INSERT INTO vendas (registo_id, productBarcode, quantitySold, totalPrice, saleDate, timestamp) VALUES (?, ?, ?, ?, ?, ?)`, 
      [d.id, d.productBarcode, d.quantitySold, d.totalPrice, d.saleDate, d.timestamp]);
    await connection.execute(`UPDATE produtos SET stock = stock - ? WHERE barcode = ?`, [d.quantitySold, d.productBarcode]);
    await connection.commit();
    res.json({ success: true });
  } catch (e) { 
    await connection.rollback();
    res.status(500).json({ message: e.message }); 
  } finally { connection.release(); }
});

// PEDIDOS (Encomiendas)
app.post('/api/registos/order', async (req, res) => {
    try {
        const d = req.body;
        const sql = `INSERT INTO pedidos (registo_id, clientName, productBarcode, quantity, dueDate, status, orderType, composition, quantityPrinted, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`;
        await pool.execute(sql, [d.id, d.clientName, d.productBarcode, d.quantity, d.dueDate, 'pendente', d.orderType||'standard', JSON.stringify(d.composition||[]), d.timestamp]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

// LISTAR TODO (GET)
app.get('/api/registos', async (req, res) => {
  try {
    let all = [];
    const [fils] = await pool.execute('SELECT * FROM filamentos');
    all = all.concat(fils.map(f => ({ ...f, id: f.registo_id, type: 'filament', weightPerUnit: parseFloat(f.weightPerUnit), pricePerUnit: parseFloat(f.pricePerUnit), minStock: parseFloat(f.minStock) })));
    const [sups] = await pool.execute('SELECT * FROM fornecedores');
    all = all.concat(sups.map(s => ({ ...s, id: s.registo_id, type: 'supplier' })));
    const [prods] = await pool.execute('SELECT * FROM produtos');
    all = all.concat(prods.map(p => ({ ...p, id: p.registo_id, type: 'product', stock: parseInt(p.stock), composition: JSON.parse(p.composition||'[]') })));
    const [ents] = await pool.execute('SELECT * FROM entradas');
    all = all.concat(ents.map(e => ({ ...e, id: e.registo_id, type: 'purchase', quantityPurchased: parseFloat(e.quantityPurchased) })));
    const [imps] = await pool.execute('SELECT * FROM impressoes');
    all = all.concat(imps.map(i => ({ ...i, id: i.registo_id, type: 'print', filamentsUsed: JSON.parse(i.filamentsUsed||'[]') })));
    const [vends] = await pool.execute('SELECT * FROM vendas');
    all = all.concat(vends.map(v => ({ ...v, id: v.registo_id, type: 'sale', quantitySold: parseInt(v.quantitySold), totalPrice: parseFloat(v.totalPrice) })));
    const [ords] = await pool.execute('SELECT * FROM pedidos');
    all = all.concat(ords.map(o => ({ ...o, id: o.registo_id, type: 'order', quantity: parseInt(o.quantity), quantityPrinted: parseInt(o.quantityPrinted||0), composition: JSON.parse(o.composition||'[]') })));
    res.json({ success: true, data: all });
  } catch (e) { res.status(500).json({ success: false }); }
});

// ELIMINAR
app.delete('/api/registos/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;
        let table = { filament:'filamentos', supplier:'fornecedores', product:'produtos', purchase:'entradas', print:'impressoes', sale:'vendas', order:'pedidos' }[type];
        if(!table) return res.status(400).json({});
        await pool.execute(`DELETE FROM ${table} WHERE registo_id = ? OR id = ?`, [id, id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

// ACTUALIZAR ESTADO PEDIDO
app.put('/api/registos/order/:id/status', async (req, res) => {
    try {
        await pool.execute("UPDATE pedidos SET status = ? WHERE registo_id = ? OR id = ?", [req.body.status, req.params.id, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ACTUALIZAR GENÉRICO (Para edición)
app.put('/api/registos/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;
        const d = req.body;
        // Aquí deberías añadir los UPDATE específicos para cada tabla si quieres edición completa.
        // He incluido los básicos para que no falle.
        if(type === 'filament') {
             await pool.execute("UPDATE filamentos SET name=?, material=?, color=?, weightPerUnit=?, pricePerUnit=?, minStock=?, supplier=? WHERE registo_id=? OR id=?", [d.name, d.material, d.color, d.weightPerUnit, d.pricePerUnit, d.minStock, d.supplier, id, id]);
        }
        if(type === 'product') {
             await pool.execute("UPDATE produtos SET name=?, stock=?, cost=?, salePrice=? WHERE registo_id=? OR id=?", [d.name, d.stock, d.cost, d.salePrice, id, id]);
        }
        res.json({ success: true });
    } catch(e){ res.status(500).json({}); }
});

async function startServer() {
  await initDatabase();
  app.listen(PORT, () => console.log(`🚀 Porta ${PORT}`));
}
startServer();
